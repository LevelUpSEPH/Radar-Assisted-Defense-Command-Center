// The Command Center's persistent state (DESIGN.md §3, Persistence): a JSON file
// that survives restarts: keys and registered units.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { KeyRecordSchema, UnitRecordSchema } from "../protocol";

const DataFileSchema = z.object({
  keys: z.array(KeyRecordSchema).default([]),
  units: z.array(UnitRecordSchema).default([]),
});
export type DataFile = z.infer<typeof DataFileSchema>;

/** Reads the data file; a missing file means a fresh start. */
export async function loadDataFile(path: string): Promise<DataFile> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { keys: [], units: [] };
    throw new Error(`cannot read ${path}`, { cause: err });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${path}: invalid JSON`);
  }
  const parsed = DataFileSchema.safeParse(json);
  if (!parsed.success) throw new Error(`${path}: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** Writes to a temporary file first, then renames, so a crash can't leave half a file. */
export async function saveDataFile(path: string, data: DataFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await rename(tmp, path);
}
