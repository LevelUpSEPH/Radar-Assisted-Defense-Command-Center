// Radar Center entry point. One process per radar.
//   npm run dev -w @tdts/radar-center -- --config scenario/radars/north.json [--key TDTS-…]
//
// The registration key is normally entered on the radar's page and remembered;
// --key does the same from the command line (handy for scripted launches).

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { deviceFingerprint, isValidKeyFormat } from "@tdts/shared";
import type { RadarState, UiToServer } from "../protocol";
import { connectToCommandCenter, type RegisterPayload } from "./cc-link";
import { loadConfig } from "./config";
import { loadOrCreateIdentity } from "./identity";
import { loadRegistrationKey, normalizeKey, saveRegistrationKey } from "./registration-store";
import { Tracker } from "./tracker";
import { startUiServer, type UiServer } from "./ui-server";
import { connectToWorld } from "./world-link";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

async function main() {
  const { values } = parseArgs({
    options: { config: { type: "string" }, key: { type: "string" } },
  });
  const configPath = resolve(values.config ?? resolve(REPO_ROOT, "scenario/radars/north.json"));
  const config = await loadConfig(configPath);

  let key: string | null = await loadRegistrationKey(config.registrationFile);
  if (values.key) {
    key = normalizeKey(values.key);
    await saveRegistrationKey(config.registrationFile, key);
  }

  const { keys: device, created } = await loadOrCreateIdentity(config.identityFile);
  const deviceId = await deviceFingerprint(device.publicKey);
  console.log(
    `[radar] ${config.name}: device ${deviceId} (${created ? "new identity created in" : "identity from"} ${config.identityFile})`,
  );
  if (!key) {
    console.log(`[radar] no registration key yet: enter one on http://localhost:${config.uiPort}`);
  }

  const registration = (k: string | null): RegisterPayload | null =>
    k
      ? {
          unitType: "radar",
          key: k,
          publicKey: device.publicKey,
          name: config.name,
          position: config.position,
          capabilities: { rangeM: config.rangeM },
        }
      : null;

  let ui: UiServer | null = null;
  const link = connectToCommandCenter({
    url: config.commandCenterUrl,
    register: registration(key),
    device,
    onStatus: () => ui?.publish(),
  });

  const tracker = new Tracker({ positionNoiseM: config.positionNoiseM });
  const world = connectToWorld({
    url: config.worldSimUrl,
    radarId: config.name,
    position: config.position,
    rangeM: config.rangeM,
    scanIntervalMs: config.scanIntervalMs,
    onScan: (detections, observedAt) => {
      tracker.update(detections, observedAt);
      ui?.publish();
    },
    onStatus: () => ui?.publish(),
  });

  const state = (): RadarState => ({
    name: config.name,
    position: config.position,
    rangeM: config.rangeM,
    scanIntervalMs: config.scanIntervalMs,
    worldConnected: world.connected(),
    tracks: tracker.view(),
    deviceId,
    commandCenterUrl: config.commandCenterUrl,
    registrationKey: key,
    link: link.status(),
  });

  const onCommand = async (msg: UiToServer) => {
    switch (msg.type) {
      case "setKey": {
        const next = normalizeKey(msg.payload.key);
        if (!isValidKeyFormat(next)) {
          throw new Error("That doesn't look like a key. Keys look like TDTS-XXXX-XXXX-XXXX.");
        }
        key = next;
        await saveRegistrationKey(config.registrationFile, key);
        console.log(`[radar] new registration key ${key}`);
        link.useRegistration(registration(key));
        break;
      }
    }
    ui?.publish();
  };
  ui = await startUiServer(config.uiPort, state, onCommand);

  const shutdown = async () => {
    link.close();
    world.close();
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
