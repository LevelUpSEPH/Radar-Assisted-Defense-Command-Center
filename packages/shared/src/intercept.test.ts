import { describe, expect, it } from "vitest";
import { destination, distanceM, extrapolate } from "./geo";
import { findEarliestIntercept, type InterceptWeapon } from "./intercept";

const NOW = 1_700_000_000_000;

const weapon: InterceptWeapon = {
  position: { lat: 40, lon: 30 },
  minRangeM: 2_000,
  maxRangeM: 15_000,
  shellSpeedMps: 300,
};

/** A target `distM` meters from the weapon on `bearing`, flying on `headingDeg`. */
function targetAt(bearing: number, distM: number, speedMps: number, headingDeg: number) {
  return {
    position: destination(weapon.position, bearing, distM),
    speedMps,
    headingDeg,
    observedAt: NOW,
  };
}

describe("findEarliestIntercept", () => {
  it("hits a stationary target in range as soon as the weapon is ready", () => {
    const target = targetAt(0, 6_000, 0, 0);
    const s = findEarliestIntercept(weapon, target, { now: NOW, readyAt: NOW });
    expect(s).not.toBeNull();
    // Flight time is 20 s, so the first impact time with fireAt >= now is now + 20 s.
    expect(s!.impactAt - NOW).toBeCloseTo(20_000, -3);
    expect(s!.fireAt).toBeGreaterThanOrEqual(NOW);
  });

  it("keeps flight time consistent with distance and shell speed", () => {
    const target = targetAt(45, 20_000, 60, 225); // inbound from the north-east
    const s = findEarliestIntercept(weapon, target, { now: NOW, readyAt: NOW + 8_000 })!;
    expect(s).not.toBeNull();
    expect((s.impactAt - s.fireAt) / 1000).toBeCloseTo(s.distanceM / weapon.shellSpeedMps, 6);
    expect(s.fireAt).toBeGreaterThanOrEqual(NOW + 8_000);
  });

  it("aims where the target will be, not where it is", () => {
    const target = targetAt(45, 20_000, 60, 225);
    const s = findEarliestIntercept(weapon, target, { now: NOW, readyAt: NOW })!;
    const predicted = extrapolate(target.position, 60, 225, (s.impactAt - NOW) / 1000);
    expect(distanceM(s.impactPoint, predicted)).toBeLessThan(1);
    expect(s.distanceM).toBeLessThanOrEqual(weapon.maxRangeM);
    expect(s.distanceM).toBeGreaterThanOrEqual(weapon.minRangeM);
  });

  it("returns null for a target that never enters range", () => {
    // 30 km east, flying north: closest approach is 30 km.
    const target = targetAt(90, 30_000, 80, 0);
    expect(findEarliestIntercept(weapon, target, { now: NOW, readyAt: NOW })).toBeNull();
  });

  it("returns null for a stationary target inside the minimum range", () => {
    const target = targetAt(0, 1_000, 0, 0);
    expect(findEarliestIntercept(weapon, target, { now: NOW, readyAt: NOW })).toBeNull();
  });

  it("returns null once a fast target escapes before the weapon is ready", () => {
    // Just inside max range, flying straight away at 200 m/s; ready in 60 s.
    const target = targetAt(0, 14_000, 200, 0);
    expect(findEarliestIntercept(weapon, target, { now: NOW, readyAt: NOW + 60_000 })).toBeNull();
  });

  it("uses the age of the observation", () => {
    // Same target, but the observation is 10 s old: it is 600 m further along.
    const fresh = targetAt(45, 20_000, 60, 225);
    const stale = { ...fresh, observedAt: NOW - 10_000 };
    const a = findEarliestIntercept(weapon, fresh, { now: NOW, readyAt: NOW })!;
    const b = findEarliestIntercept(weapon, stale, { now: NOW, readyAt: NOW })!;
    expect(b.impactAt).toBeLessThan(a.impactAt);
  });
});
