import { readFile } from "node:fs/promises";
import { DEFAULT_MAP_VIEW, DEFAULT_PORTS, MapViewSchema } from "@tdts/shared";
import { z } from "zod";

const ConfigSchema = z.object({
  uiPort: z.number().int().positive().default(DEFAULT_PORTS.commandCenterUi),
  view: MapViewSchema.default(DEFAULT_MAP_VIEW),
});
export type Config = z.infer<typeof ConfigSchema>;

export async function loadConfig(path: string): Promise<Config> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error(`cannot read ${path}`);
  }
  const parsed = ConfigSchema.safeParse(json);
  if (!parsed.success) throw new Error(`${path}: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
