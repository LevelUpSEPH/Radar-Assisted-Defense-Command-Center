// Dev tool: pretends to be a radar or weapon so registration can be tried out
// before the real Radar Center and Shot Control programs exist.
//
//   npm run fake-unit -w @tdts/command-center -- --type radar --key TDTS-XXXX-XXXX-XXXX
//     [--name "Radar North"] [--lat 47.45] [--lon 8.55] [--no-heartbeat]
//     [--url ws://localhost:7100]
//
// It registers, prints every reply, sends heartbeats until stopped (Ctrl+C),
// and exits when rejected, revoked or disconnected.

import { parseArgs } from "node:util";
import {
  createMessage,
  FromCommandCenterSchema,
  HEARTBEAT_INTERVAL_MS,
  parseMessage,
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
    "no-heartbeat": { type: "boolean", default: false },
  },
});

if (!values.key || (values.type !== "radar" && values.type !== "weapon")) {
  console.error("usage: fake-unit --type radar|weapon --key TDTS-XXXX-XXXX-XXXX [options]");
  process.exit(2);
}

const position = { lat: Number(values.lat), lon: Number(values.lon) };
const register: ToCommandCenter =
  values.type === "radar"
    ? createMessage<ToCommandCenter, "register">("register", {
        unitType: "radar",
        key: values.key,
        name: values.name ?? "Fake radar",
        position,
        capabilities: { rangeM: 40_000 },
      })
    : createMessage<ToCommandCenter, "register">("register", {
        unitType: "weapon",
        key: values.key,
        name: values.name ?? "Fake weapon",
        position,
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
let heartbeat: NodeJS.Timeout | undefined;

ws.on("open", () => {
  console.log(
    `connected to ${values.url}; registering as ${values.type} at ${values.lat}, ${values.lon}`,
  );
  ws.send(JSON.stringify(register));
  if (!values["no-heartbeat"]) {
    heartbeat = setInterval(
      () => ws.send(JSON.stringify(createMessage<ToCommandCenter, "heartbeat">("heartbeat", {}))),
      HEARTBEAT_INTERVAL_MS,
    );
  } else {
    console.log("not sending heartbeats: expect a timeout");
  }
});

ws.on("message", (data) => {
  const parsed = parseMessage(FromCommandCenterSchema, data.toString());
  if (!parsed.ok) return console.log(`<- ${data.toString()}`);
  const { type, payload } = parsed.message;
  console.log(`<- ${type} ${JSON.stringify(payload)}`);
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
