import type { MapView } from "@tdts/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerToUi, UiToServer, WaveFileInfo, WorldState } from "../protocol";

const RECONNECT_MS = 1_000;

export interface WorldSocket {
  connected: boolean;
  view: MapView | null;
  waveFiles: WaveFileInfo[];
  state: WorldState | null;
  error: string | null;
  clearError(): void;
  send(msg: UiToServer): void;
}

/** Connects to the server's /ws, reconnecting on drop, and keeps the latest data. */
export function useWorldSocket(): WorldSocket {
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState<MapView | null>(null);
  const [waveFiles, setWaveFiles] = useState<WaveFileInfo[]>([]);
  const [state, setState] = useState<WorldState | null>(null);
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
        switch (msg.type) {
          case "init":
            setView(msg.payload.view);
            setWaveFiles(msg.payload.waveFiles);
            break;
          case "state":
            setState(msg.payload);
            break;
          case "waveFiles":
            setWaveFiles(msg.payload.waveFiles);
            break;
          case "error":
            setError(msg.payload.detail);
            break;
        }
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

  return { connected, view, waveFiles, state, error, clearError, send };
}
