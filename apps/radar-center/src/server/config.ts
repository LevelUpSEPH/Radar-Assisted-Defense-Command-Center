import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { DEFAULT_PORTS, LatLonSchema } from "@tdts/shared";
import { z } from "zod";

const ConfigFileSchema = z.object({
  name: z.string().min(1),
  position: LatLonSchema,
  rangeM: z.number().positive(),
  scanIntervalMs: z.number().int().positive().default(1_000),
  positionNoiseM: z.number().nonnegative().default(50),
  commandCenterUrl: z.string().default(`ws://localhost:${DEFAULT_PORTS.commandCenter}`),
  worldSimUrl: z.string().default(`ws://localhost:${DEFAULT_PORTS.worldSim}`),
  uiPort: z.number().int().positive(),
  /**
   * Where this radar keeps its device key pair (private key included), relative
   * to the config file. Defaults to a git-ignored folder, one file per config.
   */
  identityFile: z.string().optional(),
  /** Where the registration key entered on the radar's page is remembered. */
  registrationFile: z.string().optional(),
});

export type Config = Omit<z.infer<typeof ConfigFileSchema>, "identityFile" | "registrationFile"> & {
  /** Absolute paths. */
  identityFile: string;
  registrationFile: string;
};

const APP_DATA = resolve(import.meta.dirname, "../../data");

/** Loads the config file; paths inside it are resolved relative to the file. */
export async function loadConfig(path: string): Promise<Config> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error(`cannot read ${path}`);
  }
  const parsed = ConfigFileSchema.safeParse(json);
  if (!parsed.success) throw new Error(`${path}: ${z.prettifyError(parsed.error)}`);
  const { identityFile, registrationFile, ...rest } = parsed.data;
  const inData = (folder: string) => resolve(APP_DATA, folder, basename(path));
  return {
    ...rest,
    identityFile: identityFile ? resolve(dirname(path), identityFile) : inData("identities"),
    registrationFile: registrationFile
      ? resolve(dirname(path), registrationFile)
      : inData("registrations"),
  };
}
