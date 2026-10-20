import { destination, distanceM, type Iff, type LatLon } from "@tdts/shared";
import { describe, expect, it } from "vitest";
import type { AirTrack } from "../protocol";
import { classify, classifyFromReports } from "./classification";
import { Fusion } from "./fusion";

const T0 = 1_700_000_000_000;
const here = { lat: 47.5, lon: 8.5 };

function air(
  unitId: string,
  radarTrackId: string,
  position: LatLon,
  {
    speedMps = 100,
    headingDeg = 180,
    iff = "UNKNOWN" as Iff,
    likelihood = 0.9,
    observedAt = T0,
  } = {},
): AirTrack {
  return {
    unitId,
    radarTrackId,
    position,
    altitudeM: 400,
    speedMps,
    headingDeg,
    likelihood,
    iff,
    observedAt,
    trail: [position],
  };
}

const newFusion = () => new Fusion({ minLikelihoodToEngage: 0.6 });

describe("fusion", () => {
  it("gives every lone radar track its own system track", () => {
    const f = newFusion();
    f.update([
      air("RDR-01", "T-0001", here),
      air("RDR-01", "T-0002", destination(here, 90, 5_000)),
    ]);
    expect(f.view().map((t) => t.trackId)).toEqual(["S-0001", "S-0002"]);
  });

  it("fuses two radars' tracks of the same object", () => {
    const f = newFusion();
    const near = destination(here, 45, 300);
    f.update([air("RDR-01", "T-0001", here), air("RDR-02", "T-0007", near)]);
    const [t, ...rest] = f.view();
    expect(rest).toEqual([]);
    expect(t!.sources.map((s) => `${s.unitId}/${s.radarTrackId}`)).toEqual([
      "RDR-01/T-0001",
      "RDR-02/T-0007",
    ]);
    // The fused position sits between the two reports.
    expect(distanceM(t!.position, here)).toBeCloseTo(150, -1);
  });

  it("keeps objects apart beyond 1 km, or flying different ways", () => {
    const f = newFusion();
    f.update([
      air("RDR-01", "T-0001", here),
      air("RDR-02", "T-0001", destination(here, 0, 1_500)),
      air("RDR-02", "T-0002", destination(here, 90, 200), { headingDeg: 90 }),
    ]);
    expect(f.view()).toHaveLength(3);
  });

  it("ignores heading for slow objects, where heading means little", () => {
    const f = newFusion();
    f.update([
      air("RDR-01", "T-0001", here, { speedMps: 2, headingDeg: 0 }),
      air("RDR-02", "T-0001", destination(here, 0, 100), { speedMps: 3, headingDeg: 170 }),
    ]);
    expect(f.view()).toHaveLength(1);
  });

  it("never fuses two tracks from the same radar", () => {
    const f = newFusion();
    f.update([air("RDR-01", "T-0001", here), air("RDR-01", "T-0002", destination(here, 0, 100))]);
    expect(f.view()).toHaveLength(2);
  });

  it("keeps the system track id while radars keep reporting, and drops it when they stop", () => {
    const f = newFusion();
    f.update([air("RDR-01", "T-0001", here)]);
    const moved = destination(here, 180, 100);
    f.update([air("RDR-01", "T-0001", moved, { observedAt: T0 + 1_000 })]);
    expect(f.view().map((t) => t.trackId)).toEqual(["S-0001"]);
    expect(f.view()[0]!.trail).toEqual([here, moved]);
    f.update([]);
    expect(f.view()).toEqual([]);
  });

  it("projects reports to the same moment before matching and averaging", () => {
    // RDR-02 saw the object 1 s after RDR-01; at 100 m/s that's 100 m further on.
    const f = newFusion();
    const later = destination(here, 180, 100);
    f.update([
      air("RDR-01", "T-0001", here),
      air("RDR-02", "T-0003", later, { observedAt: T0 + 1_000 }),
    ]);
    const [t] = f.view();
    expect(t!.sources).toHaveLength(2);
    expect(distanceM(t!.position, later)).toBeLessThan(1);
    expect(t!.observedAt).toBe(T0 + 1_000);
  });

  it("takes the highest likelihood any radar reports", () => {
    const f = newFusion();
    f.update([
      air("RDR-01", "T-0001", here, { likelihood: 0.4 }),
      air("RDR-02", "T-0001", here, { likelihood: 0.8 }),
    ]);
    expect(f.view()[0]!.likelihood).toBe(0.8);
  });
});

describe("classification", () => {
  it("friend wins, then enemy, else unknown", () => {
    expect(classifyFromReports(["ENEMY", "FRIENDLY"])).toBe("FRIENDLY");
    expect(classifyFromReports(["UNKNOWN", "ENEMY"])).toBe("ENEMY");
    expect(classifyFromReports(["UNKNOWN"])).toBe("UNKNOWN");
    expect(classifyFromReports([])).toBe("UNKNOWN");
  });

  it("an operator override wins over every report", () => {
    expect(classify(["FRIENDLY"], "ENEMY")).toEqual({
      classification: "ENEMY",
      source: "operator",
    });
    expect(classify(["FRIENDLY"], null)).toEqual({ classification: "FRIENDLY", source: "radars" });
  });

  it("is applied per system track, with override and engageability", () => {
    const f = newFusion();
    f.update([
      air("RDR-01", "T-0001", here, { iff: "ENEMY", likelihood: 0.9 }),
      air("RDR-01", "T-0002", destination(here, 90, 5_000), { iff: "ENEMY", likelihood: 0.3 }),
      air("RDR-01", "T-0003", destination(here, 270, 5_000), { iff: "FRIENDLY" }),
    ]);
    const byId = () => Object.fromEntries(f.view().map((t) => [t.trackId, t]));
    expect(byId()["S-0001"]).toMatchObject({ classification: "ENEMY", engageable: true });
    // An enemy that's probably a bird isn't engageable.
    expect(byId()["S-0002"]).toMatchObject({ classification: "ENEMY", engageable: false });
    expect(byId()["S-0003"]).toMatchObject({ classification: "FRIENDLY", engageable: false });

    // The operator overrides a reported friend to enemy...
    expect(f.setOverride("S-0003", "ENEMY")).toBe(true);
    expect(byId()["S-0003"]).toMatchObject({
      classification: "ENEMY",
      classificationSource: "operator",
      engageable: true,
    });
    // ...the override survives new sweeps, and clearing hands it back to the radars.
    f.update([air("RDR-01", "T-0003", destination(here, 270, 5_000), { iff: "FRIENDLY" })]);
    expect(byId()["S-0003"]).toMatchObject({ classification: "ENEMY" });
    f.setOverride("S-0003", null);
    expect(byId()["S-0003"]).toMatchObject({
      classification: "FRIENDLY",
      classificationSource: "radars",
    });
    expect(f.setOverride("S-9999", "ENEMY")).toBe(false);
  });
});
