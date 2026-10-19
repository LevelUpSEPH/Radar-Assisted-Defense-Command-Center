import { destination, distanceM, type WaveFile } from "@tdts/shared";
import { describe, expect, it } from "vitest";
import { World } from "./world";

const T0 = 1_700_000_000_000;
const origin = { lat: 47, lon: 8 };
/** 10 km due east of origin. */
const east10k = destination(origin, 90, 10_000);

function wave(overrides: Partial<WaveFile["targets"][number]>[] = [{}]): WaveFile {
  return {
    name: "Test wave",
    targets: overrides.map((o, i) => ({
      id: `t${i + 1}`,
      kind: "drone",
      spawnAtS: 0,
      start: origin,
      destination: east10k,
      speedMps: 100,
      altitudeM: 300,
      ...o,
    })),
  };
}

function newWorld() {
  return new World({ random: () => 0.5 }); // 0.5 → zero signature jitter
}

/** Ticks every 100 ms from `from` (exclusive) to `to` (inclusive). */
function run(world: World, from: number, to: number) {
  for (let t = from + 100; t <= to; t += 100) world.tick(t);
}

describe("waves and spawning", () => {
  it("spawns targets at their spawn time, not before", () => {
    const w = newWorld();
    const runId = w.startWave(wave([{ spawnAtS: 0 }, { spawnAtS: 5 }]), "w.json", T0);
    expect(runId).toBe("W1");

    w.tick(T0);
    expect(w.snapshot(T0, []).targets.map((t) => t.id)).toEqual(["W1-t1"]);

    run(w, T0, T0 + 5_000);
    expect(w.snapshot(T0 + 5_000, []).targets.map((t) => t.id)).toEqual(["W1-t1", "W1-t2"]);
  });

  it("gives each run its own ids", () => {
    const w = newWorld();
    w.startWave(wave(), "w.json", T0);
    w.startWave(wave(), "w.json", T0);
    w.tick(T0);
    expect(w.snapshot(T0, []).targets.map((t) => t.id)).toEqual(["W1-t1", "W2-t1"]);
  });

  it("sets signature and IFF from the kind", () => {
    const w = newWorld();
    w.startWave(wave([{ kind: "drone" }, { kind: "friendly" }, { kind: "bird" }]), "w.json", T0);
    w.tick(T0);
    const byKind = Object.fromEntries(w.snapshot(T0, []).targets.map((t) => [t.kind, t]));
    expect(byKind.drone).toMatchObject({ signature: 0.9, iffResponds: false });
    expect(byKind.friendly).toMatchObject({ signature: 0.9, iffResponds: true });
    expect(byKind.bird).toMatchObject({ signature: 0.2, iffResponds: false });
  });
});

describe("movement", () => {
  it("moves at its speed towards the destination", () => {
    const w = newWorld();
    w.startWave(wave(), "w.json", T0);
    w.tick(T0);
    run(w, T0, T0 + 10_000);
    const [t] = w.snapshot(T0 + 10_000, []).targets;
    expect(distanceM(origin, t!.position)).toBeCloseTo(1_000, 0);
    expect(t!.headingDeg).toBeCloseTo(90, 0);
  });

  it("accounts for a spawn time between ticks", () => {
    const w = newWorld();
    w.startWave(wave([{ spawnAtS: 0.05 }]), "w.json", T0);
    w.tick(T0 + 100); // spawned 50 ms ago
    const [t] = w.snapshot(T0 + 100, []).targets;
    expect(distanceM(origin, t!.position)).toBeCloseTo(5, 3);
  });

  it("removes a target when it arrives and finishes the run", () => {
    const w = newWorld();
    w.startWave(wave(), "w.json", T0); // 10 km at 100 m/s = 100 s
    w.tick(T0);
    run(w, T0, T0 + 99_900);
    expect(w.snapshot(T0 + 99_900, []).targets).toHaveLength(1);

    w.tick(T0 + 100_000);
    const s = w.snapshot(T0 + 100_000, []);
    expect(s.targets).toHaveLength(0);
    expect(s.waveRuns[0]).toMatchObject({ arrived: 1, destroyed: 0, flying: 0, finished: true });
  });
});

describe("scan", () => {
  it("returns only flying targets inside the range", () => {
    const w = newWorld();
    w.startWave(wave([{}, { spawnAtS: 60 }]), "w.json", T0);
    w.tick(T0);
    const radar = destination(origin, 270, 5_000); // 5 km west of the first target

    expect(w.scan(radar, 4_000)).toHaveLength(0);
    const hits = w.scan(radar, 6_000);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ truthId: "W1-t1", signature: 0.9, iffResponds: false });
  });

  it("reports when positions were last updated", () => {
    const w = newWorld();
    expect(w.observedAt).toBeNull();
    w.tick(T0 + 300);
    expect(w.observedAt).toBe(T0 + 300);
  });
});

describe("hits", () => {
  it("removes a hit target, counts it and shows the kill", () => {
    const w = newWorld();
    w.startWave(wave(), "w.json", T0);
    w.tick(T0);
    run(w, T0, T0 + 20_000);

    expect(w.hit("W1-t1", "radar-1", T0 + 20_000)).toBe(true);
    const s = w.snapshot(T0 + 20_000, []);
    expect(s.targets).toHaveLength(0);
    expect(s.kills).toEqual([
      { targetId: "W1-t1", kind: "drone", point: expect.any(Object), at: T0 + 20_000 },
    ]);
    expect(distanceM(s.kills[0]!.point, destination(origin, 90, 2_000))).toBeLessThan(1);

    w.tick(T0 + 20_100);
    expect(w.snapshot(T0 + 20_100, []).waveRuns[0]).toMatchObject({
      destroyed: 1,
      finished: true,
    });
  });

  it("ignores a second report of the same hit and unknown targets", () => {
    const w = newWorld();
    w.startWave(wave(), "w.json", T0);
    w.tick(T0);
    expect(w.hit("W1-t1", "radar-1", T0)).toBe(true);
    expect(w.hit("W1-t1", "radar-2", T0)).toBe(false);
    expect(w.hit("nope", "radar-1", T0)).toBe(false);
    expect(w.snapshot(T0, []).waveRuns[0]!.destroyed).toBe(1);
  });

  it("can't hit a target that hasn't appeared yet", () => {
    const w = newWorld();
    w.startWave(wave([{ spawnAtS: 30 }]), "w.json", T0);
    w.tick(T0);
    expect(w.hit("W1-t1", "radar-1", T0)).toBe(false);
  });

  it("clears kills from the map after 3 s", () => {
    const w = newWorld();
    w.startWave(wave(), "w.json", T0);
    w.tick(T0);
    w.hit("W1-t1", "radar-1", T0);
    w.tick(T0 + 2_900);
    expect(w.snapshot(T0 + 2_900, []).kills).toHaveLength(1);
    w.tick(T0 + 3_000);
    expect(w.snapshot(T0 + 3_000, []).kills).toHaveLength(0);
  });
});

describe("stopAll", () => {
  it("removes everything and finishes all runs", () => {
    const w = newWorld();
    w.startWave(wave([{}, { spawnAtS: 30 }]), "w.json", T0);
    w.tick(T0);
    w.stopAll(T0 + 100);
    const s = w.snapshot(T0 + 100, []);
    expect(s.targets).toHaveLength(0);
    expect(s.waveRuns[0]).toMatchObject({ scheduled: 0, flying: 0, finished: true });
  });
});
