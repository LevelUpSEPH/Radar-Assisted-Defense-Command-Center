import { destination, distanceM, type Detection, type LatLon } from "@tdts/shared";
import { describe, expect, it } from "vitest";
import { fitTrack, TRACK_WINDOW, Tracker, vehicleSpeedScore } from "./tracker";

const T0 = 1_700_000_000_000;
const start = { lat: 47.4, lon: 8.5 };

/** A deterministic pseudo-random source (mulberry32), so noisy tests repeat exactly. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const det = (truthId: string, position: LatLon, signature = 0.9): Detection => ({
  truthId,
  position,
  altitudeM: 300,
  signature,
  iffResponds: false,
});

/** Feeds `scans` one-second scans of an object flying `speedMps` on `headingDeg`. */
function fly(
  tracker: Tracker,
  speedMps: number,
  headingDeg: number,
  scans: number,
  signature = 0.9,
) {
  for (let i = 0; i < scans; i++) {
    const p = destination(start, headingDeg, speedMps * i);
    tracker.update([det("W1-d1", p, signature)], T0 + i * 1000);
  }
}

describe("fitTrack", () => {
  it("recovers speed and heading exactly from clean points", () => {
    const samples = Array.from({ length: 6 }, (_, i) => ({
      position: destination(start, 60, 100 * i),
      at: T0 + i * 1000,
    }));
    const fit = fitTrack(samples);
    expect(fit.speedMps).toBeCloseTo(100, 0);
    expect(fit.headingDeg).toBeCloseTo(60, 0);
    expect(distanceM(fit.position, samples[5]!.position)).toBeLessThan(1);
  });

  it("has no speed with a single point", () => {
    expect(fitTrack([{ position: start, at: T0 }])).toMatchObject({ speedMps: 0 });
  });
});

describe("Tracker", () => {
  it("creates one track per object and keeps its id", () => {
    const t = new Tracker({ positionNoiseM: 0 });
    fly(t, 100, 90, 3);
    const [track] = t.view();
    expect(t.view()).toHaveLength(1);
    expect(track).toMatchObject({ radarTrackId: "T-0001", altitudeM: 300, missedScans: 0 });
    expect(t.truthIdOf("T-0001")).toBe("W1-d1");
  });

  it("estimates speed and heading close to the truth despite 50 m noise", () => {
    const t = new Tracker({ positionNoiseM: 50, random: seeded(1) });
    fly(t, 100, 225, TRACK_WINDOW);
    const [track] = t.view();
    expect(track!.speedMps).toBeGreaterThan(90);
    expect(track!.speedMps).toBeLessThan(110);
    expect(Math.abs(track!.headingDeg - 225)).toBeLessThan(5);
  });

  it("smooths the reported position below the raw noise", () => {
    const t = new Tracker({ positionNoiseM: 50, random: seeded(2) });
    fly(t, 100, 0, TRACK_WINDOW);
    const truth = destination(start, 0, 100 * (TRACK_WINDOW - 1));
    expect(distanceM(t.view()[0]!.position, truth)).toBeLessThan(30);
  });

  it("keeps at most TRACK_WINDOW measured positions in the trail", () => {
    const t = new Tracker({ positionNoiseM: 0 });
    fly(t, 100, 0, TRACK_WINDOW + 5);
    expect(t.view()[0]!.trail).toHaveLength(TRACK_WINDOW);
  });

  it("rates a fast high-signature object as a likely drone, a slow faint one as unlikely", () => {
    const drone = new Tracker({ positionNoiseM: 0, random: () => 0.5 });
    fly(drone, 100, 0, 10, 0.9);
    const bird = new Tracker({ positionNoiseM: 0, random: () => 0.5 });
    fly(bird, 12, 0, 10, 0.2);
    expect(drone.view()[0]!.likelihood).toBeGreaterThan(0.85);
    expect(bird.view()[0]!.likelihood).toBeLessThan(0.25);
  });

  it("drops a track after 3 scans without it, but keeps it before that", () => {
    const t = new Tracker({ positionNoiseM: 0 });
    fly(t, 100, 0, 3);
    t.update([], T0 + 3_000);
    t.update([], T0 + 4_000);
    expect(t.view()[0]!.missedScans).toBe(2);
    t.update([], T0 + 5_000);
    expect(t.view()).toEqual([]);
  });

  it("gives a reappearing object a new track id", () => {
    const t = new Tracker({ positionNoiseM: 0 });
    fly(t, 100, 0, 2);
    for (let i = 0; i < 3; i++) t.update([], T0 + 10_000 + i);
    t.update([det("W1-d1", start)], T0 + 20_000);
    expect(t.view()[0]!.radarTrackId).toBe("T-0002");
  });
});

describe("vehicleSpeedScore", () => {
  it.each([
    [5, 0],
    [10, 0],
    [20, 0.5],
    [30, 1],
    [150, 1],
  ])("%d m/s → %d", (speed, score) => expect(vehicleSpeedScore(speed)).toBeCloseTo(score, 6));
});
