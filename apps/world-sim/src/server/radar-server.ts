// Port 7000: radars only (DESIGN.md §4). This is what radars "see"; nothing
// else in the network connects to the world.

import {
  createMessage,
  parseMessage,
  ToWorldSimSchema,
  type ErrorMessage,
  type FromWorldSim,
} from "@tdts/shared";
import { WebSocketServer, type WebSocket } from "ws";
import type { ConnectedRadar } from "../protocol";
import type { World } from "./world";

export interface RadarServer {
  radars(): ConnectedRadar[];
  close(): Promise<void>;
}

export function startRadarServer(port: number, world: World): RadarServer {
  const wss = new WebSocketServer({ port });
  const radars = new Map<WebSocket, ConnectedRadar>();

  const send = (ws: WebSocket, msg: FromWorldSim | ErrorMessage) => ws.send(JSON.stringify(msg));
  const sendError = (ws: WebSocket, code: string, detail: string) =>
    send(ws, createMessage<ErrorMessage, "error">("error", { code, detail }));

  wss.on("connection", (ws) => {
    ws.on("message", (data) => {
      const parsed = parseMessage(ToWorldSimSchema, data.toString());
      if (!parsed.ok) return sendError(ws, "BAD_MESSAGE", parsed.error);
      const msg = parsed.message;

      if (msg.type === "hello") {
        radars.set(ws, { ...msg.payload });
        console.log(`[radars] ${msg.payload.radarId} connected`);
        return;
      }

      const radar = radars.get(ws);
      if (!radar) return sendError(ws, "NOT_IDENTIFIED", `send hello before ${msg.type}`);

      switch (msg.type) {
        case "scan":
          send(
            ws,
            createMessage<FromWorldSim, "scanResult">("scanResult", {
              scanId: msg.payload.scanId,
              observedAt: world.observedAt ?? Date.now(),
              detections: world.scan(msg.payload.position, msg.payload.rangeM),
            }),
          );
          break;
        case "targetHit":
          // Several radars may report the same hit; only the first one removes it.
          world.hit(msg.payload.truthId, radar.radarId, Date.now());
          break;
      }
    });

    ws.on("close", () => {
      const radar = radars.get(ws);
      if (radar) console.log(`[radars] ${radar.radarId} disconnected`);
      radars.delete(ws);
    });
  });

  wss.on("listening", () => console.log(`[radars] listening on ws://localhost:${port}`));

  return {
    radars: () => [...radars.values()],
    close: () => new Promise((done) => wss.close(() => done())),
  };
}
