// Engagements (DESIGN.md §6–9): which weapon takes which target, and the
// conversation with it until the radars confirm the kill. Pure logic: time is
// passed in, and what has to be sent comes back as commands for the caller.
//
//   PREPARING → (weapon READY) → AWAITING_APPROVAL → (approve) → FIRING
//                              ↘ (auto fire mode) ────────────↗
//   FIRING → (shotFired) → IN_FLIGHT → (shell arrives) → CONFIRMING → KILL | UNCONFIRMED
//   Before the shot, anything can end in CANCELLED.
//
// The operator (here or at the weapon) can stop an engagement before the shot:
// its target is then held, not engaged again until the operator resumes it.
// Restarting ends the engagement and prepares the same weapon again from zero.

import {
  createMessage,
  findEarliestIntercept,
  KILL_CHECK_DELAY_MS,
  KILL_CHECK_TIMEOUT_MS,
  type FromCommandCenter,
  type LatLon,
  type PayloadOf,
  type SystemTrack,
  type ToCommandCenter,
  type WeaponStatus,
} from "@tdts/shared";
import type {
  EngagementState,
  EngagementView,
  FireMode,
  SystemTrackView,
  TrackSource,
} from "../protocol";

/** A weapon that couldn't solve a track isn't offered that track again for this long. */
const FAILED_PAIR_COOLDOWN_MS = 30_000;
/** How many finished engagements the operator still sees. */
const HISTORY = 10;

/** What the planner needs to know about an online weapon. */
export interface WeaponInfo {
  unitId: string;
  position: LatLon;
  prepareTimeS: number;
  shellSpeedMps: number;
  status: WeaponStatus;
}

/** Something to send to a unit. */
export interface Command {
  to: string;
  msg: FromCommandCenter;
}

interface Engagement {
  id: string;
  trackId: string;
  weaponUnitId: string;
  state: EngagementState;
  createdAt: number;
  since: number;
  readyAt: number | null;
  shot: PayloadOf<ToCommandCenter, "shotFired"> | null;
  /** Before the shot: where and when the shell is expected to meet the target. */
  predicted: { impactAt: number; impactPoint: LatLon } | null;
  /** The radar tracks behind the target, kept so the kill can be confirmed even if the track is gone. */
  sources: TrackSource[];
  /** Radars asked to confirm, and whether any said "destroyed". */
  asked: Set<string>;
  reason: string | null;
}

const ACTIVE: readonly EngagementState[] = [
  "PREPARING",
  "AWAITING_APPROVAL",
  "FIRING",
  "IN_FLIGHT",
  "CONFIRMING",
];
/** States in which nothing has been fired yet, so the engagement can still be called off. */
const BEFORE_SHOT: readonly EngagementState[] = ["PREPARING", "AWAITING_APPROVAL", "FIRING"];

const msg = <T extends FromCommandCenter["type"]>(
  type: T,
  payload: PayloadOf<FromCommandCenter, T>,
): FromCommandCenter => createMessage<FromCommandCenter, T>(type, payload);

export const systemTrackOf = (t: SystemTrackView): SystemTrack => ({
  trackId: t.trackId,
  position: t.position,
  altitudeM: t.altitudeM,
  speedMps: t.speedMps,
  headingDeg: t.headingDeg,
  observedAt: t.observedAt,
});

/** Where the weapon's shell would meet the track, if the weapon is ready at `readyAt`. */
function predict(
  weapon: WeaponInfo,
  track: SystemTrackView,
  now: number,
  readyAt: number | null,
): Engagement["predicted"] {
  const solution = findEarliestIntercept(
    {
      position: weapon.position,
      minRangeM: weapon.status.minRangeM,
      maxRangeM: weapon.status.maxRangeM,
      shellSpeedMps: weapon.shellSpeedMps,
    },
    track,
    { now, readyAt: Math.max(now, readyAt ?? now) },
  );
  return solution ? { impactAt: solution.impactAt, impactPoint: solution.impactPoint } : null;
}

export class Engagements {
  private readonly all = new Map<string, Engagement>();
  private counter = 0;
  /** `${weaponUnitId}/${trackId}` → until when that pair isn't tried again. */
  private readonly failedPairs = new Map<string, number>();
  /**
   * Tracks confirmed destroyed. Fusion keeps a track for a few seconds after
   * the radars lose it; it must not be engaged again in that time.
   */
  private readonly killed = new Set<string>();
  /** Tracks the operator stopped: not engaged again until resumed. */
  private readonly held = new Set<string>();

  constructor(public fireMode: FireMode) {}

  // ------------------------------------------------------------- the planning cycle

  /**
   * Runs once a second (and whenever tracks change): calls off engagements that
   * no longer make sense, keeps weapons aimed, starts kill checks, and assigns
   * free weapons to engageable enemies.
   */
  plan(now: number, tracks: readonly SystemTrackView[], weapons: readonly WeaponInfo[]): Command[] {
    const commands: Command[] = [];
    const trackById = new Map(tracks.map((t) => [t.trackId, t]));
    const weaponById = new Map(weapons.map((w) => [w.unitId, w]));

    for (const e of this.active()) {
      const track = trackById.get(e.trackId);
      if (track) e.sources = track.sources;

      if (BEFORE_SHOT.includes(e.state)) {
        const weapon = weaponById.get(e.weaponUnitId);
        if (!weapon) {
          this.end(e, "CANCELLED", now, "weapon went offline");
          continue;
        }
        if (!track || !track.engageable) {
          commands.push(this.cancelCommand(e));
          this.end(e, "CANCELLED", now, track ? "no longer an engageable enemy" : "track lost");
          continue;
        }
        e.predicted = predict(weapon, track, now, e.state === "PREPARING" ? e.readyAt : now);
        // Keep the weapon aimed with the latest fused track.
        commands.push({
          to: e.weaponUnitId,
          msg: msg("trackUpdate", { engagementId: e.id, track: systemTrackOf(track) }),
        });
      }

      if (e.state === "IN_FLIGHT" && e.shot && now >= e.shot.impactAt + KILL_CHECK_DELAY_MS) {
        commands.push(...this.startKillCheck(e, now));
      }
      if (e.state === "CONFIRMING" && now - e.since > KILL_CHECK_TIMEOUT_MS) {
        this.end(e, "UNCONFIRMED", now, "no radar confirmed in time");
      }
    }

    commands.push(...this.assign(now, tracks, weapons));
    return commands;
  }

  /** Free weapons to the engageable enemies they can hit soonest. */
  private assign(
    now: number,
    tracks: readonly SystemTrackView[],
    weapons: readonly WeaponInfo[],
  ): Command[] {
    for (const [pair, until] of this.failedPairs) if (until <= now) this.failedPairs.delete(pair);
    const present = new Set(tracks.map((t) => t.trackId));
    for (const id of this.killed) if (!present.has(id)) this.killed.delete(id);
    for (const id of this.held) if (!present.has(id)) this.held.delete(id);
    const engagedTracks = new Set(this.active().map((e) => e.trackId));
    const busyWeapons = new Set(this.active().map((e) => e.weaponUnitId));
    const free = weapons.filter(
      (w) =>
        w.status.state === "IDLE" &&
        w.status.ammo > 0 &&
        w.status.engagementId === null &&
        !busyWeapons.has(w.unitId),
    );

    // Every possible (track, weapon) pairing with its earliest impact time.
    const options: { track: SystemTrackView; weapon: WeaponInfo; impactAt: number }[] = [];
    for (const track of tracks) {
      if (
        !track.engageable ||
        engagedTracks.has(track.trackId) ||
        this.killed.has(track.trackId) ||
        this.held.has(track.trackId)
      ) {
        continue;
      }
      for (const weapon of free) {
        if (this.failedPairs.has(`${weapon.unitId}/${track.trackId}`)) continue;
        const solution = findEarliestIntercept(
          {
            position: weapon.position,
            minRangeM: weapon.status.minRangeM,
            maxRangeM: weapon.status.maxRangeM,
            shellSpeedMps: weapon.shellSpeedMps,
          },
          track,
          { now, readyAt: now + weapon.prepareTimeS * 1000 },
        );
        if (solution) options.push({ track, weapon, impactAt: solution.impactAt });
      }
    }

    // Greedy: the soonest possible hit first; each track and weapon used once.
    options.sort((a, b) => a.impactAt - b.impactAt);
    const commands: Command[] = [];
    const taken = new Set<string>();
    for (const { track, weapon } of options) {
      if (taken.has(track.trackId) || taken.has(weapon.unitId)) continue;
      taken.add(track.trackId);
      taken.add(weapon.unitId);
      commands.push(this.start(track, weapon, now));
    }
    return commands;
  }

  /** A new engagement: the weapon starts preparing for the track. */
  private start(track: SystemTrackView, weapon: WeaponInfo, now: number): Command {
    const readyAt = now + weapon.prepareTimeS * 1000;
    const e: Engagement = {
      id: `E-${String(++this.counter).padStart(4, "0")}`,
      trackId: track.trackId,
      weaponUnitId: weapon.unitId,
      state: "PREPARING",
      createdAt: now,
      since: now,
      readyAt,
      shot: null,
      predicted: predict(weapon, track, now, readyAt),
      sources: track.sources,
      asked: new Set(),
      reason: null,
    };
    this.all.set(e.id, e);
    return {
      to: weapon.unitId,
      msg: msg("prepare", { engagementId: e.id, track: systemTrackOf(track) }),
    };
  }

  // ------------------------------------------------------------- what the units report

  /** A weapon reported its status; READY means it's waiting for "fire". */
  onWeaponStatus(unitId: string, status: WeaponStatus, now: number): Command[] {
    const e = this.active().find((x) => x.weaponUnitId === unitId);
    if (!e || e.state !== "PREPARING" || status.engagementId !== e.id) return [];
    if (status.state !== "READY") return [];
    if (this.fireMode === "auto") return this.fire(e, now);
    this.move(e, "AWAITING_APPROVAL", now);
    return [];
  }

  onShotFired(unitId: string, shot: PayloadOf<ToCommandCenter, "shotFired">, now: number): void {
    const e = this.all.get(shot.engagementId);
    if (!e || e.weaponUnitId !== unitId || e.state !== "FIRING") return;
    e.shot = shot;
    e.predicted = null;
    this.move(e, "IN_FLIGHT", now);
  }

  /** The weapon can't reach the target: call it off; another weapon may get it. */
  onFireFailed(unitId: string, engagementId: string, reason: string, now: number): Command[] {
    const e = this.all.get(engagementId);
    if (!e || e.weaponUnitId !== unitId || !BEFORE_SHOT.includes(e.state)) return [];
    this.failedPairs.set(`${unitId}/${e.trackId}`, now + FAILED_PAIR_COOLDOWN_MS);
    this.end(e, "CANCELLED", now, `weapon can't fire: ${reason}`);
    return [this.cancelCommand(e)];
  }

  /** A radar answered a kill check (checkId is the engagement id). */
  onKillReport(radarUnitId: string, checkId: string, destroyed: boolean, now: number): void {
    const e = this.all.get(checkId);
    if (!e || e.state !== "CONFIRMING" || !e.asked.has(radarUnitId)) return;
    if (!destroyed) return;
    this.end(e, "KILL", now, null);
    this.killed.add(e.trackId);
  }

  /** A weapon disconnected: anything it hadn't fired yet is off. */
  weaponGone(unitId: string, now: number): void {
    for (const e of this.active()) {
      if (e.weaponUnitId === unitId && BEFORE_SHOT.includes(e.state)) {
        this.end(e, "CANCELLED", now, "weapon went offline");
      }
    }
  }

  // ------------------------------------------------------------- the operator

  approve(engagementId: string, now: number): Command[] {
    const e = this.all.get(engagementId);
    if (e?.state !== "AWAITING_APPROVAL")
      throw new Error(`${engagementId} isn't waiting for approval`);
    return this.fire(e, now);
  }

  /** Calls off an engagement before the shot and holds its target until resumed. */
  stop(engagementId: string, now: number): Command[] {
    const e = this.beforeShot(engagementId, "stopped");
    this.end(e, "CANCELLED", now, "stopped by operator");
    this.held.add(e.trackId);
    return [this.cancelCommand(e)];
  }

  /** The same weapon prepares again for the same target, from the beginning. */
  restart(
    engagementId: string,
    now: number,
    tracks: readonly SystemTrackView[],
    weapons: readonly WeaponInfo[],
  ): Command[] {
    const e = this.beforeShot(engagementId, "restarted");
    const track = tracks.find((t) => t.trackId === e.trackId && t.engageable);
    const weapon = weapons.find((w) => w.unitId === e.weaponUnitId);
    if (!track) throw new Error(`${e.trackId} is no longer an engageable enemy`);
    if (!weapon) throw new Error(`${e.weaponUnitId} is offline`);
    this.end(e, "CANCELLED", now, "restarted by operator");
    return [this.cancelCommand(e), this.start(track, weapon, now)];
  }

  /** A held target may be engaged again. */
  resume(trackId: string): void {
    if (!this.held.delete(trackId)) throw new Error(`${trackId} isn't held`);
  }

  /** The weapon's own operator stopped it (the weapon has already stood down). */
  onWeaponStopped(unitId: string, engagementId: string, now: number): void {
    const e = this.all.get(engagementId);
    if (!e || e.weaponUnitId !== unitId || !BEFORE_SHOT.includes(e.state)) return;
    this.end(e, "CANCELLED", now, `stopped at ${unitId}`);
    this.held.add(e.trackId);
  }

  /** The weapon's own operator asked to start preparing again. */
  onRestartRequested(
    unitId: string,
    engagementId: string,
    now: number,
    tracks: readonly SystemTrackView[],
    weapons: readonly WeaponInfo[],
  ): Command[] {
    const e = this.all.get(engagementId);
    if (!e || e.weaponUnitId !== unitId) return [];
    return this.restart(engagementId, now, tracks, weapons);
  }

  // ------------------------------------------------------------- read model

  /** Tracks the operator stopped, waiting to be resumed. */
  heldTracks(): string[] {
    return [...this.held];
  }

  /** Active engagements (oldest first), then the most recent finished ones. */
  view(): EngagementView[] {
    const toView = (e: Engagement): EngagementView => ({
      engagementId: e.id,
      trackId: e.trackId,
      weaponUnitId: e.weaponUnitId,
      state: e.state,
      createdAt: e.createdAt,
      since: e.since,
      readyAt: e.state === "PREPARING" ? e.readyAt : null,
      shot: e.shot
        ? { firedAt: e.shot.firedAt, impactAt: e.shot.impactAt, impactPoint: e.shot.impactPoint }
        : null,
      predicted: BEFORE_SHOT.includes(e.state) ? e.predicted : null,
      reason: e.reason,
    });
    const all = [...this.all.values()];
    const finished = all
      .filter((e) => !ACTIVE.includes(e.state))
      .sort((a, b) => b.since - a.since)
      .slice(0, HISTORY);
    return [...this.active().map(toView), ...finished.map(toView)];
  }

  // ------------------------------------------------------------- internals

  private active(): Engagement[] {
    return [...this.all.values()].filter((e) => ACTIVE.includes(e.state));
  }

  private beforeShot(engagementId: string, what: string): Engagement {
    const e = this.all.get(engagementId);
    if (!e) throw new Error(`unknown engagement ${engagementId}`);
    if (!BEFORE_SHOT.includes(e.state)) {
      const why = e.shot ? "the shot is already fired" : "it has ended";
      throw new Error(`${engagementId} can't be ${what}: ${why}`);
    }
    return e;
  }

  private fire(e: Engagement, now: number): Command[] {
    this.move(e, "FIRING", now);
    return [{ to: e.weaponUnitId, msg: msg("fire", { engagementId: e.id }) }];
  }

  /** Asks every radar that saw the target to confirm it's gone. */
  private startKillCheck(e: Engagement, now: number): Command[] {
    this.move(e, "CONFIRMING", now);
    const commands: Command[] = [];
    for (const s of e.sources) {
      e.asked.add(s.unitId);
      commands.push({
        to: s.unitId,
        msg: msg("confirmKill", { checkId: e.id, radarTrackId: s.radarTrackId }),
      });
    }
    if (commands.length === 0) this.end(e, "UNCONFIRMED", now, "no radar to ask");
    return commands;
  }

  private cancelCommand(e: Engagement): Command {
    return { to: e.weaponUnitId, msg: msg("cancel", { engagementId: e.id }) };
  }

  private move(e: Engagement, state: EngagementState, now: number): void {
    e.state = state;
    e.since = now;
  }

  private end(e: Engagement, state: EngagementState, now: number, reason: string | null): void {
    this.move(e, state, now);
    e.reason = reason;
    // Keep memory bounded: old finished engagements are only needed for the history.
    const finished = [...this.all.values()].filter((x) => !ACTIVE.includes(x.state));
    if (finished.length > HISTORY * 5) {
      finished.sort((a, b) => a.since - b.since);
      for (const old of finished.slice(0, finished.length - HISTORY)) this.all.delete(old.id);
    }
  }
}
