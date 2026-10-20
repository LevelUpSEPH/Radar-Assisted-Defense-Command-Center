// Connection to the World Simulator (DESIGN.md §3–4): this is what the radar
// "sees". Says hello, then scans every scanIntervalMs and hands each result to
// `onScan`. Reconnects on its own. Scanning doesn't depend on the Command
// Center: a radar keeps watching the sky even while unregistered.

import {
  createMessage,
  FromWorldSimSchema,
  parseMessage,
  type Detection,
  type LatLon,
  type ToWorldSim,
} from "@tdts/shared";
import WebSocket from "ws";

const RECONNECT_MS = 2_000;

export interface WorldLinkOptions {
  url: string;
  radarId: string;
  position: LatLon;
  rangeM: number;
  scanIntervalMs: number;
  onScan(detections: Detection[], observedAt: number): void;
  onStatus(connected: boolean): void;
}

export interface WorldLink {
  connected(): boolean;
  send(msg: ToWorldSim): void;
  close(): void;
}

export function connectToWorld(opts: WorldLinkOptions): WorldLink {
  let ws: WebSocket | null = null;
  let isConnected = false;
  let scanTimer: NodeJS.Timeout | undefined;
  let retry: NodeJS.Timeout | undefined;
  let stopped = false;
  let scanCounter = 0;
  /** The scan we're waiting for; a late answer to an older one is ignored. */
  let awaiting: string | null = null;

  const send = (msg: ToWorldSim) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  const scan = () => {
    awaiting = `S${++scanCounter}`;
    send(
      createMessage<ToWorldSim, "scan">("scan", {
        scanId: awaiting,
        position: opts.position,
        rangeM: opts.rangeM,
      }),
    );
  };

  const connect = () => {
    ws = new WebSocket(opts.url);

    ws.on("open", () => {
      isConnected = true;
      console.log(`[world] connected to ${opts.url}`);
      send(
        createMessage<ToWorldSim, "hello">("hello", {
          radarId: opts.radarId,
          position: opts.position,
          rangeM: opts.rangeM,
        }),
      );
      scan();
      scanTimer = setInterval(scan, opts.scanIntervalMs);
      opts.onStatus(true);
    });

    ws.on("message", (data) => {
      const parsed = parseMessage(FromWorldSimSchema, data.toString());
      if (!parsed.ok) return console.warn(`[world] unexpected message: ${data.toString()}`);
      const msg = parsed.message;
      if (msg.type === "scanResult" && msg.payload.scanId === awaiting) {
        awaiting = null;
        opts.onScan(msg.payload.detections, msg.payload.observedAt);
      }
    });

    ws.on("close", () => {
      clearInterval(scanTimer);
      if (isConnected) console.log("[world] disconnected, retrying");
      isConnected = false;
      opts.onStatus(false);
      if (!stopped) retry = setTimeout(connect, RECONNECT_MS);
    });

    // A refused connection also emits "close", which schedules the retry.
    ws.on("error", () => {});
  };
  connect();

  return {
    connected: () => isConnected,
    send,
    close: () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(scanTimer);
      ws?.close();
    },
  };
}
