import { describe, expect, it } from "vitest";
import {
  bearingDeg,
  bearingDifference,
  destination,
  distanceM,
  extrapolate,
  moveTowards,
  normalizeBearing,
} from "./geo";

// One degree of arc on the mean-radius sphere.
const ONE_DEG_M = (2 * Math.PI * 6_371_008.8) / 360;

describe("distanceM", () => {
  it("is zero for the same point", () => {
    expect(distanceM({ lat: 41, lon: 29 }, { lat: 41, lon: 29 })).toBe(0);
  });

  it("measures one degree along the equator and a meridian", () => {
    expect(distanceM({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(ONE_DEG_M, 3);
    expect(distanceM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(ONE_DEG_M, 3);
  });

  it("matches a known city pair (London - Paris ≈ 343.5 km)", () => {
    const london = { lat: 51.5074, lon: -0.1278 };
    const paris = { lat: 48.8566, lon: 2.3522 };
    expect(distanceM(london, paris) / 1000).toBeCloseTo(343.5, 0);
  });

  it("is symmetric", () => {
    const a = { lat: 39.9, lon: 32.85 };
    const b = { lat: 41.0, lon: 28.97 };
    expect(distanceM(a, b)).toBeCloseTo(distanceM(b, a), 6);
  });
});

describe("bearingDeg", () => {
  const o = { lat: 0, lon: 0 };
  it.each([
    [{ lat: 1, lon: 0 }, 0],
    [{ lat: 0, lon: 1 }, 90],
    [{ lat: -1, lon: 0 }, 180],
    [{ lat: 0, lon: -1 }, 270],
  ])("from origin to %o is %d°", (to, expected) => {
    expect(bearingDeg(o, to)).toBeCloseTo(expected, 6);
  });
});

describe("normalizeBearing / bearingDifference", () => {
  it("wraps into [0, 360)", () => {
    expect(normalizeBearing(-90)).toBe(270);
    expect(normalizeBearing(360)).toBe(0);
    expect(normalizeBearing(725)).toBe(5);
  });

  it("takes the short way around", () => {
    expect(bearingDifference(350, 10)).toBe(20);
    expect(bearingDifference(10, 350)).toBe(20);
    expect(bearingDifference(0, 180)).toBe(180);
  });
});

describe("destination", () => {
  it("round-trips with distance and bearing", () => {
    const from = { lat: 40.5, lon: 30.2 };
    const to = destination(from, 57, 25_000);
    expect(distanceM(from, to)).toBeCloseTo(25_000, 3);
    expect(bearingDeg(from, to)).toBeCloseTo(57, 6);
  });

  it("wraps longitude across the antimeridian", () => {
    const to = destination({ lat: 0, lon: 179.9 }, 90, 0.2 * ONE_DEG_M);
    expect(to.lon).toBeCloseTo(-179.9, 6);
  });
});

describe("moveTowards", () => {
  const from = { lat: 40, lon: 30 };
  const to = { lat: 40.1, lon: 30.1 };

  it("moves part of the way", () => {
    const { position, arrived } = moveTowards(from, to, 1_000);
    expect(arrived).toBe(false);
    expect(distanceM(from, position)).toBeCloseTo(1_000, 3);
    expect(distanceM(position, to)).toBeCloseTo(distanceM(from, to) - 1_000, 3);
  });

  it("stops exactly at the destination", () => {
    const { position, arrived } = moveTowards(from, to, 1e9);
    expect(arrived).toBe(true);
    expect(position).toEqual(to);
  });
});

describe("extrapolate", () => {
  it("dead-reckons forwards and backwards", () => {
    const p = { lat: 40, lon: 30 };
    const ahead = extrapolate(p, 50, 90, 10);
    expect(distanceM(p, ahead)).toBeCloseTo(500, 3);
    expect(bearingDeg(p, ahead)).toBeCloseTo(90, 1);

    const behind = extrapolate(p, 50, 90, -10);
    expect(distanceM(p, behind)).toBeCloseTo(500, 3);
    expect(bearingDeg(p, behind)).toBeCloseTo(270, 1);
  });
});
