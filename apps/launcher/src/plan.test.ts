import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planScenario, ScenarioError, type ScenarioFiles } from "./plan";

const DIR = "/scn";
const p = (...parts: string[]) => join(DIR, ...parts);

/** A scenario folder held in memory: path → JSON content. */
function folder(content: Record<string, unknown>): ScenarioFiles {
  return {
    exists: (path) => path in content,
    list: (dir) => Object.keys(content).filter((k) => k.startsWith(dir) && k !== dir),
    readJson: (path) => content[path],
  };
}

const base = {
  [p("world-sim.json")]: { port: 7000, uiPort: 7001, wavesDir: "waves" },
  [p("command-center.json")]: { port: 7100, uiPort: 7101 },
  [p("radars", "north.json")]: { name: "Radar North", uiPort: 7201 },
};

describe("planScenario", () => {
  it("lists the servers first, then every radar and weapon", () => {
    const plan = planScenario(
      DIR,
      folder({
        ...base,
        [p("radars", "east.json")]: { name: "Radar East", uiPort: 7202 },
        [p("weapons", "alpha.json")]: { name: "Battery Alpha", uiPort: 7301 },
      }),
    );
    expect(plan.map((x) => [x.kind, x.label, x.uiPort, x.port])).toEqual([
      ["world", "world", 7001, 7000],
      ["command", "cc", 7101, 7100],
      ["radar", "east", 7202, null],
      ["radar", "north", 7201, null],
      ["weapon", "alpha", 7301, null],
    ]);
    expect(plan[4]).toMatchObject({
      name: "Battery Alpha",
      main: "apps/shot-control/src/server/main.ts",
      configPath: p("weapons", "alpha.json"),
    });
  });

  it("refuses a scenario without the servers or without radars", () => {
    const without = (path: string) =>
      folder(Object.fromEntries(Object.entries(base).filter(([k]) => k !== path)));
    expect(() => planScenario(DIR, without(p("command-center.json")))).toThrow("missing");
    expect(() => planScenario(DIR, without(p("radars", "north.json")))).toThrow("no radars");
  });

  it("refuses two programs on the same port", () => {
    const clash = {
      ...base,
      [p("weapons", "alpha.json")]: { name: "Battery Alpha", uiPort: 7201 },
    };
    expect(() => planScenario(DIR, folder(clash))).toThrow(
      "port 7201 is used by both Radar North and Battery Alpha",
    );
  });

  it("says which file is broken", () => {
    const broken = { ...base, [p("radars", "north.json")]: { uiPort: 7201 } };
    expect(() => planScenario(DIR, folder(broken))).toThrow(ScenarioError);
    expect(() => planScenario(DIR, folder(broken))).toThrow(p("radars", "north.json"));
  });
});
