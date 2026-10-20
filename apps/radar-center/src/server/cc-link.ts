// Connection to the Command Center (DESIGN.md §3): register with the
// registration key, prove the device key by signing the challenge, then keep
// sending heartbeats. Reconnects on its own unless the Command Center said no
// for good (rejected or revoked).

import {
  createMessage,
  FromCommandCenterSchema,
  HEARTBEAT_INTERVAL_MS,
  parseMessage,
  signChallenge,
  type DeviceKeys,
  type FromCommandCenter,
  type PayloadOf,
  type RejectReason,
  type ToCommandCenter,
} from "@tdts/shared";
import WebSocket from "ws";
import type { LinkStatus } from "../protocol";

const RECONNECT_MS = 2_000;

/** Rejections worth retrying: the old connection may still be timing out. */
const RETRYABLE: readonly RejectReason[] = ["ALREADY_CONNECTED"];

export type RegisterPayload = PayloadOf<ToCommandCenter, "register">;

export interface CommandCenterLink {
  status(): LinkStatus;
  /** The registered unit id, or null until registered. */
  unitId(): string | null;
  send(msg: ToCommandCenter): void;
  close(): void;
}

export interface LinkOptions {
  url: string;
  /** Null when no registration key is configured: the link stays idle. */
  register: RegisterPayload | null;
  device: DeviceKeys;
  onStatus(status: LinkStatus): void;
  /** Everything after registration (tracks requests, kill checks, …) goes here. */
  onMessage?(msg: FromCommandCenter): void;
}

export function connectToCommandCenter(opts: LinkOptions): CommandCenterLink {
  let status: LinkStatus = opts.register ? { state: "connecting" } : { state: "no-key" };
  let ws: WebSocket | null = null;
  let heartbeat: NodeJS.Timeout | undefined;
  let retry: NodeJS.Timeout | undefined;
  let stopped = false;

  const setStatus = (next: LinkStatus) => {
    status = next;
    opts.onStatus(next);
  };
  const send = (msg: ToCommandCenter) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  const connect = (register: RegisterPayload) => {
    ws = new WebSocket(opts.url);

    ws.on("open", () => {
      console.log(`[cc] connected to ${opts.url}, registering`);
      send(createMessage<ToCommandCenter, "register">("register", register));
      heartbeat = setInterval(
        () => send(createMessage<ToCommandCenter, "heartbeat">("heartbeat", {})),
        HEARTBEAT_INTERVAL_MS,
      );
    });

    ws.on("message", async (data) => {
      const parsed = parseMessage(FromCommandCenterSchema, data.toString());
      if (!parsed.ok) return console.warn(`[cc] unexpected message: ${data.toString()}`);
      const msg = parsed.message;

      switch (msg.type) {
        case "challenge": {
          const signature = await signChallenge(
            opts.device.privateKey,
            msg.payload.nonce,
            register.key,
          );
          send(
            createMessage<ToCommandCenter, "challengeResponse">("challengeResponse", { signature }),
          );
          setStatus({ state: "verifying" });
          return;
        }
        case "registered":
          console.log(`[cc] registered as ${msg.payload.unitId}`);
          return setStatus({ state: "registered", unitId: msg.payload.unitId });
        case "pending":
          console.log(
            `[cc] waiting for operator approval (${Math.round(msg.payload.distanceM)} m off)`,
          );
          return setStatus({ state: "pending", distanceM: msg.payload.distanceM });
        case "rejected":
          console.log(`[cc] rejected: ${msg.payload.reason}`);
          return setStatus({
            state: "rejected",
            reason: msg.payload.reason,
            ...(msg.payload.detail ? { detail: msg.payload.detail } : {}),
          });
        case "revoked":
          console.log("[cc] our key was revoked");
          return setStatus({ state: "revoked" });
        default:
          opts.onMessage?.(msg);
      }
    });

    ws.on("close", () => {
      clearInterval(heartbeat);
      const final =
        status.state === "revoked" ||
        (status.state === "rejected" && !RETRYABLE.includes(status.reason));
      if (stopped || final) return;
      if (status.state !== "connecting") console.log("[cc] connection lost, retrying");
      setStatus({ state: "connecting" });
      retry = setTimeout(() => connect(register), RECONNECT_MS);
    });

    // A refused connection also emits "close", which schedules the retry.
    ws.on("error", () => {});
  };

  if (opts.register) connect(opts.register);

  return {
    status: () => status,
    unitId: () => (status.state === "registered" ? status.unitId : null),
    send,
    close: () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(heartbeat);
      ws?.close();
    },
  };
}
