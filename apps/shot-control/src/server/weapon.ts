// The weapon's state machine (DESIGN.md §3–4). Pure logic: time is passed in,
// and what the weapon has to tell the Command Center comes back as events.
//
//   IDLE ─prepare→ PREPARING ─(prepare time)→ READY ─fire→ FIRING ─(fire time)→ RELOADING ─(reload time)→ IDLE
//   PREPARING, READY and FIRING can be cancelled back to IDLE; nothing is fired.
//   When the last round is fired, RELOADING ends in EMPTY instead of IDLE.
//
// The firing solution is the weapon's own: the earliest intercept for its
// position, ranges and shell speed, recomputed with every track update while
// it waits for its fire time. A computed shot always hits.

import {
  BUSY_STATES,
  findEarliestIntercept,
  type InterceptSolution,
  type LatLon,
  type PayloadOf,
  type SystemTrack,
  type ToCommandCenter,
  type WeaponState,
} from "@tdts/shared";

export interface WeaponSpec {
  position: LatLon;
  minRangeM: number;
  maxRangeM: number;
  ammo: number;
  prepareTimeS: number;
  reloadTimeS: number;
  shellSpeedMps: number;
}

/** What the weapon reports to the Command Center besides its status. */
export type WeaponEvent =
  | { type: "shotFired"; payload: PayloadOf<ToCommandCenter, "shotFired"> }
  | { type: "fireFailed"; payload: PayloadOf<ToCommandCenter, "fireFailed"> };

export type WeaponStatus = PayloadOf<ToCommandCenter, "status">;

interface Engagement {
  id: string;
  track: SystemTrack;
  /** Set once `fire` arrives: where and when this weapon will shoot. */
  solution: InterceptSolution | null;
}

export interface Ranges {
  minRangeM: number;
  maxRangeM: number;
}

/** A command the weapon can't follow right now; the caller logs it. */
export class WeaponCommandError extends Error {}

export class Weapon {
  private state: WeaponState;
  private ammo: number;
  private engagement: Engagement | null = null;
  /** When the current PREPARING / RELOADING phase ends, epoch ms. */
  private until: number | null = null;
  /** The last shot, for the operator's page. */
  private lastShot: PayloadOf<ToCommandCenter, "shotFired"> | null = null;
  /** Starts from the config; the operator can change it (`setRanges`). */
  private current: Ranges;

  constructor(private readonly spec: WeaponSpec) {
    this.ammo = spec.ammo;
    this.current = { minRangeM: spec.minRangeM, maxRangeM: spec.maxRangeM };
    this.state = spec.ammo > 0 ? "IDLE" : "EMPTY";
  }

  // ------------------------------------------------------------- commands

  prepare(engagementId: string, track: SystemTrack, now: number): void {
    if (this.state !== "IDLE") {
      throw new WeaponCommandError(`can't prepare while ${this.state}`);
    }
    this.engagement = { id: engagementId, track, solution: null };
    this.state = "PREPARING";
    this.until = now + this.spec.prepareTimeS * 1000;
  }

  /** Newer data about the target; used for the next (or the pending) solution. */
  updateTrack(engagementId: string, track: SystemTrack, now: number): WeaponEvent[] {
    if (this.engagement?.id !== engagementId) {
      throw new WeaponCommandError(`not engaged in ${engagementId}`);
    }
    this.engagement.track = track;
    // While waiting to fire, follow the target: aim with the latest data.
    return this.state === "FIRING" ? this.aim(now) : [];
  }

  fire(engagementId: string, now: number): WeaponEvent[] {
    if (this.state !== "READY" || this.engagement?.id !== engagementId) {
      throw new WeaponCommandError(`can't fire ${engagementId} while ${this.state}`);
    }
    this.state = "FIRING";
    return [...this.aim(now), ...this.tick(now)];
  }

  cancel(engagementId: string): void {
    if (this.engagement?.id !== engagementId) {
      throw new WeaponCommandError(`not engaged in ${engagementId}`);
    }
    if (this.state === "RELOADING") {
      throw new WeaponCommandError("the shot is already fired");
    }
    this.engagement = null;
    this.state = "IDLE";
    this.until = null;
  }

  /**
   * New min/max range, from the weapon's page or the Command Center. An
   * engagement in progress keeps going; its next solution uses the new ranges.
   */
  setRanges({ minRangeM, maxRangeM }: Ranges): void {
    if (!(minRangeM >= 0 && minRangeM < maxRangeM)) {
      throw new WeaponCommandError("min range must be at least 0 and below max range");
    }
    this.current = { minRangeM, maxRangeM };
  }

  // ------------------------------------------------------------- time

  /** Advances timers; fires when the solution's fire time has come. */
  tick(now: number): WeaponEvent[] {
    switch (this.state) {
      case "PREPARING":
        if (this.until !== null && now >= this.until) {
          this.state = "READY";
          this.until = null;
        }
        return [];
      case "FIRING":
        return this.engagement?.solution && now >= this.engagement.solution.fireAt
          ? this.shoot(now)
          : [];
      case "RELOADING":
        if (this.until !== null && now >= this.until) {
          this.state = this.ammo > 0 ? "IDLE" : "EMPTY";
          this.until = null;
        }
        return [];
      default:
        return [];
    }
  }

  // ------------------------------------------------------------- read model

  ranges(): Ranges {
    return { ...this.current };
  }

  status(): WeaponStatus {
    return {
      state: this.state,
      ammo: this.ammo,
      minRangeM: this.current.minRangeM,
      maxRangeM: this.current.maxRangeM,
      engagementId: this.engagement?.id ?? null,
      stateUntil: this.until,
    };
  }

  /** For the operator's page: the engagement in progress and the last shot. */
  details(now: number) {
    return {
      busy: BUSY_STATES.includes(this.state),
      engagement: this.engagement
        ? {
            engagementId: this.engagement.id,
            trackId: this.engagement.track.trackId,
            track: this.engagement.track,
            solution: this.engagement.solution,
            predicted: this.engagement.solution ? null : this.predict(now),
          }
        : null,
      lastShot: this.lastShot,
    };
  }

  // ------------------------------------------------------------- internals

  /** Before `fire`: where the shell would meet the target once this weapon is ready. */
  private predict(now: number): InterceptSolution | null {
    const e = this.engagement!;
    const readyAt = this.state === "PREPARING" && this.until !== null ? this.until : now;
    return findEarliestIntercept({ ...this.spec, ...this.current }, e.track, { now, readyAt });
  }

  /** (Re)computes the firing solution; no solution means the target is out of reach. */
  private aim(now: number): WeaponEvent[] {
    const e = this.engagement!;
    e.solution = findEarliestIntercept({ ...this.spec, ...this.current }, e.track, {
      now,
      readyAt: now,
    });
    if (e.solution) return [];
    // Can't reach it: stay ready, and let the Command Center decide.
    this.state = "READY";
    return [{ type: "fireFailed", payload: { engagementId: e.id, reason: "NO_SOLUTION" } }];
  }

  private shoot(now: number): WeaponEvent[] {
    const e = this.engagement!;
    const solution = e.solution!;
    // Fire now (at most one tick after the planned moment); the shell flies
    // distance / speed and arrives where the target will be.
    const flightMs = (solution.distanceM / this.spec.shellSpeedMps) * 1000;
    const shot = {
      engagementId: e.id,
      firedAt: Math.round(now),
      impactAt: Math.round(now + flightMs),
      impactPoint: solution.impactPoint,
    };
    this.ammo -= 1;
    this.lastShot = shot;
    this.engagement = null;
    this.state = "RELOADING";
    this.until = now + this.spec.reloadTimeS * 1000;
    return [{ type: "shotFired", payload: shot }];
  }
}
