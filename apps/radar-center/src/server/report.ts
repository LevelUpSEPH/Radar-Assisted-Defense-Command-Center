// What the radar tells the Command Center about its tracks (DESIGN.md §4,
// step 7): what a radar can measure plus its IFF suggestion. The world's
// truthId, the raw trail and the missed-scan count stay on the radar.

import { createMessage, type Iff, type RadarTrack, type ToCommandCenter } from "@tdts/shared";
import type { TrackView } from "./tracker";

export function reportedTrack(t: TrackView): RadarTrack {
  return {
    radarTrackId: t.radarTrackId,
    position: t.position,
    altitudeM: t.altitudeM,
    speedMps: t.speedMps,
    headingDeg: t.headingDeg,
    likelihood: t.likelihood,
    iff: iffReport(t),
    observedAt: t.observedAt,
  };
}

/**
 * What the radar reports about friend or foe: the operator's marking if there
 * is one, otherwise what the IFF interrogation told it (friendly if the
 * object answered). Either way it's a report; the Command Center decides.
 */
export function iffReport(t: Pick<TrackView, "marking" | "answersIff">): Iff {
  return t.marking ?? (t.answersIff ? "FRIENDLY" : "UNKNOWN");
}

/** The `tracks` message for one sweep: every current track, also those briefly not seen. */
export function tracksMessage(scanAt: number, tracks: readonly TrackView[]) {
  return createMessage<ToCommandCenter, "tracks">("tracks", {
    scanAt,
    tracks: tracks.map(reportedTrack),
  });
}
