// The simulation itself (DESIGN.md §3). Pure logic: no timers or sockets.
// Everything is driven by `tick(now)` so tests can use a fake clock.

import {
  BLAST_RADIUS_M,
  bearingDeg,
  distanceM,
  moveTowards,
  type City,
  type Detection,
  type LatLon,
  type TargetKind,
  type WaveFile,
} from "@tdts/shared";
import type { ConnectedUnit, Impact, LogEntry, TruthShell, WaveRun, WorldState } from "../protocol";

const BASE_SIGNATURE: Record<TargetKind, number> = { drone: 0.9, friendly: 0.9, bird: 0.2 };
const SIGNATURE_JITTER = 0.05;
const IMPACT_DISPLAY_MS = 3_000;
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
  blastRadiusM?: number;
}

export type ShellResult = { ok: true } | { ok: false; error: string };

export class World {
  readonly cities: readonly City[];
  private readonly random: () => number;
  private readonly blastRadiusM: number;

  private readonly targets = new Map<string, LiveTarget>();
  private readonly shells = new Map<string, TruthShell>();
  private readonly runs = new Map<string, RunRecord>();
  private impacts: Impact[] = [];
  private log: LogEntry[] = [];
  private runCounter = 0;
  private lastTickAt: number | null = null;

  constructor(cities: readonly City[], options: WorldOptions = {}) {
    this.cities = cities;
    this.random = options.random ?? Math.random;
    this.blastRadiusM = options.blastRadiusM ?? BLAST_RADIUS_M;
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

  /** Removes every target and shell; ends every running wave. */
  stopAll(now: number): void {
    this.targets.clear();
    this.shells.clear();
    for (const run of this.runs.values()) run.finished = true;
    this.addLog(now, "info", "All waves stopped");
  }

  addShell(shell: Omit<TruthShell, "unitId">, unitId: string, now: number): ShellResult {
    if (shell.impactAt <= shell.firedAt)
      return { ok: false, error: "impactAt must be after firedAt" };
    if (this.shells.has(shell.shellId))
      return { ok: false, error: `duplicate shellId ${shell.shellId}` };
    this.shells.set(shell.shellId, { ...shell, unitId });
    const flightS = ((shell.impactAt - shell.firedAt) / 1000).toFixed(1);
    this.addLog(now, "shell", `${unitId} fired ${shell.shellId} (${flightS} s flight)`);
    return { ok: true };
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
    this.resolveShells(now);
    this.spawnTargets(now);
    this.moveTargets(now);
    this.finishRuns(now);
    this.impacts = this.impacts.filter((i) => now - i.at < IMPACT_DISPLAY_MS);
  }

  private resolveShells(now: number): void {
    const due = [...this.shells.values()]
      .filter((s) => s.impactAt <= now)
      .sort((a, b) => a.impactAt - b.impactAt);

    for (const shell of due) {
      this.shells.delete(shell.shellId);
      const destroyed: string[] = [];
      for (const t of this.targets.values()) {
        if (t.status !== "FLYING" || t.spawnAt > shell.impactAt) continue;
        // Where the target was at the exact moment of impact, not at the last tick.
        const elapsedS = Math.max(0, shell.impactAt - t.positionAt) / 1000;
        const at = moveTowards(t.position, t.destination, t.speedMps * elapsedS).position;
        if (distanceM(at, shell.impactPoint) <= this.blastRadiusM) destroyed.push(t.id);
      }
      for (const id of destroyed) this.removeTarget(id, "destroyed", shell.impactAt);

      this.impacts.push({
        shellId: shell.shellId,
        point: shell.impactPoint,
        at: shell.impactAt,
        destroyed,
      });
      this.addLog(
        shell.impactAt,
        "impact",
        destroyed.length
          ? `${shell.shellId} impact: destroyed ${destroyed.join(", ")}`
          : `${shell.shellId} impact: no target hit`,
      );
    }
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

  private removeTarget(id: string, reason: "arrived" | "destroyed", at: number): void {
    const t = this.targets.get(id);
    if (!t) return;
    this.targets.delete(id);
    const run = this.runs.get(t.runId);
    if (run) run[reason]++;
    this.addLog(
      at,
      reason === "arrived" ? "arrive" : "destroy",
      reason === "arrived" ? `${id} reached its destination` : `${id} (${t.kind}) destroyed`,
    );
  }

  private addLog(at: number, kind: LogEntry["kind"], text: string): void {
    this.log.push({ at, kind, text });
    if (this.log.length > LOG_LIMIT) this.log = this.log.slice(-LOG_LIMIT);
  }

  // ------------------------------------------------------------- read model

  snapshot(now: number, units: ConnectedUnit[]): WorldState {
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

    return {
      now,
      targets,
      shells: [...this.shells.values()],
      impacts: this.impacts,
      units,
      waveRuns,
      log: this.log,
    };
  }
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
