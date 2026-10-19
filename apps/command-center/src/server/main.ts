// Command Center entry point.
//   npm run dev -w @tdts/command-center [-- --config path/to/command-center.json]

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { CommandState } from "../protocol";
import { loadConfig } from "./config";
import { startUiServer } from "./ui-server";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

async function main() {
  const { values } = parseArgs({ options: { config: { type: "string" } } });
  const configPath = resolve(values.config ?? resolve(REPO_ROOT, "scenario/command-center.json"));
  const config = await loadConfig(configPath);

  const state = (): CommandState => ({ view: config.view });
  const ui = await startUiServer(config.uiPort, state);

  const shutdown = async () => {
    await ui.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  console.error(`[cc] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
