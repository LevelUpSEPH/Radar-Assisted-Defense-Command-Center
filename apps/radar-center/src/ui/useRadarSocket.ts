import { useCallback, useEffect, useRef, useState } from "react";
import type { RadarState, ServerToUi, UiToServer } from "../protocol";

const RECONNECT_MS = 1_000;

export interface RadarSocket {
  /** Page ↔ this radar's own server. */
  connected: boolean;
  state: RadarState | null;
  /** Last error the server sent back for one of this page's commands. */
  error: string | null;
  clearError(): void;
  send(msg: UiToServer): void;
}

/** Connects to the server's /ws, reconnecting on drop, and keeps the latest state. */
export function useRadarSocket(): RadarSocket {
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<RadarState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const ws = new WebSocket(`ws://${location.host}/ws`);
      socket.current = ws;
      // Events from a socket that was already replaced (e.g. by React's dev
      // double-mount) must not touch the state of the current one.
      const isCurrent = () => socket.current === ws;
      ws.onopen = () => {
        if (isCurrent()) setConnected(true);
      };
      ws.onclose = () => {
        if (!isCurrent()) return;
        setConnected(false);
        if (!stopped) retry = setTimeout(connect, RECONNECT_MS);
      };
      ws.onmessage = (event: MessageEvent<string>) => {
        if (!isCurrent()) return;
        const msg = JSON.parse(event.data) as ServerToUi;
        if (msg.type === "state") setState(msg.payload);
        else if (msg.type === "error") setError(msg.payload.detail);
      };
    };
    connect();

    return () => {
      stopped = true;
      clearTimeout(retry);
      const ws = socket.current;
      socket.current = null;
      ws?.close();
    };
  }, []);

  const send = useCallback((msg: UiToServer) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(msg));
  }, []);
  const clearError = useCallback(() => setError(null), []);

  return { connected, state, error, clearError, send };
}
