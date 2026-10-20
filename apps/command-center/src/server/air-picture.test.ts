import type { RadarTrack } from "@tdts/shared";
import { describe, expect, it } from "vitest";
import { AirPicture, RADAR_REPORT_STALE_MS, TRAIL_LENGTH } from "./air-picture";

const T0 = 1_700_000_000_000;

const track = (id: string, lat = 47.5): RadarTrack => ({
  radarTrackId: id,
  position: { lat, lon: 8.5 },
  altitudeM: 400,
  speedMps: 100,
  headingDeg: 194,
  likelihood: 0.9,
  iff: "UNKNOWN",
  observedAt: T0,
});

describe("AirPicture", () => {
  it("tags each radar's tracks with the radar", () => {
    const p = new AirPicture();
    p.report("RDR-01", T0, [track("T-0001"), track("T-0002")], T0);
    p.report("RDR-02", T0, [track("T-0001")], T0);
    expect(p.tracks(T0).map((t) => `${t.unitId}/${t.radarTrackId}`)).toEqual([
      "RDR-01/T-0001",
      "RDR-01/T-0002",
      "RDR-02/T-0001",
    ]);
  });

  it("replaces a radar's picture with its newest sweep", () => {
    const p = new AirPicture();
    p.report("RDR-01", T0, [track("T-0001"), track("T-0002")], T0);
    p.report("RDR-01", T0 + 1_000, [track("T-0002")], T0 + 1_000);
    expect(p.tracks(T0 + 1_000).map((t) => t.radarTrackId)).toEqual(["T-0002"]);
  });

  it("ignores a sweep older than the one it has", () => {
    const p = new AirPicture();
    p.report("RDR-01", T0 + 1_000, [track("T-0002")], T0 + 1_000);
    p.report("RDR-01", T0, [track("T-0001")], T0 + 1_100);
    expect(p.tracks(T0 + 1_100).map((t) => t.radarTrackId)).toEqual(["T-0002"]);
  });

  it("drops a radar that went quiet or away", () => {
    const p = new AirPicture();
    p.report("RDR-01", T0, [track("T-0001")], T0);
    p.report("RDR-02", T0, [track("T-0001")], T0);
    expect(p.tracks(T0 + RADAR_REPORT_STALE_MS + 1)).toEqual([]);
    p.report("RDR-01", T0 + 1, [track("T-0001")], T0 + 1);
    p.forget("RDR-01");
    expect(p.tracks(T0 + 2).map((t) => t.unitId)).toEqual(["RDR-02"]);
  });

  it("builds a trail per track from successive sweeps, and drops it with the track", () => {
    const p = new AirPicture();
    for (let i = 0; i < TRAIL_LENGTH + 3; i++) {
      p.report("RDR-01", T0 + i, [track("T-0001", 47.5 + i * 0.01)], T0 + i);
    }
    const [t] = p.tracks(T0 + TRAIL_LENGTH + 3);
    expect(t!.trail).toHaveLength(TRAIL_LENGTH);
    expect(t!.trail[TRAIL_LENGTH - 1]).toEqual(t!.position);

    p.report("RDR-01", T0 + 100, [track("T-0002")], T0 + 100);
    p.report("RDR-01", T0 + 101, [track("T-0001", 48)], T0 + 101);
    expect(p.tracks(T0 + 101)[0]!.trail).toEqual([{ lat: 48, lon: 8.5 }]);
  });

  it("doesn't repeat a position the radar reports twice (a missed sweep)", () => {
    const p = new AirPicture();
    p.report("RDR-01", T0, [track("T-0001")], T0);
    p.report("RDR-01", T0 + 1, [track("T-0001")], T0 + 1);
    expect(p.tracks(T0 + 1)[0]!.trail).toHaveLength(1);
  });
});
