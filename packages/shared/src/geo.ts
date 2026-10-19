// Great-circle geometry on a spherical Earth. Accurate to well under 0.5% at
// the distances this simulation uses (< a few hundred km), which is plenty.

export interface LatLon {
  lat: number;
  lon: number;
}

/** Mean Earth radius (IUGG), meters. */
export const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Wraps any angle into [0, 360). */
export function normalizeBearing(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Smallest absolute difference between two bearings, in [0, 180]. */
export function bearingDifference(a: number, b: number): number {
  const d = Math.abs(normalizeBearing(a) - normalizeBearing(b));
  return d > 180 ? 360 - d : d;
}

/** Haversine distance between two points, meters. */
export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees clockwise from north, in [0, 360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return normalizeBearing(toDeg(Math.atan2(y, x)));
}

/** Point reached by travelling `distM` meters from `from` on initial bearing `bearing`. */
export function destination(from: LatLon, bearing: number, distM: number): LatLon {
  const delta = distM / EARTH_RADIUS_M;
  const theta = toRad(bearing);
  const lat1 = toRad(from.lat);
  const lon1 = toRad(from.lon);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(delta) + Math.cos(lat1) * Math.sin(delta) * Math.cos(theta),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(lat1),
      Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: toDeg(lat2), lon: normalizeLon(toDeg(lon2)) };
}

/**
 * Within this distance of the goal counts as arrived, so floating-point drift
 * over many small steps can't leave a mover a hair short forever.
 */
const ARRIVAL_TOLERANCE_M = 0.5;

/**
 * Moves `distM` meters from `from` towards `to`. If that would reach or pass
 * `to` (within ARRIVAL_TOLERANCE_M), returns `to` exactly and `arrived: true`.
 */
export function moveTowards(
  from: LatLon,
  to: LatLon,
  distM: number,
): { position: LatLon; arrived: boolean } {
  const remaining = distanceM(from, to);
  if (distM >= remaining - ARRIVAL_TOLERANCE_M) return { position: { ...to }, arrived: true };
  return { position: destination(from, bearingDeg(from, to), distM), arrived: false };
}

/**
 * Dead-reckons a constant-velocity track `dtS` seconds ahead (negative values
 * go back in time).
 */
export function extrapolate(
  position: LatLon,
  speedMps: number,
  headingDeg: number,
  dtS: number,
): LatLon {
  const dist = speedMps * dtS;
  return dist >= 0
    ? destination(position, headingDeg, dist)
    : destination(position, headingDeg + 180, -dist);
}

function normalizeLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}
