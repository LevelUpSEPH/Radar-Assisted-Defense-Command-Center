// Radar Center entry point. One process per radar.
//   npm run dev -w @tdts/radar-center -- --config scenario/radars/north.json [--key TDTS-…]

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { deviceFingerprint } from "@tdts/shared";
import type { RadarState } from "../protocol";
import { connectToCommandCenter, type RegisterPayload } from "./cc-link";
import { loadConfig } from "./config";
import { loadOrCreateIdentity } from "./identity";
import { startUiServer, type UiServer } from "./ui-server";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

async function main() {
  const { values } = parseArgs({
    options: { config: { type: "string" }, key: { type: "string" } },
  });
  const configPath = resolve(values.config ?? resolve(REPO_ROOT, "scenario/radars/north.json"));
  const config = await loadConfig(configPath);
  const key = (values.key ?? config.key ?? "").trim();

  const { keys: device, created } = await loadOrCreateIdentity(config.identityFile);
  const deviceId = await deviceFingerprint(device.publicKey);
  console.log(
    `[radar] ${config.name}: device ${deviceId} (${created ? "new identity created in" : "identity from"} ${config.identityFile})`,
  );
  if (!key) console.log(`[radar] no registration key: add "key" to ${configPath} or pass --key`);

  const register: RegisterPayload | null = key
    ? {
        unitType: "radar",
        key,
        publicKey: device.publicKey,
        name: config.name,
        position: config.position,
        capabilities: { rangeM: config.rangeM },
      }
    : null;

  let ui: UiServer | null = null;
  const link = connectToCommandCenter({
    url: config.commandCenterUrl,
    register,
    device,
    onStatus: () => ui?.publish(),
  });

  const state = (): RadarState => ({
    name: config.name,
    position: config.position,
    rangeM: config.rangeM,
    deviceId,
    commandCenterUrl: config.commandCenterUrl,
    link: link.status(),
  });
  ui = await startUiServer(config.uiPort, state);

  const shutdown = async () => {
    link.close();
    await ui?.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  console.error(`[radar] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
