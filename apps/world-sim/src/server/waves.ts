import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { WaveFileSchema, type WaveFile } from "@tdts/shared";
import { z } from "zod";
import type { WaveFileInfo } from "../protocol";

// Only plain file names inside the waves folder: no paths, no "..".
const SAFE_NAME = /^[\w.-]+\.json$/;

export type WaveLoadResult = { ok: true; wave: WaveFile } | { ok: false; error: string };

export async function loadWave(dir: string, file: string): Promise<WaveLoadResult> {
  if (!SAFE_NAME.test(file) || file.startsWith("."))
    return { ok: false, error: "invalid file name" };
  let text: string;
  try {
    text = await readFile(join(dir, file), "utf8");
  } catch {
    return { ok: false, error: "file not found" };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "invalid JSON" };
  }
  const parsed = WaveFileSchema.safeParse(json);
  return parsed.success
    ? { ok: true, wave: parsed.data }
    : { ok: false, error: z.prettifyError(parsed.error) };
}

/** Every .json file in the folder, each either valid (with a summary) or with its error. */
export async function listWaveFiles(dir: string): Promise<WaveFileInfo[]> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => SAFE_NAME.test(n)).sort();
  } catch {
    return [];
  }
  return Promise.all(
    names.map(async (file): Promise<WaveFileInfo> => {
      const result = await loadWave(dir, file);
      return result.ok
        ? { ok: true, file, name: result.wave.name, targetCount: result.wave.targets.length }
        : { ok: false, file, error: result.error };
    }),
  );
}
