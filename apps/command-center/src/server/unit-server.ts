// Port 7100: radars and weapons (DESIGN.md §3). Sockets only; every decision
// is made by the Registry.

import {
  createMessage,
  HEARTBEAT_INTERVAL_MS,
  parseMessage,
  ToCommandCenterSchema,
  type ErrorMessage,
  type FromCommandCenter,
  type PayloadOf,
  type ToCommandCenter,
  type RejectReason,
} from "@tdts/shared";
import { WebSocketServer, type WebSocket } from "ws";
import type { Registry, RegisterResult } from "./registry";

export interface UnitServer {
  /** Sends a message to a registered unit; false if it isn't online. */
  sendTo(unitId: string, msg: FromCommandCenter): boolean;
  /** Tells a pending unit it was approved. */
  confirmRegistered(connId: string, unitId: string): void;
  /** Tells the unit why and closes its connection (e.g. its key was deleted). */
  disconnect(connId: string, why: "revoked" | RejectReason): void;
  close(): Promise<void>;
}

export interface UnitServerEvents {
  /** A registration attempt was answered (registered units must be saved). */
  onRegister(result: RegisterResult): void;
  /** A registered radar reported a sweep. */
  onTracks(unitId: string, report: PayloadOf<ToCommandCenter, "tracks">): void;
  /** A registered weapon fired. */
  onShotFired(unitId: string, shot: PayloadOf<ToCommandCenter, "shotFired">): void;
  /** A registered weapon couldn't fire. */
  onFireFailed(unitId: string, report: PayloadOf<ToCommandCenter, "fireFailed">): void;
  /** A registered radar answered a kill check. */
  onKillReport(unitId: string, report: PayloadOf<ToCommandCenter, "killReport">): void;
  /** A registered weapon reported its status. */
  onWeaponStatus(unitId: string, status: PayloadOf<ToCommandCenter, "status">): void;
  /** A registered unit's connection ended (disconnect, timeout, revoke). */
  onUnitGone(unitId: string): void;
  /** Something visible to the operator changed (connect, disconnect, timeout). */
  onChange(): void;
}

export function startUnitServer(
  port: number,
  registry: Registry,
  events: UnitServerEvents,
): UnitServer {
  const wss = new WebSocketServer({ port });
  const sockets = new Map<string, WebSocket>();
  let nextId = 0;

  const send = (ws: WebSocket, msg: FromCommandCenter | ErrorMessage) =>
    ws.send(JSON.stringify(msg));
  const sendError = (ws: WebSocket, code: string, detail: string) =>
    send(ws, createMessage<ErrorMessage, "error">("error", { code, detail }));

  wss.on("connection", (ws) => {
    const connId = `conn-${++nextId}`;
    sockets.set(connId, ws);
    registry.connect(connId, Date.now());

    ws.on("message", (data) => {
      const parsed = parseMessage(ToCommandCenterSchema, data.toString());
      if (!parsed.ok) return sendError(ws, "BAD_MESSAGE", parsed.error);
      const msg = parsed.message;
      const now = Date.now();

      switch (msg.type) {
        case "register": {
          // Step 1: key checks, then a challenge only the real device can sign.
          const result = registry.register(connId, msg.payload, now);
          const who = `${msg.payload.unitType} "${msg.payload.name}"`;
          if (result.kind === "rejected") {
            answerRegistration(ws, result);
            console.log(`[units] ${who} rejected: ${result.reason}`);
            ws.close();
            events.onChange();
          } else {
            send(
              ws,
              createMessage<FromCommandCenter, "challenge">("challenge", { nonce: result.nonce }),
            );
          }
          return;
        }
        case "challengeResponse": {
          // Step 2: verify the signature, then register, hold as pending, or reject.
          void registry.answerChallenge(connId, msg.payload.signature, now).then((result) => {
            if (ws.readyState !== ws.OPEN) return;
            answerRegistration(ws, result);
            if (result.kind === "registered") console.log(`[units] ${result.unitId} registered`);
            if (result.kind === "pending") {
              console.log(
                `[units] ${connId} pending: ${Math.round(result.distanceM)} m from expected position`,
              );
            }
            if (result.kind === "rejected") {
              console.log(`[units] ${connId} rejected: ${result.reason}`);
              ws.close();
            }
            events.onRegister(result);
            events.onChange();
          });
          return;
        }
        case "heartbeat":
          registry.heartbeat(connId, now);
          return;
        case "tracks": {
          const unitId = registry.unitOn(connId);
          if (!unitId) return sendError(ws, "NOT_REGISTERED", "register before tracks");
          if (registry.unitTypeOf(unitId) !== "radar") {
            return sendError(ws, "WRONG_UNIT_TYPE", "only radars report tracks");
          }
          events.onTracks(unitId, msg.payload);
          return;
        }
        case "status":
        case "shotFired":
        case "fireFailed": {
          const unitId = registry.unitOn(connId);
          if (!unitId) return sendError(ws, "NOT_REGISTERED", `register before ${msg.type}`);
          if (registry.unitTypeOf(unitId) !== "weapon") {
            return sendError(ws, "WRONG_UNIT_TYPE", `only weapons send ${msg.type}`);
          }
          if (msg.type === "status") return events.onWeaponStatus(unitId, msg.payload);
          if (msg.type === "shotFired") return events.onShotFired(unitId, msg.payload);
          return events.onFireFailed(unitId, msg.payload);
        }
        case "killReport": {
          const unitId = registry.unitOn(connId);
          if (!unitId) return sendError(ws, "NOT_REGISTERED", "register before killReport");
          if (registry.unitTypeOf(unitId) !== "radar") {
            return sendError(ws, "WRONG_UNIT_TYPE", "only radars confirm kills");
          }
          return events.onKillReport(unitId, msg.payload);
        }
      }
    });

    ws.on("close", () => {
      const unitId = registry.unitOn(connId);
      if (unitId) {
        console.log(`[units] ${unitId} disconnected`);
        events.onUnitGone(unitId);
      }
      registry.disconnect(connId);
      sockets.delete(connId);
      events.onChange();
    });
  });

  function answerRegistration(ws: WebSocket, result: RegisterResult) {
    switch (result.kind) {
      case "registered":
        return send(
          ws,
          createMessage<FromCommandCenter, "registered">("registered", { unitId: result.unitId }),
        );
      case "pending":
        return send(
          ws,
          createMessage<FromCommandCenter, "pending">("pending", {
            reason: "POSITION_MISMATCH",
            distanceM: result.distanceM,
          }),
        );
      case "rejected":
        return send(
          ws,
          createMessage<FromCommandCenter, "rejected">("rejected", {
            reason: result.reason,
            ...(result.detail ? { detail: result.detail } : {}),
          }),
        );
    }
  }

  // Close connections that stopped sending heartbeats.
  const timer = setInterval(() => {
    for (const connId of registry.timedOut(Date.now())) {
      console.log(`[units] ${registry.unitOn(connId) ?? connId} timed out`);
      sockets.get(connId)?.terminate();
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on("listening", () => console.log(`[units] listening on ws://localhost:${port}`));

  return {
    confirmRegistered: (connId, unitId) => {
      const ws = sockets.get(connId);
      if (ws) answerRegistration(ws, { kind: "registered", unitId });
    },
    sendTo: (unitId, msg) => {
      const connId = registry.connectionOfUnit(unitId);
      const ws = connId ? sockets.get(connId) : undefined;
      if (!ws || ws.readyState !== ws.OPEN) return false;
      send(ws, msg);
      return true;
    },
    disconnect: (connId, why) => {
      const ws = sockets.get(connId);
      if (!ws) return;
      send(
        ws,
        why === "revoked"
          ? createMessage<FromCommandCenter, "revoked">("revoked", {})
          : createMessage<FromCommandCenter, "rejected">("rejected", { reason: why }),
      );
      ws.close();
    },
    close: () => {
      clearInterval(timer);
      for (const ws of sockets.values()) ws.terminate();
      return new Promise((done) => wss.close(() => done()));
    },
  };
}
