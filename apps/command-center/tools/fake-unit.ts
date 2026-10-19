// Dev tool: pretends to be a radar or weapon so registration can be tried out
// before the real Radar Center and Shot Control programs exist.
//
//   npm run fake-unit -w @tdts/command-center -- --type radar --key TDTS-XXXX-XXXX-XXXX
//     [--name "Radar North"] [--lat 47.45] [--lon 8.55] [--no-heartbeat]
//     [--impostor] [--identity path/to/identity.json] [--url ws://localhost:7100]
//
// Like a real unit, it keeps its device key pair in an identity file and signs
// the Command Center's challenge with it. The default identity file is one per
// registration key under apps/command-center/data/fake-units/ (git-ignored).
// --impostor uses a brand-new key pair instead: what someone who copied the
// registration key would have.
//
// It prints every reply, sends heartbeats until stopped (Ctrl+C), and exits
// when rejected, revoked or disconnected.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  createMessage,
  deviceFingerprint,
  FromCommandCenterSchema,
  generateDeviceKeys,
  HEARTBEAT_INTERVAL_MS,
  parseMessage,
  signChallenge,
  type DeviceKeys,
  type ToCommandCenter,
} from "@tdts/shared";
import WebSocket from "ws";

const { values } = parseArgs({
  options: {
    type: { type: "string", default: "radar" },
    key: { type: "string" },
    name: { type: "string" },
    lat: { type: "string", default: "47.45" },
    lon: { type: "string", default: "8.55" },
    url: { type: "string", default: "ws://localhost:7100" },
    identity: { type: "string" },
    impostor: { type: "boolean", default: false },
    "no-heartbeat": { type: "boolean", default: false },
  },
});

if (!values.key || (values.type !== "radar" && values.type !== "weapon")) {
  console.error("usage: fake-unit --type radar|weapon --key TDTS-XXXX-XXXX-XXXX [options]");
  process.exit(2);
}
const registrationKey = values.key;

/** Loads the device's key pair, creating and saving one on first use. */
async function loadIdentity(path: string): Promise<DeviceKeys> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as DeviceKeys;
  } catch {
    const keys = await generateDeviceKeys();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(keys, null, 2) + "\n", "utf8");
    console.log(`created a new device identity in ${path}`);
    return keys;
  }
}

const identityPath = resolve(
  values.identity ?? resolve(import.meta.dirname, "../data/fake-units", `${registrationKey}.json`),
);
const device = values.impostor ? await generateDeviceKeys() : await loadIdentity(identityPath);
console.log(
  `device ${await deviceFingerprint(device.publicKey)}${values.impostor ? " (impostor: fresh key, not saved)" : ""}`,
);

const position = { lat: Number(values.lat), lon: Number(values.lon) };
const common = { key: registrationKey, publicKey: device.publicKey, position };
const register: ToCommandCenter =
  values.type === "radar"
    ? createMessage<ToCommandCenter, "register">("register", {
        ...common,
        unitType: "radar",
        name: values.name ?? "Fake radar",
        capabilities: { rangeM: 40_000 },
      })
    : createMessage<ToCommandCenter, "register">("register", {
        ...common,
        unitType: "weapon",
        name: values.name ?? "Fake weapon",
        capabilities: {
          minRangeM: 2_000,
          maxRangeM: 15_000,
          ammo: 20,
          prepareTimeS: 8,
          reloadTimeS: 12,
          shellSpeedMps: 300,
        },
      });

const ws = new WebSocket(values.url);
const send = (msg: ToCommandCenter) => ws.send(JSON.stringify(msg));
let heartbeat: NodeJS.Timeout | undefined;

ws.on("open", () => {
  console.log(
    `connected to ${values.url}; registering as ${values.type} at ${values.lat}, ${values.lon}`,
  );
  send(register);
  if (!values["no-heartbeat"]) {
    heartbeat = setInterval(
      () => send(createMessage<ToCommandCenter, "heartbeat">("heartbeat", {})),
      HEARTBEAT_INTERVAL_MS,
    );
  } else {
    console.log("not sending heartbeats: expect a timeout");
  }
});

ws.on("message", async (data) => {
  const parsed = parseMessage(FromCommandCenterSchema, data.toString());
  if (!parsed.ok) return console.log(`<- ${data.toString()}`);
  const msg = parsed.message;
  console.log(`<- ${msg.type} ${JSON.stringify(msg.payload)}`);

  if (msg.type === "challenge") {
    const signature = await signChallenge(device.privateKey, msg.payload.nonce, registrationKey);
    send(createMessage<ToCommandCenter, "challengeResponse">("challengeResponse", { signature }));
    console.log("-> challengeResponse (signed with this device's private key)");
  }
});

ws.on("close", () => {
  console.log("disconnected");
  clearInterval(heartbeat);
  process.exit(0);
});

ws.on("error", (err) => {
  console.error(`connection error: ${err.message}`);
  process.exit(1);
});

process.on("SIGINT", () => ws.close());
