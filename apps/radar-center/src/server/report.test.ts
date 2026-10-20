import { parseMessage, ToCommandCenterSchema } from "@tdts/shared";
import { describe, expect, it } from "vitest";
import { reportedTrack, tracksMessage } from "./report";
import type { TrackView } from "./tracker";

const view: TrackView = {
  radarTrackId: "T-0001",
  position: { lat: 47.5, lon: 8.5 },
  altitudeM: 400,
  speedMps: 98.7,
  headingDeg: 194.2,
  likelihood: 0.93,
  answersIff: false,
  marking: null,
  trail: [{ lat: 47.51, lon: 8.5 }],
  observedAt: 1_700_000_000_000,
  missedScans: 1,
};

describe("track reports", () => {
  it("send only what a radar measures, plus its IFF suggestion", () => {
    expect(reportedTrack(view)).toEqual({
      radarTrackId: "T-0001",
      position: { lat: 47.5, lon: 8.5 },
      altitudeM: 400,
      speedMps: 98.7,
      headingDeg: 194.2,
      likelihood: 0.93,
      iff: "UNKNOWN",
      observedAt: 1_700_000_000_000,
    });
    expect(reportedTrack({ ...view, answersIff: true }).iff).toBe("FRIENDLY");
  });

  it("let the operator's marking win over the IFF reply", () => {
    expect(reportedTrack({ ...view, answersIff: true, marking: "ENEMY" }).iff).toBe("ENEMY");
    expect(reportedTrack({ ...view, marking: "FRIENDLY" }).iff).toBe("FRIENDLY");
    expect(reportedTrack({ ...view, answersIff: true, marking: "UNKNOWN" }).iff).toBe("UNKNOWN");
  });

  it("build a tracks message the Command Center accepts", () => {
    const msg = tracksMessage(1_700_000_000_000, [view]);
    expect(parseMessage(ToCommandCenterSchema, JSON.stringify(msg))).toMatchObject({ ok: true });
  });
});
