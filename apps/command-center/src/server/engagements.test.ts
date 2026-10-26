import {
  destination,
  KILL_CHECK_DELAY_MS,
  KILL_CHECK_TIMEOUT_MS,
  type WeaponStatus,
} from "@tdts/shared";
import { describe, expect, it } from "vitest";
import type { SystemTrackView } from "../protocol";
import { Engagements, type Command, type WeaponInfo } from "./engagements";

const T0 = 1_700_000_000_000;
const site = { lat: 47.42, lon: 8.62 };

const status = (over: Partial<WeaponStatus> = {}): WeaponStatus => ({
  state: "IDLE",
  ammo: 20,
  minRangeM: 2_000,
  maxRangeM: 15_000,
  engagementId: null,
  stateUntil: null,
  ...over,
});

const weapon = (unitId: string, over: Partial<WeaponStatus> = {}, position = site): WeaponInfo => ({
  unitId,
  position,
  prepareTimeS: 8,
  shellSpeedMps: 300,
  status: status(over),
});

/** An engageable enemy drone 20 km north, flying south at 100 m/s, seen by RDR-01. */
const enemy = (over: Partial<SystemTrackView> = {}): SystemTrackView => ({
  trackId: "S-0001",
  position: destination(site, 0, 20_000),
  altitudeM: 400,
  speedMps: 100,
  headingDeg: 180,
  likelihood: 0.95,
  observedAt: T0,
  sources: [{ unitId: "RDR-01", radarTrackId: "T-0007", iff: "ENEMY", likelihood: 0.95 }],
  classification: "ENEMY",
  classificationSource: "radars",
  engageable: true,
  trail: [],
  ...over,
});

const types = (cmds: Command[]) => cmds.map((c) => `${c.to}:${c.msg.type}`);

/** Runs assignment and returns the new engagement's id. */
function prepared(e: Engagements, weapons = [weapon("WPN-01")]) {
  const cmds = e.plan(T0, [enemy()], weapons);
  const prepare = cmds.find((c) => c.msg.type === "prepare")!;
  return { id: (prepare.msg.payload as { engagementId: string }).engagementId, cmds };
}

describe("assignment", () => {
  it("prepares a free weapon for an engageable enemy", () => {
    const e = new Engagements("approval");
    const { id, cmds } = prepared(e);
    expect(id).toBe("E-0001");
    expect(types(cmds)).toEqual(["WPN-01:prepare"]);
    expect(e.view()[0]).toMatchObject({
      trackId: "S-0001",
      weaponUnitId: "WPN-01",
      state: "PREPARING",
    });
  });

  it("leaves friends, unknowns and unlikely enemies alone", () => {
    const e = new Engagements("auto");
    const notEngageable = [
      enemy({ trackId: "S-0002", classification: "FRIENDLY", engageable: false }),
      enemy({ trackId: "S-0003", classification: "UNKNOWN", engageable: false }),
      enemy({ trackId: "S-0004", likelihood: 0.2, engageable: false }),
    ];
    expect(e.plan(T0, notEngageable, [weapon("WPN-01")])).toEqual([]);
  });

  it("picks the weapon that can hit soonest, and uses each weapon once", () => {
    const e = new Engagements("auto");
    const far = weapon("WPN-FAR", {}, destination(site, 180, 20_000));
    const near = weapon("WPN-NEAR");
    const cmds = e.plan(
      T0,
      [enemy(), enemy({ trackId: "S-0002", position: destination(site, 10, 20_000) })],
      [far, near],
    );
    // The nearer weapon takes the first track it can hit; the far one gets the other.
    expect(types(cmds).sort()).toEqual(["WPN-FAR:prepare", "WPN-NEAR:prepare"]);
    expect(new Set(e.view().map((v) => v.trackId))).toEqual(new Set(["S-0001", "S-0002"]));
  });

  it("skips busy, empty and out-of-reach weapons", () => {
    const e = new Engagements("auto");
    expect(
      e.plan(
        T0,
        [enemy()],
        [
          weapon("WPN-BUSY", { state: "RELOADING" }),
          weapon("WPN-EMPTY", { state: "EMPTY", ammo: 0 }),
          weapon("WPN-AWAY", {}, destination(site, 90, 100_000)),
        ],
      ),
    ).toEqual([]);
  });

  it("doesn't assign a second weapon to a target that already has one", () => {
    const e = new Engagements("auto");
    prepared(e);
    const again = e.plan(
      T0 + 1_000,
      [enemy()],
      [weapon("WPN-01", { state: "PREPARING", engagementId: "E-0001" }), weapon("WPN-02")],
    );
    expect(types(again)).toEqual(["WPN-01:trackUpdate"]);
  });
});

describe("fire control", () => {
  it("in approval mode waits for the operator, then fires", () => {
    const e = new Engagements("approval");
    const { id } = prepared(e);
    expect(
      e.onWeaponStatus("WPN-01", status({ state: "READY", engagementId: id }), T0 + 8_000),
    ).toEqual([]);
    expect(e.view()[0]!.state).toBe("AWAITING_APPROVAL");
    expect(types(e.approve(id, T0 + 9_000))).toEqual(["WPN-01:fire"]);
    expect(e.view()[0]!.state).toBe("FIRING");
  });

  it("in auto mode fires as soon as the weapon is ready", () => {
    const e = new Engagements("auto");
    const { id } = prepared(e);
    expect(
      types(e.onWeaponStatus("WPN-01", status({ state: "READY", engagementId: id }), T0 + 8_000)),
    ).toEqual(["WPN-01:fire"]);
  });

  it("the operator can reject: the weapon is told to stand down", () => {
    const e = new Engagements("approval");
    const { id } = prepared(e);
    e.onWeaponStatus("WPN-01", status({ state: "READY", engagementId: id }), T0 + 8_000);
    expect(types(e.reject(id, T0 + 9_000))).toEqual(["WPN-01:cancel"]);
    expect(e.view()[0]).toMatchObject({ state: "CANCELLED", reason: "rejected by operator" });
    expect(() => e.approve(id, T0 + 9_000)).toThrow();
  });
});

describe("calling off", () => {
  it("cancels when the target stops being an engageable enemy, or is lost", () => {
    const e = new Engagements("auto");
    prepared(e);
    const cmds = e.plan(
      T0 + 1_000,
      [enemy({ classification: "FRIENDLY", engageable: false })],
      [weapon("WPN-01", { state: "PREPARING", engagementId: "E-0001" })],
    );
    expect(types(cmds)).toEqual(["WPN-01:cancel"]);
    expect(e.view()[0]).toMatchObject({
      state: "CANCELLED",
      reason: "no longer an engageable enemy",
    });

    const e2 = new Engagements("auto");
    prepared(e2);
    e2.plan(T0 + 1_000, [], [weapon("WPN-01")]);
    expect(e2.view()[0]).toMatchObject({ state: "CANCELLED", reason: "track lost" });
  });

  it("cancels when the weapon goes offline", () => {
    const e = new Engagements("auto");
    prepared(e);
    e.weaponGone("WPN-01", T0 + 1_000);
    expect(e.view()[0]).toMatchObject({ state: "CANCELLED", reason: "weapon went offline" });
  });

  it("when a weapon can't solve the target, calls it off and tries another weapon", () => {
    const e = new Engagements("auto");
    const { id } = prepared(e);
    expect(types(e.onFireFailed("WPN-01", id, "NO_SOLUTION", T0 + 9_000))).toEqual([
      "WPN-01:cancel",
    ]);
    // WPN-01 isn't offered that track again for a while; WPN-02 is.
    const next = e.plan(
      T0 + 10_000,
      [enemy({ observedAt: T0 + 10_000 })],
      [weapon("WPN-01"), weapon("WPN-02")],
    );
    expect(types(next)).toEqual(["WPN-02:prepare"]);
  });
});

describe("kill confirmation", () => {
  function inFlight() {
    const e = new Engagements("auto");
    const { id } = prepared(e);
    e.onWeaponStatus("WPN-01", status({ state: "READY", engagementId: id }), T0 + 8_000);
    const impactAt = T0 + 60_000;
    e.onShotFired(
      "WPN-01",
      { engagementId: id, firedAt: T0 + 20_000, impactAt, impactPoint: site },
      T0 + 20_000,
    );
    return { e, id, impactAt };
  }

  it("asks the radars that saw the target once the shell has arrived", () => {
    const { e, id, impactAt } = inFlight();
    expect(e.view()[0]!.state).toBe("IN_FLIGHT");
    // Nothing before the shell arrives (and the weapon is no longer aimed).
    expect(e.plan(impactAt, [enemy()], [])).toEqual([]);
    const cmds = e.plan(impactAt + KILL_CHECK_DELAY_MS, [enemy()], []);
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toMatchObject({
      to: "RDR-01",
      msg: { type: "confirmKill", payload: { checkId: id, radarTrackId: "T-0007" } },
    });
    expect(e.view()[0]!.state).toBe("CONFIRMING");
  });

  it("a radar saying destroyed confirms the kill", () => {
    const { e, id, impactAt } = inFlight();
    e.plan(impactAt + KILL_CHECK_DELAY_MS, [enemy()], []);
    e.onKillReport("RDR-99", id, true, impactAt + 1_500); // not asked: ignored
    expect(e.view()[0]!.state).toBe("CONFIRMING");
    e.onKillReport("RDR-01", id, true, impactAt + 1_500);
    expect(e.view()[0]).toMatchObject({ state: "KILL", reason: null });
  });

  it("a destroyed track lingering in fusion isn't engaged again", () => {
    const { e, id, impactAt } = inFlight();
    e.plan(impactAt + KILL_CHECK_DELAY_MS, [enemy()], []);
    e.onKillReport("RDR-01", id, true, impactAt + 1_500);
    expect(e.plan(impactAt + 2_000, [enemy()], [weapon("WPN-01")])).toEqual([]);
  });

  it("no answer in time is UNCONFIRMED", () => {
    const { e, impactAt } = inFlight();
    e.plan(impactAt + KILL_CHECK_DELAY_MS, [enemy()], []);
    e.plan(impactAt + KILL_CHECK_DELAY_MS + KILL_CHECK_TIMEOUT_MS + 1, [], []);
    expect(e.view()[0]!.state).toBe("UNCONFIRMED");
  });

  it("a fired shot isn't called off by the track disappearing", () => {
    const { e } = inFlight();
    e.plan(T0 + 30_000, [], []);
    e.weaponGone("WPN-01", T0 + 30_000);
    expect(e.view()[0]!.state).toBe("IN_FLIGHT");
  });
});
