// World Simulator entry point: load config, start both servers, run the tick loop.
//   npm run dev -w @tdts/world-sim [-- --config path/to/world-sim.json]

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { WORLD_TICK_MS } from "@tdts/shared";
import { loadCities, loadConfig } from "./config";
import { startUiServer } from "./ui-server";
import { startUnitServer } from "./unit-server";
import { World } from "./world";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

async function main() {
  const { values } = parseArgs({ options: { config: { type: "string" } } });
  const configPath = resolve(values.config ?? resolve(REPO_ROOT, "scenario/world-sim.json"));

  const config = await loadConfig(configPath);
  const cities = await loadCities(config.citiesFile);
  console.log(`[world] ${cities.length} cities from ${config.citiesFile}`);
  console.log(`[world] waves from ${config.wavesDir}`);

  const world = new World(cities);
  const units = startUnitServer(config.port, world);
  const ui = await startUiServer(config.uiPort, world, config.wavesDir);

  const timer = setInterval(() => {
    const now = Date.now();
    world.tick(now);
    ui.broadcastState(world.snapshot(now, units.units()));
  }, WORLD_TICK_MS);

  const shutdown = async () => {
    clearInterval(timer);
    await Promise.all([units.close(), ui.close()]);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  console.error(`[world] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
