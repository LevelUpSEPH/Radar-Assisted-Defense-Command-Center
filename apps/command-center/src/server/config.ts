import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DEFAULT_MAP_VIEW, DEFAULT_PORTS, MapViewSchema } from "@tdts/shared";
import { z } from "zod";

const ConfigFileSchema = z.object({
  uiPort: z.number().int().positive().default(DEFAULT_PORTS.commandCenterUi),
  view: MapViewSchema.default(DEFAULT_MAP_VIEW),
  /** Keys and registered units; relative to the config file. */
  dataFile: z.string().default("../apps/command-center/data/state.json"),
});
export type Config = z.infer<typeof ConfigFileSchema>;

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
  return { ...parsed.data, dataFile: resolve(dirname(path), parsed.data.dataFile) };
}
