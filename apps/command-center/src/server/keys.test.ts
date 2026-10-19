import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isValidKeyFormat } from "@tdts/shared";
import { afterEach, describe, expect, it } from "vitest";
import { KeyRequestSchema } from "../protocol";
import { loadDataFile, saveDataFile } from "./data-file";
import { KeyStore } from "./keys";

const T0 = 1_700_000_000_000;

describe("KeyStore", () => {
  it("issues an auto key with only the unit type", () => {
    const store = new KeyStore();
    const r = store.generate({ mode: "auto", unitType: "radar" }, T0);
    expect(isValidKeyFormat(r.key)).toBe(true);
    expect(r).toEqual({
      key: r.key,
      unitType: "radar",
      mode: "auto",
      status: "ISSUED",
      createdAt: T0,
    });
    expect(store.get(r.key)).toEqual(r);
  });

  it("issues a manual key with name and expected position", () => {
    const store = new KeyStore();
    const r = store.generate(
      {
        mode: "manual",
        unitType: "weapon",
        name: "  Battery Alpha ",
        expectedPosition: { lat: 47.4, lon: 8.5 },
      },
      T0,
    );
    expect(r).toMatchObject({
      unitType: "weapon",
      mode: "manual",
      name: "Battery Alpha",
      expectedPosition: { lat: 47.4, lon: 8.5 },
      status: "ISSUED",
    });
  });

  it("lists newest first and never repeats a key", () => {
    const store = new KeyStore();
    for (let i = 0; i < 50; i++) store.generate({ mode: "auto", unitType: "radar" }, T0 + i);
    const list = store.list();
    expect(list).toHaveLength(50);
    expect(list[0]!.createdAt).toBe(T0 + 49);
    expect(new Set(list.map((r) => r.key)).size).toBe(50);
  });

  it("deletes a key, and only once", () => {
    const store = new KeyStore();
    const a = store.generate({ mode: "auto", unitType: "radar" }, T0);
    const b = store.generate({ mode: "auto", unitType: "weapon" }, T0 + 1);
    expect(store.delete(a.key)).toBe(true);
    expect(store.get(a.key)).toBeUndefined();
    expect(store.list()).toEqual([b]);
    expect(store.delete(a.key)).toBe(false);
  });

  it("starts from saved records", () => {
    const first = new KeyStore();
    const r = first.generate({ mode: "auto", unitType: "weapon" }, T0);
    expect(new KeyStore(first.list()).get(r.key)).toEqual(r);
  });
});

describe("KeyRequestSchema", () => {
  it("requires a name and a position for manual keys", () => {
    expect(KeyRequestSchema.safeParse({ mode: "manual", unitType: "radar" }).success).toBe(false);
    expect(
      KeyRequestSchema.safeParse({
        mode: "manual",
        unitType: "radar",
        name: "   ",
        expectedPosition: { lat: 47, lon: 8 },
      }).success,
    ).toBe(false);
    expect(
      KeyRequestSchema.safeParse({
        mode: "manual",
        unitType: "radar",
        name: "North",
        expectedPosition: { lat: 95, lon: 8 },
      }).success,
    ).toBe(false);
  });

  it("rejects unknown unit types", () => {
    expect(KeyRequestSchema.safeParse({ mode: "auto", unitType: "tank" }).success).toBe(false);
  });
});

describe("data file", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("round-trips keys, creating the folder if needed", async () => {
    dir = await mkdtemp(join(tmpdir(), "tdts-cc-"));
    const path = join(dir, "nested", "state.json");
    const store = new KeyStore();
    store.generate({ mode: "auto", unitType: "radar" }, T0);
    await saveDataFile(path, { keys: store.list() });
    expect(await loadDataFile(path)).toEqual({ keys: store.list() });
  });

  it("treats a missing file as empty and refuses a corrupt one", async () => {
    dir = await mkdtemp(join(tmpdir(), "tdts-cc-"));
    expect(await loadDataFile(join(dir, "none.json"))).toEqual({ keys: [] });
    await writeFile(join(dir, "bad.json"), "{oops");
    await expect(loadDataFile(join(dir, "bad.json"))).rejects.toThrow("invalid JSON");
  });
});
