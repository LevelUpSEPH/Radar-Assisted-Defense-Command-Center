// Shot Control entry point. One process per weapon.
//   npm run dev -w @tdts/shot-control -- --config scenario/weapons/alpha.json [--key TDTS-…]
//
// The registration key is normally entered on the weapon's page and
// remembered; --key does the same from the command line (for scripted launches).
// A weapon never connects to the World Simulator: it shoots where it is told.

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  createMessage,
  deviceFingerprint,
  HEARTBEAT_INTERVAL_MS,
  isValidKeyFormat,
  type FromCommandCenter,
  type ToCommandCenter,
} from "@tdts/shared";
import type { UiToServer, WeaponPageState } from "../protocol";
import { connectToCommandCenter, type RegisterPayload } from "./cc-link";
import { loadConfig } from "./config";
import { loadOrCreateIdentity } from "./identity";
import { loadRegistrationKey, normalizeKey, saveRegistrationKey } from "./registration-store";
import { startUiServer, type UiServer } from "./ui-server";
import { Weapon, WeaponCommandError, type WeaponEvent } from "./weapon";

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
  const weapon = new Weapon(config);
  const TICK_MS = 100;

  // Everything the weapon reports goes to the Command Center once registered.
  const report = (msg: ToCommandCenter) => {
    if (link.unitId()) link.send(msg);
  };
  const reportStatus = () =>
    report(createMessage<ToCommandCenter, "status">("status", weapon.status()));
  const reportEvents = (events: WeaponEvent[]) => {
    for (const e of events) {
      if (e.type === "shotFired") {
        console.log(
          `[weapon] fired for ${e.payload.engagementId}: lands in ${((e.payload.impactAt - e.payload.firedAt) / 1000).toFixed(1)} s`,
        );
        report(createMessage<ToCommandCenter, "shotFired">("shotFired", e.payload));
      } else {
        console.log(`[weapon] can't fire ${e.payload.engagementId}: ${e.payload.reason}`);
        report(createMessage<ToCommandCenter, "fireFailed">("fireFailed", e.payload));
      }
    }
  };

  /** Runs a step of the state machine and reports anything that changed. */
  const step = (run: () => WeaponEvent[] | void) => {
    const before = JSON.stringify(weapon.status());
    const events = run() ?? [];
    reportEvents(events);
    if (JSON.stringify(weapon.status()) !== before || events.length > 0) {
      reportStatus();
      ui?.publish();
    }
  };

  /** Commands from the Command Center. One that doesn't fit the weapon's state is ignored. */
  const onCommand = (msg: FromCommandCenter) => {
    const now = Date.now();
    try {
      switch (msg.type) {
        case "prepare":
          console.log(
            `[weapon] prepare ${msg.payload.engagementId} (target ${msg.payload.track.trackId})`,
          );
          return step(() => weapon.prepare(msg.payload.engagementId, msg.payload.track, now));
        case "trackUpdate":
          return step(() => weapon.updateTrack(msg.payload.engagementId, msg.payload.track, now));
        case "fire":
          console.log(`[weapon] fire ${msg.payload.engagementId}`);
          return step(() => weapon.fire(msg.payload.engagementId, now));
        case "cancel":
          console.log(`[weapon] cancel ${msg.payload.engagementId}`);
          return step(() => weapon.cancel(msg.payload.engagementId));
        case "setRanges":
          return console.log(
            "[weapon] range changes from the Command Center come in a later piece",
          );
        default:
          return;
      }
    } catch (err) {
      if (err instanceof WeaponCommandError)
        console.warn(`[weapon] ignored ${msg.type}: ${err.message}`);
      else throw err;
    }
  };

  const link = connectToCommandCenter({
    url: config.commandCenterUrl,
    register: registration(key),
    device,
    onStatus: (s) => {
      // The Command Center learns the weapon's state as soon as it registers.
      if (s.state === "registered") reportStatus();
      ui?.publish();
    },
    onMessage: onCommand,
  });

  const ticker = setInterval(() => step(() => weapon.tick(Date.now())), TICK_MS);
  const statusTimer = setInterval(reportStatus, HEARTBEAT_INTERVAL_MS);

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
    status: weapon.status(),
    ...weapon.details(),
  });

  const onUiCommand = async (msg: UiToServer) => {
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
  ui = await startUiServer(config.uiPort, state, onUiCommand);

  const shutdown = async () => {
    clearInterval(ticker);
    clearInterval(statusTimer);
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
