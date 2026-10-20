// Shot Control entry point. One process per weapon.
//   npm run dev -w @tdts/shot-control -- --config scenario/weapons/alpha.json [--key TDTS-…]
//
// The registration key is normally entered on the weapon's page and
// remembered; --key does the same from the command line (for scripted launches).
// A weapon never connects to the World Simulator: it shoots where it is told.

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { deviceFingerprint, isValidKeyFormat } from "@tdts/shared";
import type { UiToServer, WeaponPageState } from "../protocol";
import { connectToCommandCenter, type RegisterPayload } from "./cc-link";
import { loadConfig } from "./config";
import { loadOrCreateIdentity } from "./identity";
import { loadRegistrationKey, normalizeKey, saveRegistrationKey } from "./registration-store";
import { startUiServer, type UiServer } from "./ui-server";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

async function main() {
  const { values } = parseArgs({
    options: { config: { type: "string" }, key: { type: "string" } },
  });
  const configPath = resolve(values.config ?? resolve(REPO_ROOT, "scenario/weapons/alpha.json"));
  const config = await loadConfig(configPath);

  let key: string | null = await loadRegistrationKey(config.registrationFile);
  if (values.key) {
    key = normalizeKey(values.key);
    await saveRegistrationKey(config.registrationFile, key);
  }

  const { keys: device, created } = await loadOrCreateIdentity(config.identityFile);
  const deviceId = await deviceFingerprint(device.publicKey);
  console.log(
    `[weapon] ${config.name}: device ${deviceId} (${created ? "new identity created in" : "identity from"} ${config.identityFile})`,
  );
  if (!key) {
    console.log(`[weapon] no registration key yet: enter one on http://localhost:${config.uiPort}`);
  }

  const registration = (k: string | null): RegisterPayload | null =>
    k
      ? {
          unitType: "weapon",
          key: k,
          publicKey: device.publicKey,
          name: config.name,
          position: config.position,
          capabilities: {
            minRangeM: config.minRangeM,
            maxRangeM: config.maxRangeM,
            ammo: config.ammo,
            prepareTimeS: config.prepareTimeS,
            reloadTimeS: config.reloadTimeS,
            shellSpeedMps: config.shellSpeedMps,
          },
        }
      : null;

  let ui: UiServer | null = null;
  const link = connectToCommandCenter({
    url: config.commandCenterUrl,
    register: registration(key),
    device,
    onStatus: () => ui?.publish(),
  });

  const state = (): WeaponPageState => ({
    name: config.name,
    position: config.position,
    minRangeM: config.minRangeM,
    maxRangeM: config.maxRangeM,
    ammo: config.ammo,
    prepareTimeS: config.prepareTimeS,
    reloadTimeS: config.reloadTimeS,
    shellSpeedMps: config.shellSpeedMps,
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
        console.log(`[weapon] new registration key ${key}`);
        link.useRegistration(registration(key));
        break;
      }
    }
    ui?.publish();
  };
  ui = await startUiServer(config.uiPort, state, onCommand);

  const shutdown = async () => {
    link.close();
    await ui?.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  console.error(`[weapon] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
