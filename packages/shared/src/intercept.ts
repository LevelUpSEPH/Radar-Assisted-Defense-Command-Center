// Earliest-intercept search (DESIGN.md §7.4). Used by the Command Center to
// choose a weapon and by the weapon itself to compute its firing solution.

import { INTERCEPT_HORIZON_S, INTERCEPT_STEP_S } from "./constants";
import { distanceM, extrapolate, type LatLon } from "./geo";

export interface InterceptWeapon {
  position: LatLon;
  minRangeM: number;
  maxRangeM: number;
  shellSpeedMps: number;
}

export interface InterceptTarget {
  position: LatLon;
  speedMps: number;
  headingDeg: number;
  /** When `position` was measured, epoch ms. */
  observedAt: number;
}

export interface InterceptOptions {
  /** Current time, epoch ms. */
  now: number;
  /** Earliest moment the weapon can fire, epoch ms (now + prepare time if not READY). */
  readyAt: number;
  stepS?: number;
  horizonS?: number;
}

export interface InterceptSolution {
  /** When the shell must leave the barrel, epoch ms. */
  fireAt: number;
  /** When the shell lands, epoch ms. */
  impactAt: number;
  impactPoint: LatLon;
  distanceM: number;
}

/**
 * Finds the earliest impact time T at which the target's predicted position is
 * inside the weapon's range ring and the shell, flying for distance / speed,
 * would have to be fired no earlier than `readyAt`.
 *
 * Returns null if no such moment exists within the horizon, or if the target
 * leaves the weapon's range for good before one does.
 */
export function findEarliestIntercept(
  weapon: InterceptWeapon,
  target: InterceptTarget,
  { now, readyAt, stepS = INTERCEPT_STEP_S, horizonS = INTERCEPT_HORIZON_S }: InterceptOptions,
): InterceptSolution | null {
  const stepMs = stepS * 1000;
  const endMs = now + horizonS * 1000;
  let wasInRange = false;

  for (let impactAt = now; impactAt <= endMs; impactAt += stepMs) {
    const impactPoint = extrapolate(
      target.position,
      target.speedMps,
      target.headingDeg,
      (impactAt - target.observedAt) / 1000,
    );
    const d = distanceM(weapon.position, impactPoint);

    if (d < weapon.minRangeM || d > weapon.maxRangeM) {
      // A straight-line target passes through the ring at most once on the way
      // out; once it has left beyond max range it won't come back.
      if (wasInRange && d > weapon.maxRangeM) return null;
      continue;
    }
    wasInRange = true;

    const fireAt = impactAt - (d / weapon.shellSpeedMps) * 1000;
    if (fireAt >= readyAt) return { fireAt, impactAt, impactPoint, distanceM: d };
  }
  return null;
}
