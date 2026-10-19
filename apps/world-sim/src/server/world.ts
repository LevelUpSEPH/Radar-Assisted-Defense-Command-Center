// The simulation itself (DESIGN.md §3). Pure logic: no timers or sockets.
// Everything is driven by `tick(now)` so tests can use a fake clock.

import {
  bearingDeg,
  distanceM,
  moveTowards,
  type Detection,
  type LatLon,
  type TargetKind,
  type WaveFile,
} from "@tdts/shared";
import type { ConnectedRadar, Kill, LogEntry, WaveRun, WorldState } from "../protocol";

const BASE_SIGNATURE: Record<TargetKind, number> = { drone: 0.9, friendly: 0.9, bird: 0.2 };
const SIGNATURE_JITTER = 0.05;
const KILL_DISPLAY_MS = 3_000;
const LOG_LIMIT = 100;

interface LiveTarget {
  id: string;
  runId: string;
  kind: TargetKind;
  status: "SCHEDULED" | "FLYING";
  spawnAt: number;
  start: LatLon;
  destination: LatLon;
  speedMps: number;
  altitudeM: number;
  signature: number;
  iffResponds: boolean;
  position: LatLon;
  /** When `position` was last computed, epoch ms. */
  positionAt: number;
  headingDeg: number;
}

interface RunRecord {
  runId: string;
  name: string;
  file: string;
  startedAt: number;
  arrived: number;
  destroyed: number;
  finished: boolean;
}

export interface WorldOptions {
  /** Random source in [0, 1); injectable for tests. */
  random?: () => number;
}

export class World {
  private readonly random: () => number;

  private readonly targets = new Map<string, LiveTarget>();
  private readonly runs = new Map<string, RunRecord>();
  private kills: Kill[] = [];
  private log: LogEntry[] = [];
  private runCounter = 0;
  private lastTickAt: number | null = null;

  constructor(options: WorldOptions = {}) {
    this.random = options.random ?? Math.random;
  }

  // ------------------------------------------------------------- commands

  /** Schedules every target of a wave relative to `now`. Returns the run id. */
  startWave(wave: WaveFile, file: string, now: number): string {
    const runId = `W${++this.runCounter}`;
    this.runs.set(runId, {
      runId,
      name: wave.name,
      file,
      startedAt: now,
      arrived: 0,
      destroyed: 0,
      finished: false,
    });

    for (const t of wave.targets) {
      const jitter = (this.random() * 2 - 1) * SIGNATURE_JITTER;
      const id = `${runId}-${t.id}`;
      this.targets.set(id, {
        id,
        runId,
        kind: t.kind,
        status: "SCHEDULED",
        spawnAt: now + t.spawnAtS * 1000,
        start: t.start,
        destination: t.destination,
        speedMps: t.speedMps,
        altitudeM: t.altitudeM,
        signature: clamp01(BASE_SIGNATURE[t.kind] + jitter),
        iffResponds: t.kind === "friendly",
        position: t.start,
        positionAt: now,
        headingDeg: bearingDeg(t.start, t.destination),
      });
    }
    this.addLog(now, "wave", `${runId} started: ${wave.name} (${wave.targets.length} targets)`);
    return runId;
  }

  /** Removes every target; ends every running wave. */
  stopAll(now: number): void {
    this.targets.clear();
    for (const run of this.runs.values()) run.finished = true;
    this.addLog(now, "info", "All waves stopped");
  }

  /**
   * A weapon hit this target (reported by a radar). Every computed shot hits,
   * so the target is simply removed. Returns false if it no longer exists,
   * e.g. because another radar already reported the same hit.
   */
  hit(truthId: string, reportedBy: string, now: number): boolean {
    const t = this.targets.get(truthId);
    if (!t || t.status !== "FLYING") return false;
    this.kills.push({ targetId: t.id, kind: t.kind, point: { ...t.position }, at: now });
    this.removeTarget(t.id, "destroyed", now, `reported by ${reportedBy}`);
    return true;
  }

  /** Exact positions of every flying target within `rangeM` of `position`. */
  scan(position: LatLon, rangeM: number): Detection[] {
    const detections: Detection[] = [];
    for (const t of this.targets.values()) {
      if (t.status !== "FLYING" || distanceM(position, t.position) > rangeM) continue;
      detections.push({
        truthId: t.id,
        position: { ...t.position },
        altitudeM: t.altitudeM,
        signature: t.signature,
        iffResponds: t.iffResponds,
      });
    }
    return detections;
  }

  // ------------------------------------------------------------- simulation step

  /** When target positions were last updated; scans report this as `observedAt`. */
  get observedAt(): number | null {
    return this.lastTickAt;
  }

  tick(now: number): void {
    this.lastTickAt = now;
    this.spawnTargets(now);
    this.moveTargets(now);
    this.finishRuns(now);
    this.kills = this.kills.filter((k) => now - k.at < KILL_DISPLAY_MS);
  }

  private spawnTargets(now: number): void {
    for (const t of this.targets.values()) {
      if (t.status !== "SCHEDULED" || t.spawnAt > now) continue;
      t.status = "FLYING";
      t.position = t.start;
      t.positionAt = t.spawnAt;
      this.addLog(t.spawnAt, "spawn", `${t.id} (${t.kind}) appeared`);
    }
  }

  private moveTargets(now: number): void {
    for (const t of [...this.targets.values()]) {
      if (t.status !== "FLYING") continue;
      const distM = (t.speedMps * (now - t.positionAt)) / 1000;
      const { position, arrived } = moveTowards(t.position, t.destination, distM);
      t.position = position;
      t.positionAt = now;
      if (arrived) this.removeTarget(t.id, "arrived", now);
      else t.headingDeg = bearingDeg(position, t.destination);
    }
  }

  private finishRuns(now: number): void {
    for (const run of this.runs.values()) {
      if (run.finished) continue;
      const remaining = [...this.targets.values()].some((t) => t.runId === run.runId);
      if (remaining) continue;
      run.finished = true;
      this.addLog(
        now,
        "wave",
        `${run.runId} finished: ${run.destroyed} destroyed, ${run.arrived} arrived`,
      );
    }
  }

  private removeTarget(
    id: string,
    reason: "arrived" | "destroyed",
    at: number,
    detail?: string,
  ): void {
    const t = this.targets.get(id);
    if (!t) return;
    this.targets.delete(id);
    const run = this.runs.get(t.runId);
    if (run) run[reason]++;
    this.addLog(
      at,
      reason === "arrived" ? "arrive" : "destroy",
      reason === "arrived"
        ? `${id} reached its destination`
        : `${id} (${t.kind}) destroyed${detail ? `, ${detail}` : ""}`,
    );
  }

  private addLog(at: number, kind: LogEntry["kind"], text: string): void {
    this.log.push({ at, kind, text });
    if (this.log.length > LOG_LIMIT) this.log = this.log.slice(-LOG_LIMIT);
  }

  // ------------------------------------------------------------- read model

  snapshot(now: number, radars: ConnectedRadar[]): WorldState {
    const targets = [...this.targets.values()]
      .filter((t) => t.status === "FLYING")
      .map((t) => ({
        id: t.id,
        runId: t.runId,
        kind: t.kind,
        position: t.position,
        destination: t.destination,
        altitudeM: t.altitudeM,
        speedMps: t.speedMps,
        headingDeg: t.headingDeg,
        signature: t.signature,
        iffResponds: t.iffResponds,
      }));

    const waveRuns: WaveRun[] = [...this.runs.values()].map((run) => {
      let scheduled = 0;
      let flying = 0;
      for (const t of this.targets.values()) {
        if (t.runId !== run.runId) continue;
        if (t.status === "SCHEDULED") scheduled++;
        else flying++;
      }
      return { ...run, scheduled, flying };
    });

    return { now, targets, kills: this.kills, radars, waveRuns, log: this.log };
  }
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
