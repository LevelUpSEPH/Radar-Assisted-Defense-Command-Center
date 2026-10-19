// Port 7001: the truth-map page (served by Vite in middleware mode) and its
// WebSocket at /ws (DESIGN.md §5).

import { createServer as createHttpServer } from "node:http";
import { resolve } from "node:path";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, type WebSocket } from "ws";
import { UiToServerSchema, type ServerToUi, type WaveFileInfo, type WorldState } from "../protocol";
import { listWaveFiles, loadWave } from "./waves";
import type { World } from "./world";

const APP_ROOT = resolve(import.meta.dirname, "../..");

export interface UiServer {
  broadcastState(state: WorldState): void;
  close(): Promise<void>;
}

export async function startUiServer(
  port: number,
  world: World,
  wavesDir: string,
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
  const broadcast = (msg: ServerToUi) => {
    const text = JSON.stringify(msg);
    for (const ws of wss.clients) if (ws.readyState === ws.OPEN) ws.send(text);
  };
  const waveFiles = (): Promise<WaveFileInfo[]> => listWaveFiles(wavesDir);

  wss.on("connection", async (ws) => {
    send(ws, {
      type: "init",
      payload: { cities: [...world.cities], waveFiles: await waveFiles() },
    });

    ws.on("message", async (data) => {
      let json: unknown;
      try {
        json = JSON.parse(data.toString());
      } catch {
        return send(ws, { type: "error", payload: { detail: "invalid JSON" } });
      }
      const parsed = UiToServerSchema.safeParse(json);
      if (!parsed.success) return send(ws, { type: "error", payload: { detail: "bad message" } });
      const msg = parsed.data;

      switch (msg.type) {
        case "startWave": {
          const result = await loadWave(wavesDir, msg.payload.file);
          if (result.ok) world.startWave(result.wave, msg.payload.file, Date.now());
          else
            send(ws, {
              type: "error",
              payload: { detail: `${msg.payload.file}: ${result.error}` },
            });
          break;
        }
        case "stopAll":
          world.stopAll(Date.now());
          break;
        case "refreshWaves":
          broadcast({ type: "waveFiles", payload: { waveFiles: await waveFiles() } });
          break;
      }
    });
  });

  await new Promise<void>((done) => http.listen(port, done));
  console.log(`[ui] truth map on http://localhost:${port}`);

  return {
    broadcastState: (state) => broadcast({ type: "state", payload: state }),
    close: async () => {
      for (const ws of wss.clients) ws.terminate();
      await vite.close();
      await new Promise((done) => http.close(() => done(undefined)));
    },
  };
}
