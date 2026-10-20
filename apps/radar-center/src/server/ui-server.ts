// The radar's operator page (served by Vite in middleware mode) and its
// WebSocket at /ws.

import { createServer as createHttpServer } from "node:http";
import { resolve } from "node:path";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, type WebSocket } from "ws";
import { UiToServerSchema, type RadarState, type ServerToUi, type UiToServer } from "../protocol";

const APP_ROOT = resolve(import.meta.dirname, "../..");

export interface UiServer {
  /** Sends the current state to every open page. */
  publish(): void;
  close(): Promise<void>;
}

/**
 * Handles one operator command. Throwing an Error sends its message back to
 * that page only, as an `error`.
 */
export type UiCommandHandler = (msg: UiToServer) => Promise<void>;

/** `currentState` is read on every publish and for every page that connects. */
export async function startUiServer(
  port: number,
  currentState: () => RadarState,
  onCommand: UiCommandHandler,
): Promise<UiServer> {
  const http = createHttpServer();
  const vite = await createViteServer({
    root: APP_ROOT,
    configFile: resolve(APP_ROOT, "vite.config.ts"),
    server: { middlewareMode: true, hmr: { server: http } },
    appType: "spa",
  });
  http.on("request", vite.middlewares);

  const wss = new WebSocketServer({ noServer: true });
  http.on("upgrade", (req, socket, head) => {
    // Vite's hot-reload socket shares this server; only take /ws.
    if (new URL(req.url ?? "/", "http://x").pathname !== "/ws") return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  const send = (ws: WebSocket, msg: ServerToUi) => ws.send(JSON.stringify(msg));
  const sendError = (ws: WebSocket, detail: string) =>
    send(ws, { type: "error", payload: { detail } });
  const stateMessage = () =>
    JSON.stringify({ type: "state", payload: currentState() } satisfies ServerToUi);

  wss.on("connection", (ws) => {
    ws.send(stateMessage());

    ws.on("message", async (data) => {
      let json: unknown;
      try {
        json = JSON.parse(data.toString());
      } catch {
        return sendError(ws, "invalid JSON");
      }
      const parsed = UiToServerSchema.safeParse(json);
      if (!parsed.success) return sendError(ws, "bad message");
      try {
        await onCommand(parsed.data);
      } catch (err) {
        sendError(ws, err instanceof Error ? err.message : String(err));
      }
    });
  });

  await new Promise<void>((done) => http.listen(port, done));
  console.log(`[ui] radar page on http://localhost:${port}`);

  return {
    publish: () => {
      const text = stateMessage();
      for (const ws of wss.clients) if (ws.readyState === ws.OPEN) ws.send(text);
    },
    close: async () => {
      for (const ws of wss.clients) ws.terminate();
      await vite.close();
      await new Promise((done) => http.close(() => done(undefined)));
    },
  };
}
