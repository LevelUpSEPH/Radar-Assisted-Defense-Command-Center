// What the radars currently report (DESIGN.md §4): each radar's latest
// `tracks` message, kept as is, plus a short trail of where each track was
// reported in recent sweeps. Fusing tracks from overlapping radars into system
// tracks comes in a later piece; this is the raw picture it will use.

import type { LatLon, RadarTrack } from "@tdts/shared";
import type { AirTrack } from "../protocol";

/** A radar that hasn't reported for this long is treated as showing nothing. */
export const RADAR_REPORT_STALE_MS = 5_000;
/** How many recent reported positions each track's trail keeps. */
export const TRAIL_LENGTH = 10;

interface RadarReport {
  scanAt: number;
  receivedAt: number;
  tracks: RadarTrack[];
  /** Per radarTrackId: reported positions, oldest first. */
  trails: Map<string, LatLon[]>;
}

export class AirPicture {
  private readonly reports = new Map<string, RadarReport>();

  /** A radar's newest sweep replaces its previous one entirely. */
  report(unitId: string, scanAt: number, tracks: RadarTrack[], now: number): void {
    const previous = this.reports.get(unitId);
    // Messages can't overtake each other on one socket, but a reconnecting
    // radar could still deliver an older sweep: never go back in time.
    if (previous && scanAt < previous.scanAt) return;

    // Extend the trails of tracks that are still there; tracks the radar
    // dropped take their trails with them.
    const trails = new Map<string, LatLon[]>();
    for (const t of tracks) {
      const trail = [...(previous?.trails.get(t.radarTrackId) ?? [])];
      const last = trail[trail.length - 1];
      if (!last || last.lat !== t.position.lat || last.lon !== t.position.lon) {
        trail.push(t.position);
      }
      trails.set(t.radarTrackId, trail.slice(-TRAIL_LENGTH));
    }
    this.reports.set(unitId, { scanAt, receivedAt: now, tracks, trails });
  }

  /** The radar went away (disconnected, timed out, key deleted): drop what it saw. */
  forget(unitId: string): void {
    this.reports.delete(unitId);
  }

  /** Every track of every radar that reported recently, tagged with its radar. */
  tracks(now: number): AirTrack[] {
    const all: AirTrack[] = [];
    for (const [unitId, r] of this.reports) {
      if (now - r.receivedAt > RADAR_REPORT_STALE_MS) continue;
      for (const t of r.tracks) {
        all.push({ ...t, unitId, trail: r.trails.get(t.radarTrackId) ?? [t.position] });
      }
    }
    return all;
  }
}
