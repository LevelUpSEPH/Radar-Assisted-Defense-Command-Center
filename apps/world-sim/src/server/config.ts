import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DEFAULT_MAP_VIEW, DEFAULT_PORTS, MapViewSchema, type MapView } from "@tdts/shared";
import { z } from "zod";

const ConfigFileSchema = z.object({
  port: z.number().int().positive().default(DEFAULT_PORTS.worldSim),
  uiPort: z.number().int().positive().default(DEFAULT_PORTS.worldSimUi),
  wavesDir: z.string().default("waves"),
  view: MapViewSchema.default(DEFAULT_MAP_VIEW),
});

export interface Config {
  port: number;
  uiPort: number;
  /** Absolute path. */
  wavesDir: string;
  view: MapView;
}

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
  return { ...parsed.data, wavesDir: resolve(dirname(path), parsed.data.wavesDir) };
}
