// Command Center entry point.
//   npm run dev -w @tdts/command-center [-- --config path/to/command-center.json]

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { CommandState, UiToServer } from "../protocol";
import { loadConfig } from "./config";
import { loadDataFile, saveDataFile } from "./data-file";
import { KeyStore } from "./keys";
import { startUiServer, type UiServer } from "./ui-server";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

async function main() {
  const { values } = parseArgs({ options: { config: { type: "string" } } });
  const configPath = resolve(values.config ?? resolve(REPO_ROOT, "scenario/command-center.json"));
  const config = await loadConfig(configPath);

  const data = await loadDataFile(config.dataFile);
  const keys = new KeyStore(data.keys);
  console.log(`[cc] ${data.keys.length} keys from ${config.dataFile}`);
  const save = () => saveDataFile(config.dataFile, { keys: keys.list() });

  const state = (): CommandState => ({ view: config.view, keys: keys.list() });

  let ui: UiServer | null = null;
  const onCommand = async (msg: UiToServer) => {
    switch (msg.type) {
      case "generateKey": {
        const record = keys.generate(msg.payload, Date.now());
        await save();
        console.log(`[keys] issued ${record.key} (${record.mode} ${record.unitType})`);
        break;
      }
      case "deleteKey": {
        if (!keys.delete(msg.payload.key)) throw new Error(`unknown key ${msg.payload.key}`);
        await save();
        console.log(`[keys] deleted ${msg.payload.key}`);
        break;
      }
    }
    ui?.publish();
  };
  ui = await startUiServer(config.uiPort, state, onCommand);

  const shutdown = async () => {
    await ui?.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  console.error(`[cc] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
