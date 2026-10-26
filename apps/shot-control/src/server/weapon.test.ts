import { destination, distanceM, type SystemTrack } from "@tdts/shared";
import { describe, expect, it } from "vitest";
import { Weapon, WeaponCommandError, type WeaponSpec } from "./weapon";

const T0 = 1_700_000_000_000;
const site = { lat: 47.42, lon: 8.62 };

const spec: WeaponSpec = {
  position: site,
  minRangeM: 2_000,
  maxRangeM: 15_000,
  ammo: 2,
  prepareTimeS: 8,
  reloadTimeS: 12,
  shellSpeedMps: 300,
};

/**
 * A drone 25 km north, flying south at 100 m/s. It enters the 15 km reach
 * after 100 s; with 50 s of shell flight the weapon fires around T0 + 50 s.
 */
const inbound = (observedAt = T0): SystemTrack => ({
  trackId: "S-0001",
  position: destination(site, 0, 25_000),
  altitudeM: 400,
  speedMps: 100,
  headingDeg: 180,
  observedAt,
});

/** Flying away east, already beyond reach. */
const outOfReach: SystemTrack = {
  ...inbound(),
  position: destination(site, 90, 40_000),
  headingDeg: 90,
};

/** Ticks every 100 ms up to `until`, collecting events. */
function runUntil(w: Weapon, from: number, until: number) {
  const events = [];
  for (let t = from; t <= until; t += 100) events.push(...w.tick(t));
  return events;
}

describe("Weapon", () => {
  it("starts idle with its ammo", () => {
    expect(new Weapon(spec).status()).toEqual({
      state: "IDLE",
      ammo: 2,
      minRangeM: 2_000,
      maxRangeM: 15_000,
      engagementId: null,
      stateUntil: null,
    });
  });

  it("prepares for prepareTimeS, then is ready", () => {
    const w = new Weapon(spec);
    w.prepare("E-1", inbound(), T0);
    expect(w.status()).toMatchObject({
      state: "PREPARING",
      engagementId: "E-1",
      stateUntil: T0 + 8_000,
    });
    w.tick(T0 + 7_900);
    expect(w.status().state).toBe("PREPARING");
    w.tick(T0 + 8_000);
    expect(w.status()).toMatchObject({ state: "READY", stateUntil: null });
  });

  it("fires at its own solution's fire time, then reloads and is idle again", () => {
    const w = new Weapon(spec);
    w.prepare("E-1", inbound(), T0);
    w.tick(T0 + 8_000);
    const now = T0 + 8_000;
    expect(w.fire("E-1", now)).toEqual([]);
    expect(w.status().state).toBe("FIRING");
    const fireAt = w.details().engagement!.solution!.fireAt;

    const events = runUntil(w, now, now + 120_000);
    const shot = events.find((e) => e.type === "shotFired");
    expect(shot).toBeDefined();
    if (shot?.type !== "shotFired") return;
    expect(shot.payload.engagementId).toBe("E-1");
    expect(shot.payload.firedAt - fireAt).toBeLessThan(100);
    // Flight time is distance / shell speed, to the point where the target will be.
    const d = distanceM(site, shot.payload.impactPoint);
    expect((shot.payload.impactAt - shot.payload.firedAt) / 1000).toBeCloseTo(d / 300, 1);
    expect(d).toBeLessThanOrEqual(15_000);

    expect(w.status().ammo).toBe(1);
    // After reloading it's available again.
    expect(w.status().state).toBe("IDLE");
  });

  it("ends EMPTY after firing its last round", () => {
    const w = new Weapon({ ...spec, ammo: 1 });
    w.prepare("E-1", inbound(), T0);
    w.tick(T0 + 8_000);
    w.fire("E-1", T0 + 8_000);
    runUntil(w, T0 + 8_000, T0 + 120_000);
    expect(w.status()).toMatchObject({ state: "EMPTY", ammo: 0 });
    expect(() => w.prepare("E-2", inbound(), T0 + 120_000)).toThrow(WeaponCommandError);
  });

  it("shoots at once when the target is already in reach", () => {
    const close: SystemTrack = { ...inbound(), position: destination(site, 0, 12_000) };
    const w = new Weapon(spec);
    w.prepare("E-1", close, T0);
    w.tick(T0 + 8_000);
    const events = w.fire("E-1", T0 + 8_000);
    expect(events.map((e) => e.type)).toEqual(["shotFired"]);
    expect(w.status().state).toBe("RELOADING");
  });

  it("reports fireFailed and stays ready when the target is out of reach", () => {
    const w = new Weapon(spec);
    w.prepare("E-1", outOfReach, T0);
    w.tick(T0 + 8_000);
    expect(w.fire("E-1", T0 + 8_000)).toEqual([
      { type: "fireFailed", payload: { engagementId: "E-1", reason: "NO_SOLUTION" } },
    ]);
    expect(w.status()).toMatchObject({ state: "READY", engagementId: "E-1", ammo: 2 });
  });

  it("follows track updates while waiting to fire", () => {
    const w = new Weapon(spec);
    w.prepare("E-1", inbound(), T0);
    w.tick(T0 + 8_000);
    w.fire("E-1", T0 + 8_000);
    const before = w.details().engagement!.solution!.impactPoint;
    // The target turned: newer data moves the aim point.
    w.updateTrack("E-1", { ...inbound(T0 + 9_000), headingDeg: 200 }, T0 + 9_000);
    const after = w.details().engagement!.solution!.impactPoint;
    expect(distanceM(before, after)).toBeGreaterThan(100);
  });

  it("can be cancelled until it fires, and nothing is fired", () => {
    for (const reachState of ["PREPARING", "READY", "FIRING"] as const) {
      const w = new Weapon(spec);
      w.prepare("E-1", inbound(), T0);
      if (reachState !== "PREPARING") w.tick(T0 + 8_000);
      if (reachState === "FIRING") w.fire("E-1", T0 + 8_000);
      expect(w.status().state).toBe(reachState);
      w.cancel("E-1");
      expect(w.status()).toMatchObject({ state: "IDLE", engagementId: null, ammo: 2 });
      expect(runUntil(w, T0 + 8_000, T0 + 120_000)).toEqual([]);
    }
  });

  it("takes new ranges, reports them and aims with them", () => {
    const fireAt8s = (w: Weapon) => {
      w.prepare("E-1", inbound(), T0);
      w.tick(T0 + 8_000);
      return w.fire("E-1", T0 + 8_000).map((e) => e.type);
    };
    // 15 km reach: the drone 24 km out isn't reachable yet; the weapon waits.
    expect(fireAt8s(new Weapon(spec))).toEqual([]);
    // 20 km reach: the shell can meet it about 18 km out, so it shoots at once.
    const longer = new Weapon(spec);
    longer.setRanges({ minRangeM: 1_000, maxRangeM: 20_000 });
    expect(longer.status()).toMatchObject({ minRangeM: 1_000, maxRangeM: 20_000 });
    expect(fireAt8s(longer)).toEqual(["shotFired"]);
  });

  it("refuses ranges where min isn't below max", () => {
    const w = new Weapon(spec);
    expect(() => w.setRanges({ minRangeM: 5_000, maxRangeM: 5_000 })).toThrow(WeaponCommandError);
    expect(() => w.setRanges({ minRangeM: -1, maxRangeM: 5_000 })).toThrow(WeaponCommandError);
    expect(w.status()).toMatchObject({ minRangeM: 2_000, maxRangeM: 15_000 });
  });

  it("refuses commands that don't fit its state or engagement", () => {
    const w = new Weapon(spec);
    expect(() => w.fire("E-1", T0)).toThrow(WeaponCommandError);
    expect(() => w.cancel("E-1")).toThrow(WeaponCommandError);
    w.prepare("E-1", inbound(), T0);
    expect(() => w.prepare("E-2", inbound(), T0)).toThrow(WeaponCommandError);
    expect(() => w.updateTrack("E-2", inbound(), T0)).toThrow(WeaponCommandError);
    expect(() => w.fire("E-1", T0 + 1_000)).toThrow(WeaponCommandError); // still preparing
  });
});
