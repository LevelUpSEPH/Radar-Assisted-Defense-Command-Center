// The registration key this weapon was given, entered on its page and
// remembered across restarts in a small file next to its device identity.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

const RegistrationFileSchema = z.object({ key: z.string() });

/** The saved key, or null if none has been entered yet. */
export async function loadRegistrationKey(path: string): Promise<string | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`cannot read ${path}`, { cause: err });
  }
  try {
    const parsed = RegistrationFileSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data.key : null;
  } catch {
    return null; // a broken file just means "no key yet"; the operator can enter it again
  }
}

export async function saveRegistrationKey(path: string, key: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ key }, null, 2) + "\n", "utf8");
}

export async function clearRegistrationKey(path: string): Promise<void> {
  await rm(path, { force: true });
}

/** Accepts what an operator might paste: spaces around it, lower case. */
export function normalizeKey(input: string): string {
  return input.trim().toUpperCase();
}
