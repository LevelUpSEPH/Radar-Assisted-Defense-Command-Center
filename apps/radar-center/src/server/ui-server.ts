// The radar's operator page (served by Vite in middleware mode) and its
// WebSocket at /ws. For now the page only watches; commands come later.

import { createServer as createHttpServer } from "node:http";
import { resolve } from "node:path";
import { createServer as createViteServer } from "vite";
import { WebSocketServer } from "ws";
import type { RadarState, ServerToUi } from "../protocol";

const APP_ROOT = resolve(import.meta.dirname, "../..");

export interface UiServer {
  /** Sends the current state to every open page. */
  publish(): void;
  close(): Promise<void>;
}

/** `currentState` is read on every publish and for every page that connects. */
export async function startUiServer(
  port: number,
  currentState: () => RadarState,
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

  const stateMessage = () =>
    JSON.stringify({ type: "state", payload: currentState() } satisfies ServerToUi);
  wss.on("connection", (ws) => ws.send(stateMessage()));

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
