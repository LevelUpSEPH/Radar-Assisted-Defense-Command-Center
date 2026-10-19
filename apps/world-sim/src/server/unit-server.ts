// Port 7000: radars, weapons and the Command Center (DESIGN.md §4).

import {
  createMessage,
  parseMessage,
  ToWorldSimSchema,
  type ErrorMessage,
  type FromWorldSim,
} from "@tdts/shared";
import { WebSocketServer, type WebSocket } from "ws";
import type { ConnectedUnit } from "../protocol";
import type { World } from "./world";

export interface UnitServer {
  units(): ConnectedUnit[];
  close(): Promise<void>;
}

export function startUnitServer(port: number, world: World): UnitServer {
  const wss = new WebSocketServer({ port });
  const identities = new Map<WebSocket, ConnectedUnit>();

  const send = (ws: WebSocket, msg: FromWorldSim | ErrorMessage) => ws.send(JSON.stringify(msg));
  const sendError = (ws: WebSocket, code: string, detail: string) =>
    send(ws, createMessage<ErrorMessage, "error">("error", { code, detail }));

  wss.on("connection", (ws) => {
    ws.on("message", (data) => {
      const parsed = parseMessage(ToWorldSimSchema, data.toString());
      if (!parsed.ok) return sendError(ws, "BAD_MESSAGE", parsed.error);
      const msg = parsed.message;

      if (msg.type === "hello") {
        const unit: ConnectedUnit = { ...msg.payload };
        identities.set(ws, unit);
        console.log(`[units] ${unit.unitType} ${unit.unitId} connected`);
        return;
      }
      if (msg.type === "getCities") {
        return send(
          ws,
          createMessage<FromWorldSim, "cities">("cities", { cities: [...world.cities] }),
        );
      }

      const unit = identities.get(ws);
      if (!unit) return sendError(ws, "NOT_IDENTIFIED", `send hello before ${msg.type}`);

      switch (msg.type) {
        case "scan": {
          const detections = world.scan(msg.payload.position, msg.payload.rangeM);
          send(
            ws,
            createMessage<FromWorldSim, "scanResult">("scanResult", {
              scanId: msg.payload.scanId,
              observedAt: world.observedAt ?? Date.now(),
              detections,
            }),
          );
          break;
        }
        case "shell": {
          const result = world.addShell(msg.payload, unit.unitId, Date.now());
          if (!result.ok) sendError(ws, "BAD_SHELL", result.error);
          break;
        }
      }
    });

    ws.on("close", () => {
      const unit = identities.get(ws);
      if (unit) console.log(`[units] ${unit.unitType} ${unit.unitId} disconnected`);
      identities.delete(ws);
    });
  });

  wss.on("listening", () => console.log(`[units] listening on ws://localhost:${port}`));

  return {
    units: () => [...identities.values()],
    close: () => new Promise((done) => wss.close(() => done())),
  };
}
