// Track fusion (DESIGN.md §4): radar tracks of the same object, from different
// radars, become one system track. Pure logic; the caller feeds it the current
// air picture.
//
//   - A radar track keeps its system track for as long as the radar reports it.
//   - A new radar track joins the nearest system track that is within
//     FUSION_GATE_M and flying within FUSION_HEADING_GATE_DEG of the same
//     heading, and has no track from that radar yet. Otherwise it starts a new
//     system track.
//   - A system track lives while at least one radar reports it.
//   - Fused values: each radar's report is first projected to the newest
//     report's time (radars sweep at different moments), then averaged;
//     likelihood is the highest; the classification follows §5.

import {
  bearingDifference,
  distanceM,
  extrapolate,
  FUSION_GATE_M,
  FUSION_HEADING_GATE_DEG,
  normalizeBearing,
  type Iff,
  type LatLon,
} from "@tdts/shared";
import type { AirTrack, SystemTrackView } from "../protocol";
import { classify } from "./classification";

/** Below this speed a heading means little, so the heading gate isn't applied. */
const HEADING_GATE_MIN_SPEED_MPS = 5;
/** How many recent fused positions each system track's trail keeps. */
const TRAIL_LENGTH = 10;

type SourceKey = string;
const keyOf = (t: AirTrack): SourceKey => `${t.unitId}/${t.radarTrackId}`;

interface SystemTrackState {
  id: string;
  sources: Set<SourceKey>;
  override: Iff | null;
  trail: LatLon[];
}

interface Fused {
  position: LatLon;
  altitudeM: number;
  speedMps: number;
  headingDeg: number;
  likelihood: number;
  observedAt: number;
}

export interface FusionOptions {
  /** Enemy tracks at or above this drone likelihood are engageable. */
  minLikelihoodToEngage: number;
}

export class Fusion {
  private readonly tracks = new Map<string, SystemTrackState>();
  private readonly owner = new Map<SourceKey, string>();
  /** The latest report of every radar track that is currently linked. */
  private latest = new Map<SourceKey, AirTrack>();
  private counter = 0;

  constructor(private readonly opts: FusionOptions) {}

  /** Feeds the current air picture: every track every radar reports right now. */
  update(air: readonly AirTrack[]): void {
    this.latest = new Map(air.map((t) => [keyOf(t), t]));

    // Radar tracks that are gone leave their system track; empty ones go.
    for (const [key, id] of this.owner) {
      if (this.latest.has(key)) continue;
      this.owner.delete(key);
      this.tracks.get(id)?.sources.delete(key);
    }
    for (const [id, st] of this.tracks) if (st.sources.size === 0) this.tracks.delete(id);

    // New radar tracks join a matching system track or start one.
    for (const t of air) {
      const key = keyOf(t);
      if (this.owner.has(key)) continue;
      const match = this.findMatch(t);
      const st = match ?? this.create();
      st.sources.add(key);
      this.owner.set(key, st.id);
    }

    for (const st of this.tracks.values()) {
      const p = this.fuse(st).position;
      const last = st.trail[st.trail.length - 1];
      if (!last || last.lat !== p.lat || last.lon !== p.lon) st.trail.push(p);
      if (st.trail.length > TRAIL_LENGTH) st.trail.splice(0, st.trail.length - TRAIL_LENGTH);
    }
  }

  /**
   * The operator decides a track's classification; null hands it back to the
   * radar reports. Returns false if there's no such track.
   */
  setOverride(trackId: string, classification: Iff | null): boolean {
    const st = this.tracks.get(trackId);
    if (!st) return false;
    st.override = classification;
    return true;
  }

  view(): SystemTrackView[] {
    return [...this.tracks.values()].map((st) => {
      const fused = this.fuse(st);
      const sources = this.sourcesOf(st).map((t) => ({
        unitId: t.unitId,
        radarTrackId: t.radarTrackId,
        iff: t.iff,
        likelihood: t.likelihood,
      }));
      const { classification, source } = classify(
        sources.map((s) => s.iff),
        st.override,
      );
      return {
        trackId: st.id,
        ...fused,
        sources,
        classification,
        classificationSource: source,
        engageable:
          classification === "ENEMY" && fused.likelihood >= this.opts.minLikelihoodToEngage,
        trail: [...st.trail],
      };
    });
  }

  // ------------------------------------------------------------- internals

  private create(): SystemTrackState {
    const st: SystemTrackState = {
      id: `S-${String(++this.counter).padStart(4, "0")}`,
      sources: new Set(),
      override: null,
      trail: [],
    };
    this.tracks.set(st.id, st);
    return st;
  }

  private sourcesOf(st: SystemTrackState): AirTrack[] {
    return [...st.sources].map((k) => this.latest.get(k)).filter((t) => t !== undefined);
  }

  private findMatch(t: AirTrack): SystemTrackState | null {
    let best: { st: SystemTrackState; d: number } | null = null;
    for (const st of this.tracks.values()) {
      const sources = this.sourcesOf(st);
      // One track per radar per system track: a radar never sees one object twice.
      if (sources.length === 0 || sources.some((s) => s.unitId === t.unitId)) continue;

      const fused = this.fuse(st);
      const there = extrapolate(
        fused.position,
        fused.speedMps,
        fused.headingDeg,
        (t.observedAt - fused.observedAt) / 1000,
      );
      const d = distanceM(there, t.position);
      if (d > FUSION_GATE_M) continue;
      const bothMoving =
        fused.speedMps >= HEADING_GATE_MIN_SPEED_MPS && t.speedMps >= HEADING_GATE_MIN_SPEED_MPS;
      if (
        bothMoving &&
        bearingDifference(fused.headingDeg, t.headingDeg) > FUSION_HEADING_GATE_DEG
      ) {
        continue;
      }
      if (!best || d < best.d) best = { st, d };
    }
    return best?.st ?? null;
  }

  private fuse(st: SystemTrackState): Fused {
    const sources = this.sourcesOf(st);
    const newest = Math.max(...sources.map((s) => s.observedAt));
    let lat = 0;
    let lon = 0;
    let alt = 0;
    let vx = 0;
    let vy = 0;
    let likelihood = 0;
    for (const s of sources) {
      const p = extrapolate(s.position, s.speedMps, s.headingDeg, (newest - s.observedAt) / 1000);
      lat += p.lat;
      lon += p.lon;
      alt += s.altitudeM;
      vx += s.speedMps * Math.sin((s.headingDeg * Math.PI) / 180);
      vy += s.speedMps * Math.cos((s.headingDeg * Math.PI) / 180);
      likelihood = Math.max(likelihood, s.likelihood);
    }
    const n = sources.length;
    return {
      position: { lat: lat / n, lon: lon / n },
      altitudeM: alt / n,
      speedMps: Math.hypot(vx / n, vy / n),
      headingDeg: normalizeBearing((Math.atan2(vx, vy) * 180) / Math.PI),
      likelihood,
      observedAt: newest,
    };
  }
}
