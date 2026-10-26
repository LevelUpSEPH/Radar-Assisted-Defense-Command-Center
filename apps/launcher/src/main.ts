// Starts a whole scenario with one command:
//   npm run scenario [-- --dir path/to/scenario]
//
// The World Simulator and the Command Center go first; once they accept
// connections, every radar and weapon in the scenario folder starts. Each
// program's output is prefixed with its name. Ctrl+C stops them all.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { planScenario, ScenarioError, type Program, type ScenarioFiles } from "./plan";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const TSX_CLI = join(REPO_ROOT, "node_modules/tsx/dist/cli.mjs");
/** How long a program may take to open its ports. */
const START_TIMEOUT_MS = 60_000;

const diskFiles: ScenarioFiles = {
  exists: existsSync,
  list: (dir) =>
    existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => f.endsWith(".json"))
          .map((f) => join(dir, f))
      : [],
  readJson: (path) => JSON.parse(readFileSync(path, "utf8")),
};

// ------------------------------------------------------------- output

const COLORS = [36, 33, 32, 35, 34, 91, 92, 93, 94, 95, 96];
const useColor = process.stdout.isTTY;
const paint = (code: number, text: string) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
let labelWidth = 8;

const say = (text: string) => console.log(`${paint(90, "launcher".padEnd(labelWidth))} │ ${text}`);

/** Prefixes every line a program prints with its label. */
function pipeOutput(child: ChildProcess, label: string, color: number) {
  const prefix = `${paint(color, label.padEnd(labelWidth))} │ `;
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue;
    createInterface({ input: stream }).on("line", (line) => console.log(prefix + line));
  }
}

// ------------------------------------------------------------- ports

/** True if something accepts connections on the port. */
function portOpen(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      done(true);
    });
    socket.once("error", () => done(false));
  });
}

async function waitForPorts(ports: number[], what: string): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  for (const port of ports) {
    while (!(await portOpen(port))) {
      if (Date.now() > deadline) throw new Error(`${what} didn't open port ${port} in time`);
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

// ------------------------------------------------------------- the run

async function main() {
  const { values } = parseArgs({ options: { dir: { type: "string" } } });
  const dir = resolve(values.dir ?? join(REPO_ROOT, "scenario"));
  const programs = planScenario(dir, diskFiles);
  labelWidth = Math.max(8, ...programs.map((p) => p.label.length));

  // A program already running (e.g. from an earlier launch) would make ours fail.
  for (const p of programs) {
    for (const port of [p.port, p.uiPort]) {
      if (port !== null && (await portOpen(port))) {
        throw new ScenarioError(
          `port ${port} (${p.name}) is already in use: is TDTS already running?`,
        );
      }
    }
  }

  const children = new Map<Program, ChildProcess>();
  let stopping = false;

  const start = (p: Program, color: number) => {
    const child = spawn(process.execPath, [TSX_CLI, p.main, "--config", p.configPath], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: useColor ? "1" : "0" },
    });
    children.set(p, child);
    pipeOutput(child, p.label, color);
    child.on("exit", (code, signal) => {
      children.delete(p);
      if (!stopping) say(paint(91, `${p.name} stopped (${signal ?? `exit code ${code}`})`));
    });
  };

  const stopAll = () => {
    if (stopping) return;
    stopping = true;
    say("stopping everything…");
    for (const child of children.values()) child.kill("SIGTERM");
    // Whatever hasn't exited after a few seconds is killed outright.
    const force = setTimeout(() => {
      for (const child of children.values()) child.kill("SIGKILL");
      process.exit(0);
    }, 3_000);
    const check = setInterval(() => {
      if (children.size === 0) {
        clearInterval(check);
        clearTimeout(force);
        process.exit(0);
      }
    }, 100);
  };
  process.on("SIGINT", stopAll);
  process.on("SIGTERM", stopAll);

  say(`scenario ${dir}`);
  const servers = programs.filter((p) => p.port !== null);
  const units = programs.filter((p) => p.port === null);
  programs.forEach((p, i) => p.port !== null && start(p, COLORS[i % COLORS.length]!));
  for (const p of servers) await waitForPorts([p.port!, p.uiPort], p.name);

  say(`starting ${units.length} radars and weapons`);
  programs.forEach((p, i) => p.port === null && start(p, COLORS[i % COLORS.length]!));
  await Promise.all(units.map((p) => waitForPorts([p.uiPort], p.name)));

  say("everything is up. Pages:");
  for (const p of programs) say(`  ${p.name.padEnd(20)} http://localhost:${p.uiPort}`);
  say(
    "A radar or weapon showing 'No key' needs a registration key: generate one in the Command Center's Keys tab and enter it on that unit's page (it's remembered).",
  );
  say("Ctrl+C stops everything.");
}

main().catch((err: unknown) => {
  say(paint(91, err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
