// Command Center entry point.
//   npm run dev -w @tdts/command-center [-- --config path/to/command-center.json]

import { resolve } from "node:path";
import {
  createMessage,
  PLANNING_INTERVAL_MS,
  type FromCommandCenter,
  type WeaponStatus,
} from "@tdts/shared";
import { parseArgs } from "node:util";
import type { CommandState, UiToServer } from "../protocol";
import { loadConfig } from "./config";
import { loadDataFile, saveDataFile } from "./data-file";
import { AirPicture } from "./air-picture";
import { Engagements, type Command, type WeaponInfo } from "./engagements";
import { Fusion } from "./fusion";
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

  // Radars' reports → fused system tracks with a classification.
  const picture = new AirPicture();
  const fusion = new Fusion({ minLikelihoodToEngage: config.minLikelihoodToEngage });
  const refreshTracks = () => fusion.update(picture.tracks(Date.now()));

  // The latest status of every online weapon.
  const weaponStatus = new Map<string, WeaponStatus>();

  // Engagements: which weapon takes which target, until the kill is confirmed.
  const engagements = new Engagements(config.fireMode);
  const execute = (commands: Command[]) => {
    for (const c of commands) {
      if (c.msg.type !== "trackUpdate")
        console.log(
          `[engage] → ${c.to} ${c.msg.type} ${JSON.stringify(c.msg.payload).slice(0, 80)}`,
        );
      units.sendTo(c.to, c.msg);
    }
  };
  /** Online weapons with what the planner needs: where, how fast, and their live status. */
  const onlineWeapons = (): WeaponInfo[] =>
    registry.records().flatMap((u) => {
      const status = weaponStatus.get(u.unitId);
      return u.unitType === "weapon" && status
        ? [
            {
              unitId: u.unitId,
              position: u.position,
              prepareTimeS: u.capabilities.prepareTimeS,
              shellSpeedMps: u.capabilities.shellSpeedMps,
              status,
            },
          ]
        : [];
    });

  const state = (): CommandState => ({
    view: config.view,
    keys: keys.list(),
    units: registry.view().map((u) => {
      const s = u.unitId && u.status === "ONLINE" ? weaponStatus.get(u.unitId) : undefined;
      return s ? { ...u, weaponStatus: s } : u;
    }),
    tracks: fusion.view(),
    minLikelihoodToEngage: config.minLikelihoodToEngage,
    fireMode: engagements.fireMode,
    engagements: engagements.view(),
    heldTracks: engagements.heldTracks(),
  });

  let ui: UiServer | null = null;
  const units = startUnitServer(config.port, registry, {
    onRegister: (result) => {
      if (result.kind === "registered") void save();
    },
    onTracks: (unitId, report) => {
      picture.report(unitId, report.scanAt, report.tracks, Date.now());
      refreshTracks();
      ui?.publish();
    },
    onWeaponStatus: (unitId, status) => {
      weaponStatus.set(unitId, status);
      execute(engagements.onWeaponStatus(unitId, status, Date.now()));
      ui?.publish();
    },
    onShotFired: (unitId, shot) => {
      console.log(`[engage] ${unitId} fired ${shot.engagementId}`);
      engagements.onShotFired(unitId, shot, Date.now());
      ui?.publish();
    },
    onFireFailed: (unitId, report) => {
      console.log(`[engage] ${unitId} can't fire ${report.engagementId}: ${report.reason}`);
      execute(engagements.onFireFailed(unitId, report.engagementId, report.reason, Date.now()));
      ui?.publish();
    },
    onEngagementStopped: (unitId, engagementId) => {
      console.log(`[engage] ${unitId}'s operator stopped ${engagementId}`);
      engagements.onWeaponStopped(unitId, engagementId, Date.now());
      ui?.publish();
    },
    onRestartRequested: (unitId, engagementId) => {
      console.log(`[engage] ${unitId}'s operator restarts ${engagementId}`);
      try {
        execute(
          engagements.onRestartRequested(
            unitId,
            engagementId,
            Date.now(),
            fusion.view(),
            onlineWeapons(),
          ),
        );
      } catch (err) {
        console.warn(`[engage] can't restart ${engagementId}: ${(err as Error).message}`);
      }
      ui?.publish();
    },
    onKillReport: (unitId, report) => {
      console.log(
        `[engage] ${unitId} kill report ${report.checkId}: ${report.destroyed ? "destroyed" : "still there"}`,
      );
      engagements.onKillReport(unitId, report.checkId, report.destroyed, Date.now());
      ui?.publish();
    },
    onUnitGone: (unitId) => {
      weaponStatus.delete(unitId);
      engagements.weaponGone(unitId, Date.now());
      picture.forget(unitId);
      refreshTracks();
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
        const unitId = keys.get(msg.payload.key)?.unitId;
        if (!keys.delete(msg.payload.key)) throw new Error(`unknown key ${msg.payload.key}`);
        if (unitId) {
          weaponStatus.delete(unitId);
          engagements.weaponGone(unitId, Date.now());
          picture.forget(unitId);
          refreshTracks();
        }
        // A deleted key takes its unit with it; a connected unit is told and dropped.
        const connId = registry.forgetKey(msg.payload.key);
        if (connId) units.disconnect(connId, "revoked");
        await save();
        console.log(`[keys] deleted ${msg.payload.key}`);
        break;
      }
      case "setFireMode":
        engagements.fireMode = msg.payload.fireMode;
        console.log(`[engage] fire mode: ${msg.payload.fireMode}`);
        break;
      case "approveEngagement":
        execute(engagements.approve(msg.payload.engagementId, Date.now()));
        console.log(`[engage] operator approved ${msg.payload.engagementId}`);
        break;
      case "stopEngagement":
        execute(engagements.stop(msg.payload.engagementId, Date.now()));
        console.log(`[engage] operator stopped ${msg.payload.engagementId}`);
        break;
      case "restartEngagement":
        execute(
          engagements.restart(msg.payload.engagementId, Date.now(), fusion.view(), onlineWeapons()),
        );
        console.log(`[engage] operator restarted ${msg.payload.engagementId}`);
        break;
      case "resumeTrack":
        engagements.resume(msg.payload.trackId);
        console.log(`[engage] operator resumed ${msg.payload.trackId}`);
        break;
      case "setWeaponRanges": {
        const { unitId, minRangeM, maxRangeM } = msg.payload;
        if (!(minRangeM >= 0 && minRangeM < maxRangeM)) {
          throw new Error("Min range must be at least 0 and below max range.");
        }
        const sent = units.sendTo(
          unitId,
          createMessage<FromCommandCenter, "setRanges">("setRanges", { minRangeM, maxRangeM }),
        );
        if (!sent) throw new Error(`${unitId} is not online.`);
        // The new ranges show once the weapon reports them in its status.
        console.log(`[units] → ${unitId} setRanges ${minRangeM}–${maxRangeM} m`);
        break;
      }
      case "classifyTrack": {
        const { trackId, classification } = msg.payload;
        if (!fusion.setOverride(trackId, classification)) {
          throw new Error(`${trackId} is no longer tracked`);
        }
        console.log(`[tracks] operator set ${trackId} to ${classification ?? "radar reports"}`);
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

  // Once a second: radars that went quiet drop out of the picture even when
  // nothing else happens.
  const tick = setInterval(() => {
    refreshTracks();
    execute(engagements.plan(Date.now(), fusion.view(), onlineWeapons()));
    ui?.publish();
  }, PLANNING_INTERVAL_MS);

  const shutdown = async () => {
    clearInterval(tick);
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
