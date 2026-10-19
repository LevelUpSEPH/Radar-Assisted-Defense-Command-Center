// Command Center entry point.
//   npm run dev -w @tdts/command-center [-- --config path/to/command-center.json]

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { CommandState, UiToServer } from "../protocol";
import { loadConfig } from "./config";
import { loadDataFile, saveDataFile } from "./data-file";
import { KeyStore } from "./keys";
import { Registry } from "./registry";
import { startUiServer, type UiServer } from "./ui-server";
import { startUnitServer } from "./unit-server";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

async function main() {
  const { values } = parseArgs({ options: { config: { type: "string" } } });
  const configPath = resolve(values.config ?? resolve(REPO_ROOT, "scenario/command-center.json"));
  const config = await loadConfig(configPath);

  const data = await loadDataFile(config.dataFile);
  const keys = new KeyStore(data.keys);
  const registry = new Registry(keys, data.units);
  console.log(`[cc] ${data.keys.length} keys, ${data.units.length} units from ${config.dataFile}`);

  // Saves are queued so two quick changes can't write the file at the same time.
  let saving = Promise.resolve();
  const save = () => {
    saving = saving
      .then(() => saveDataFile(config.dataFile, { keys: keys.list(), units: registry.records() }))
      .catch((err: unknown) => console.error(`[cc] save failed: ${String(err)}`));
    return saving;
  };

  const state = (): CommandState => ({
    view: config.view,
    keys: keys.list(),
    units: registry.view(),
  });

  let ui: UiServer | null = null;
  const units = startUnitServer(config.port, registry, {
    onRegister: (result) => {
      if (result.kind === "registered") void save();
    },
    onChange: () => ui?.publish(),
  });

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
        // A deleted key takes its unit with it; a connected unit is told and dropped.
        const connId = registry.forgetKey(msg.payload.key);
        if (connId) units.disconnect(connId, "revoked");
        await save();
        console.log(`[keys] deleted ${msg.payload.key}`);
        break;
      }
      case "approveUnit": {
        const { connId, unitId } = registry.approve(msg.payload.key, Date.now());
        units.confirmRegistered(connId, unitId);
        await save();
        console.log(`[units] operator approved ${msg.payload.key} as ${unitId}`);
        break;
      }
      case "rejectUnit": {
        units.disconnect(registry.reject(msg.payload.key), "REJECTED_BY_OPERATOR");
        console.log(`[units] operator rejected ${msg.payload.key}`);
        break;
      }
    }
    ui?.publish();
  };
  ui = await startUiServer(config.uiPort, state, onCommand);

  const shutdown = async () => {
    await Promise.all([units.close(), ui?.close()]);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  console.error(`[cc] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
