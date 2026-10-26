// Radar Center entry point. One process per radar.
//   npm run dev -w @tdts/radar-center -- --config scenario/radars/north.json [--key TDTS-…]
//
// The registration key is normally entered on the radar's page and remembered;
// --key does the same from the command line (handy for scripted launches).

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  createMessage,
  deviceFingerprint,
  isValidKeyFormat,
  type ToCommandCenter,
  type ToWorldSim,
} from "@tdts/shared";
import type { RadarState, UiToServer } from "../protocol";
import { connectToCommandCenter, type RegisterPayload } from "./cc-link";
import { loadConfig } from "./config";
import { loadOrCreateIdentity } from "./identity";
import { loadRegistrationKey, normalizeKey, saveRegistrationKey } from "./registration-store";
import { KillChecks, type KillCheckReply } from "./kill-checks";
import { iffReport, tracksMessage } from "./report";
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
  const tracker = new Tracker({ positionNoiseM: config.positionNoiseM });
  const killChecks = new KillChecks();
  const sendKillReport = (r: KillCheckReply) => {
    console.log(`[radar] kill check ${r.checkId}: ${r.destroyed ? "destroyed" : "still there"}`);
    link.send(createMessage<ToCommandCenter, "killReport">("killReport", r));
  };

  const link = connectToCommandCenter({
    url: config.commandCenterUrl,
    register: registration(key),
    device,
    onStatus: () => ui?.publish(),
    onMessage: (msg) => {
      if (msg.type !== "confirmKill") return;
      // A weapon's shot reached the object behind this track: tell the hardware
      // it was hit, and answer after the next sweep.
      const { checkId, radarTrackId } = msg.payload;
      const { targetHit, immediate } = killChecks.start(checkId, tracker.truthIdOf(radarTrackId));
      if (targetHit) {
        world.send(createMessage<ToWorldSim, "targetHit">("targetHit", { truthId: targetHit }));
        console.log(`[radar] ${radarTrackId} was hit (${checkId})`);
      }
      if (immediate) sendKillReport(immediate);
    },
  });

  const world = connectToWorld({
    url: config.worldSimUrl,
    radarId: config.name,
    position: config.position,
    rangeM: config.rangeM,
    scanIntervalMs: config.scanIntervalMs,
    onScan: (detections, observedAt) => {
      tracker.update(detections, observedAt);
      for (const r of killChecks.afterSweep(new Set(detections.map((d) => d.truthId)))) {
        sendKillReport(r);
      }
      // Once registered, every sweep goes to the Command Center.
      if (link.unitId()) link.send(tracksMessage(observedAt, tracker.view()));
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
    tracks: tracker.view().map((t) => ({ ...t, iff: iffReport(t) })),
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
      case "markTrack": {
        const { radarTrackId, marking } = msg.payload;
        if (!tracker.mark(radarTrackId, marking)) {
          throw new Error(`${radarTrackId} is no longer tracked`);
        }
        console.log(`[radar] operator marked ${radarTrackId} ${marking ?? "(cleared)"}`);
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
