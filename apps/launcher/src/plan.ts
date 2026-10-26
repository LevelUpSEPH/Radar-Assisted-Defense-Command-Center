// Which programs a scenario folder asks for, read from its config files:
//
//   <dir>/world-sim.json        the World Simulator
//   <dir>/command-center.json   the Command Center
//   <dir>/radars/*.json         one Radar Center each
//   <dir>/weapons/*.json        one Shot Control each
//
// Pure logic: file access is passed in, so it can be tested without a disk.

import { basename, join } from "node:path";
import { z } from "zod";

export type ProgramKind = "world" | "command" | "radar" | "weapon";

export interface Program {
  kind: ProgramKind;
  /** Short name for log prefixes: "world", "cc", "north", "alpha". */
  label: string;
  /** Display name, e.g. "Radar North". */
  name: string;
  /** Entry point, relative to the repository root. */
  main: string;
  configPath: string;
  /** The operator page. */
  uiPort: number;
  /** The port other programs connect to (World Simulator and Command Center only). */
  port: number | null;
}

/** What the scenario folder looks like, from the planner's point of view. */
export interface ScenarioFiles {
  exists(path: string): boolean;
  /** JSON files directly in a folder (absent folder: none). */
  list(dir: string): string[];
  readJson(path: string): unknown;
}

const ENTRY: Record<ProgramKind, string> = {
  world: "apps/world-sim/src/server/main.ts",
  command: "apps/command-center/src/server/main.ts",
  radar: "apps/radar-center/src/server/main.ts",
  weapon: "apps/shot-control/src/server/main.ts",
};

// Only the fields the launcher needs; each program validates its own config fully.
const ServerConfig = z.object({ port: z.number().int(), uiPort: z.number().int() });
const UnitConfig = z.object({ name: z.string().min(1), uiPort: z.number().int() });

export class ScenarioError extends Error {}

export function planScenario(dir: string, files: ScenarioFiles): Program[] {
  const read = <T>(schema: z.ZodType<T>, path: string): T => {
    const parsed = schema.safeParse(files.readJson(path));
    if (!parsed.success) {
      throw new ScenarioError(`${path}: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    }
    return parsed.data;
  };
  const required = (file: string) => {
    const path = join(dir, file);
    if (!files.exists(path)) throw new ScenarioError(`missing ${path}`);
    return path;
  };

  const worldPath = required("world-sim.json");
  const ccPath = required("command-center.json");
  const world = read(ServerConfig, worldPath);
  const cc = read(ServerConfig, ccPath);

  const programs: Program[] = [
    {
      kind: "world",
      label: "world",
      name: "World Simulator",
      main: ENTRY.world,
      configPath: worldPath,
      ...world,
    },
    {
      kind: "command",
      label: "cc",
      name: "Command Center",
      main: ENTRY.command,
      configPath: ccPath,
      ...cc,
    },
  ];
  for (const kind of ["radar", "weapon"] as const) {
    for (const path of files.list(join(dir, `${kind}s`)).sort()) {
      const unit = read(UnitConfig, path);
      programs.push({
        kind,
        label: basename(path, ".json"),
        name: unit.name,
        main: ENTRY[kind],
        configPath: path,
        uiPort: unit.uiPort,
        port: null,
      });
    }
  }

  if (!programs.some((p) => p.kind === "radar")) {
    throw new ScenarioError(`no radars in ${join(dir, "radars")}: nothing would see the targets`);
  }

  // Two programs on one port: the second would fail to start.
  const taken = new Map<number, string>();
  for (const p of programs) {
    for (const port of [p.port, p.uiPort]) {
      if (port === null) continue;
      const other = taken.get(port);
      if (other) throw new ScenarioError(`port ${port} is used by both ${other} and ${p.name}`);
      taken.set(port, p.name);
    }
  }
  return programs;
}
