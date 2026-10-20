import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { DEFAULT_PORTS, LatLonSchema } from "@tdts/shared";
import { z } from "zod";

const ConfigFileSchema = z
  .object({
    name: z.string().min(1),
    position: LatLonSchema,
    /** Closer than this the weapon can't hit (mortars need room for their arc). */
    minRangeM: z.number().nonnegative(),
    maxRangeM: z.number().positive(),
    ammo: z.number().int().nonnegative(),
    /** Time from "prepare" to ready to fire. */
    prepareTimeS: z.number().nonnegative(),
    /** Time after a shot before the weapon is available again. */
    reloadTimeS: z.number().nonnegative(),
    shellSpeedMps: z.number().positive(),
    commandCenterUrl: z.string().default(`ws://localhost:${DEFAULT_PORTS.commandCenter}`),
    uiPort: z.number().int().positive(),
    /**
     * Where this weapon keeps its device key pair (private key included) and
     * the registration key entered on its page, relative to the config file.
     * Defaults to a git-ignored folder, one file per config.
     */
    identityFile: z.string().optional(),
    registrationFile: z.string().optional(),
  })
  .refine((c) => c.minRangeM < c.maxRangeM, { message: "minRangeM must be below maxRangeM" });

type Files = "identityFile" | "registrationFile";
export type Config = Omit<z.infer<typeof ConfigFileSchema>, Files> & Record<Files, string>;

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
  const file = (given: string | undefined, folder: string) =>
    given ? resolve(dirname(path), given) : resolve(APP_DATA, folder, basename(path));
  return {
    ...rest,
    identityFile: file(identityFile, "identities"),
    registrationFile: file(registrationFile, "registrations"),
  };
}
