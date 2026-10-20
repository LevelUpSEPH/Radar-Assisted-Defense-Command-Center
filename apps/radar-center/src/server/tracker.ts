// Turns raw scan detections into tracks (DESIGN.md §4). Pure logic: the
// random source is injectable so tests are repeatable.
//
// Per object, each scan:
//   1. measurement noise: the true position moved up to positionNoiseM in a random direction
//   2. trajectory: a least-squares straight line through the last TRACK_WINDOW noisy
//      positions gives velocity (speed + heading) and a smoothed current position
//   3. drone likelihood: signature and how vehicle-like the speed is, smoothed over scans

import {
  bearingDeg,
  destination,
  EARTH_RADIUS_M,
  normalizeBearing,
  RADAR_TRACK_DROP_SCANS,
  type Detection,
  type LatLon,
} from "@tdts/shared";

/** How many recent positions the trajectory fit uses. */
export const TRACK_WINDOW = 10;
/** Below this a speed looks like a bird; above SPEED_VEHICLE it looks like a vehicle. */
const SPEED_BIRD_MPS = 10;
const SPEED_VEHICLE_MPS = 30;
const LIKELIHOOD_JITTER = 0.05;
/** Weight of the newest scan in the likelihood's moving average. */
const LIKELIHOOD_SMOOTHING = 0.3;

export interface TrackView {
  radarTrackId: string;
  /** Smoothed current position (raw while there are fewer than 3 points). */
  position: LatLon;
  altitudeM: number;
  /** 0 until the track has 2 points. */
  speedMps: number;
  headingDeg: number;
  /** 0..1: how likely this is a flying vehicle rather than a bird or clutter. */
  likelihood: number;
  /** Recent noisy positions, oldest first: what the radar actually measured. */
  trail: LatLon[];
  /** When the newest position was measured, epoch ms. */
  observedAt: number;
  /** Scans in a row this object was not seen (dropped at RADAR_TRACK_DROP_SCANS). */
  missedScans: number;
}

interface Sample {
  position: LatLon;
  at: number;
}

interface Track {
  id: string;
  truthId: string;
  samples: Sample[];
  altitudeM: number;
  likelihood: number | null;
  missedScans: number;
}

export interface TrackerOptions {
  positionNoiseM: number;
  /** Random source in [0, 1); injectable for tests. */
  random?: () => number;
}

export class Tracker {
  private readonly noiseM: number;
  private readonly random: () => number;
  /** Keyed by the world's truthId, which only links scans together and never leaves the radar. */
  private readonly tracks = new Map<string, Track>();
  private counter = 0;

  constructor({ positionNoiseM, random = Math.random }: TrackerOptions) {
    this.noiseM = positionNoiseM;
    this.random = random;
  }

  /** Feeds one scan. `observedAt` is the time the positions were true. */
  update(detections: readonly Detection[], observedAt: number): void {
    const seen = new Set<string>();

    for (const d of detections) {
      seen.add(d.truthId);
      let track = this.tracks.get(d.truthId);
      if (!track) {
        track = {
          id: `T-${String(++this.counter).padStart(4, "0")}`,
          truthId: d.truthId,
          samples: [],
          altitudeM: d.altitudeM,
          likelihood: null,
          missedScans: 0,
        };
        this.tracks.set(d.truthId, track);
      }

      track.samples.push({ position: this.addNoise(d.position), at: observedAt });
      if (track.samples.length > TRACK_WINDOW) track.samples.shift();
      track.altitudeM = d.altitudeM;
      track.missedScans = 0;

      const raw = this.rawLikelihood(
        d.signature,
        fitTrack(track.samples).speedMps,
        track.samples.length,
      );
      track.likelihood =
        track.likelihood === null
          ? raw
          : track.likelihood + LIKELIHOOD_SMOOTHING * (raw - track.likelihood);
    }

    for (const [truthId, track] of this.tracks) {
      if (seen.has(truthId)) continue;
      if (++track.missedScans >= RADAR_TRACK_DROP_SCANS) this.tracks.delete(truthId);
    }
  }

  /** Current tracks, oldest first. */
  view(): TrackView[] {
    return [...this.tracks.values()].map((t) => {
      const fit = fitTrack(t.samples);
      const last = t.samples[t.samples.length - 1]!;
      return {
        radarTrackId: t.id,
        position: fit.position,
        altitudeM: t.altitudeM,
        speedMps: fit.speedMps,
        headingDeg: fit.headingDeg,
        likelihood: t.likelihood ?? 0,
        trail: t.samples.map((s) => s.position),
        observedAt: last.at,
        missedScans: t.missedScans,
      };
    });
  }

  /** The world's id for one of our tracks (needed later to report a hit). */
  truthIdOf(radarTrackId: string): string | null {
    for (const t of this.tracks.values()) if (t.id === radarTrackId) return t.truthId;
    return null;
  }

  private addNoise(p: LatLon): LatLon {
    if (this.noiseM === 0) return { ...p };
    return destination(p, this.random() * 360, this.random() * this.noiseM);
  }

  private rawLikelihood(signature: number, speedMps: number, points: number): number {
    // With a single point the speed is unknown; count it as neither bird nor vehicle.
    const speedScore = points < 2 ? 0.5 : vehicleSpeedScore(speedMps);
    const jitter = (this.random() * 2 - 1) * LIKELIHOOD_JITTER;
    return clamp01(0.6 * signature + 0.4 * speedScore + jitter);
  }
}

/** 0 at bird speeds, 1 at vehicle speeds, linear in between. */
export function vehicleSpeedScore(speedMps: number): number {
  return clamp01((speedMps - SPEED_BIRD_MPS) / (SPEED_VEHICLE_MPS - SPEED_BIRD_MPS));
}

/**
 * Least-squares straight-line fit of position over time. Positions are put on
 * a flat local grid (meters east/north of the first sample), which is accurate
 * at radar ranges. Returns the fitted position at the newest sample's time.
 */
export function fitTrack(samples: readonly Sample[]): {
  position: LatLon;
  speedMps: number;
  headingDeg: number;
} {
  const last = samples[samples.length - 1]!;
  if (samples.length < 2) return { position: last.position, speedMps: 0, headingDeg: 0 };
  if (samples.length === 2) {
    const [a, b] = samples as [Sample, Sample];
    const dt = (b.at - a.at) / 1000;
    const local = toLocal(a.position, b.position);
    return {
      position: b.position,
      speedMps: dt > 0 ? Math.hypot(local.x, local.y) / dt : 0,
      headingDeg: bearingDeg(a.position, b.position),
    };
  }

  const origin = samples[0]!.position;
  const t0 = samples[0]!.at;
  const pts = samples.map((s) => ({ t: (s.at - t0) / 1000, ...toLocal(origin, s.position) }));
  const n = pts.length;
  const meanT = pts.reduce((sum, p) => sum + p.t, 0) / n;
  const meanX = pts.reduce((sum, p) => sum + p.x, 0) / n;
  const meanY = pts.reduce((sum, p) => sum + p.y, 0) / n;
  let stt = 0;
  let stx = 0;
  let sty = 0;
  for (const p of pts) {
    stt += (p.t - meanT) ** 2;
    stx += (p.t - meanT) * (p.x - meanX);
    sty += (p.t - meanT) * (p.y - meanY);
  }
  if (stt === 0) return { position: last.position, speedMps: 0, headingDeg: 0 };

  const vx = stx / stt; // m/s east
  const vy = sty / stt; // m/s north
  const tLast = pts[n - 1]!.t;
  const fitted = fromLocal(origin, meanX + vx * (tLast - meanT), meanY + vy * (tLast - meanT));
  return {
    position: fitted,
    speedMps: Math.hypot(vx, vy),
    headingDeg: normalizeBearing((Math.atan2(vx, vy) * 180) / Math.PI),
  };
}

const RAD = Math.PI / 180;

function toLocal(origin: LatLon, p: LatLon): { x: number; y: number } {
  return {
    x: (p.lon - origin.lon) * RAD * EARTH_RADIUS_M * Math.cos(origin.lat * RAD),
    y: (p.lat - origin.lat) * RAD * EARTH_RADIUS_M,
  };
}

function fromLocal(origin: LatLon, x: number, y: number): LatLon {
  return {
    lat: origin.lat + y / (EARTH_RADIUS_M * RAD),
    lon: origin.lon + x / (EARTH_RADIUS_M * RAD * Math.cos(origin.lat * RAD)),
  };
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
