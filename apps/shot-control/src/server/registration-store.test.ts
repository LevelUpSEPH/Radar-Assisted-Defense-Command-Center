import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearRegistrationKey,
  loadRegistrationKey,
  normalizeKey,
  saveRegistrationKey,
} from "./registration-store";

describe("registration store", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("remembers a key across loads, creating the folder", async () => {
    dir = await mkdtemp(join(tmpdir(), "tdts-weapon-"));
    const path = join(dir, "registrations", "north.json");
    expect(await loadRegistrationKey(path)).toBeNull();
    await saveRegistrationKey(path, "TDTS-AAAA-BBBB-CCCC");
    expect(await loadRegistrationKey(path)).toBe("TDTS-AAAA-BBBB-CCCC");
    await clearRegistrationKey(path);
    expect(await loadRegistrationKey(path)).toBeNull();
  });

  it("treats a broken file as no key", async () => {
    dir = await mkdtemp(join(tmpdir(), "tdts-weapon-"));
    const path = join(dir, "broken.json");
    await writeFile(path, "{oops");
    expect(await loadRegistrationKey(path)).toBeNull();
  });

  it("normalizes what an operator pastes", () => {
    expect(normalizeKey("  tdts-aaaa-bbbb-cccc \n")).toBe("TDTS-AAAA-BBBB-CCCC");
  });
});
