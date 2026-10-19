import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { CitiesFileSchema, DEFAULT_PORTS, type City } from "@tdts/shared";
import { z } from "zod";

const ConfigFileSchema = z.object({
  port: z.number().int().positive().default(DEFAULT_PORTS.worldSim),
  uiPort: z.number().int().positive().default(DEFAULT_PORTS.worldSimUi),
  citiesFile: z.string().default("cities.json"),
  wavesDir: z.string().default("waves"),
});

export interface Config {
  port: number;
  uiPort: number;
  /** Absolute paths. */
  citiesFile: string;
  wavesDir: string;
}

/** Loads the config file; paths inside it are resolved relative to the file. */
export async function loadConfig(path: string): Promise<Config> {
  const raw = await readJson(path);
  const parsed = ConfigFileSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`${path}: ${z.prettifyError(parsed.error)}`);
  const base = dirname(path);
  return {
    port: parsed.data.port,
    uiPort: parsed.data.uiPort,
    citiesFile: resolve(base, parsed.data.citiesFile),
    wavesDir: resolve(base, parsed.data.wavesDir),
  };
}

export async function loadCities(path: string): Promise<City[]> {
  const parsed = CitiesFileSchema.safeParse(await readJson(path));
  if (!parsed.success) throw new Error(`${path}: ${z.prettifyError(parsed.error)}`);
  return parsed.data.cities;
}

async function readJson(path: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new Error(`cannot read ${path}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${path}: invalid JSON`);
  }
}
