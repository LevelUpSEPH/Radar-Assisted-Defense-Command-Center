// This radar's device identity (Command Center DESIGN.md §3, Device keys): an
// Ed25519 key pair created on first start and kept in a local file. The
// private key never leaves this machine; only the public key is sent.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { generateDeviceKeys, type DeviceKeys } from "@tdts/shared";
import { z } from "zod";

const IdentityFileSchema = z.object({ publicKey: z.string(), privateKey: z.string() });

/** Loads the key pair, or creates and saves a new one if the file doesn't exist yet. */
export async function loadOrCreateIdentity(
  path: string,
): Promise<{ keys: DeviceKeys; created: boolean }> {
  let text: string | null = null;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`cannot read identity file ${path}`, { cause: err });
    }
  }

  if (text !== null) {
    // An existing but broken identity file is an error, never silently replaced:
    // a new key pair would no longer match what the Command Center has on record.
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`identity file ${path} is not valid JSON`);
    }
    const parsed = IdentityFileSchema.safeParse(json);
    if (!parsed.success) throw new Error(`identity file ${path} is invalid`);
    return { keys: parsed.data, created: false };
  }

  const keys = await generateDeviceKeys();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(keys, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  return { keys, created: true };
}
