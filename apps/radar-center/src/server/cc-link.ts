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
  /**
   * Starts over with a new registration (a new key from the operator), or
   * goes idle with null. Any current connection is dropped first.
   */
  useRegistration(register: RegisterPayload | null): void;
  close(): void;
}

export interface LinkOptions {
  url: string;
  /** Null when there is no registration key yet: the link stays idle. */
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
  /** Bumped on every (re)start, so events from a replaced connection are ignored. */
  let generation = 0;

  const setStatus = (next: LinkStatus) => {
    status = next;
    opts.onStatus(next);
  };
  const send = (msg: ToCommandCenter) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  const connect = (register: RegisterPayload, gen: number) => {
    const socket = new WebSocket(opts.url);
    ws = socket;
    const current = () => gen === generation;

    socket.on("open", () => {
      if (!current()) return;
      console.log(`[cc] connected to ${opts.url}, registering`);
      send(createMessage<ToCommandCenter, "register">("register", register));
      heartbeat = setInterval(
        () => send(createMessage<ToCommandCenter, "heartbeat">("heartbeat", {})),
        HEARTBEAT_INTERVAL_MS,
      );
    });

    socket.on("message", async (data) => {
      if (!current()) return;
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
          if (!current()) return;
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

    socket.on("close", () => {
      if (!current()) return;
      clearInterval(heartbeat);
      const final =
        status.state === "revoked" ||
        (status.state === "rejected" && !RETRYABLE.includes(status.reason));
      if (stopped || final) return;
      if (status.state !== "connecting") console.log("[cc] connection lost, retrying");
      setStatus({ state: "connecting" });
      retry = setTimeout(() => connect(register, gen), RECONNECT_MS);
    });

    // A refused connection also emits "close", which schedules the retry.
    socket.on("error", () => {});
  };

  const start = (register: RegisterPayload | null) => {
    const gen = ++generation;
    clearTimeout(retry);
    clearInterval(heartbeat);
    ws?.close();
    ws = null;
    if (!register) return setStatus({ state: "no-key" });
    setStatus({ state: "connecting" });
    connect(register, gen);
  };

  if (opts.register) connect(opts.register, generation);

  return {
    status: () => status,
    unitId: () => (status.state === "registered" ? status.unitId : null),
    send,
    useRegistration: start,
    close: () => {
      stopped = true;
      generation++;
      clearTimeout(retry);
      clearInterval(heartbeat);
      ws?.close();
    },
  };
}
