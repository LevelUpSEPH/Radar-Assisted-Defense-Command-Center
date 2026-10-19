// World Simulator entry point: load config, start both servers, run the tick loop.
//   npm run dev -w @tdts/world-sim [-- --config path/to/world-sim.json]

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { WORLD_TICK_MS } from "@tdts/shared";
import { loadConfig } from "./config";
import { startRadarServer } from "./radar-server";
import { startUiServer } from "./ui-server";
import { World } from "./world";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

async function main() {
  const { values } = parseArgs({ options: { config: { type: "string" } } });
  const configPath = resolve(values.config ?? resolve(REPO_ROOT, "scenario/world-sim.json"));

  const config = await loadConfig(configPath);
  console.log(`[world] waves from ${config.wavesDir}`);

  const world = new World();
  const radars = startRadarServer(config.port, world);
  const ui = await startUiServer(config.uiPort, world, config);

  const timer = setInterval(() => {
    const now = Date.now();
    world.tick(now);
    ui.broadcastState(world.snapshot(now, radars.radars()));
  }, WORLD_TICK_MS);

  const shutdown = async () => {
    clearInterval(timer);
    await Promise.all([radars.close(), ui.close()]);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  console.error(`[world] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
