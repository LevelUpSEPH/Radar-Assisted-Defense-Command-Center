# World Simulator — Design

Part of [TDTS](../../docs/DESIGN.md). Status: **milestone 2 done**.

The World Simulator stands in for the physical world. It owns the **ground truth**: where every target really is, what kind it is and where it is going.

It is not part of the defense network, and **only radars connect to it**: it is what radars see. The Command Center never talks to it, and weapons don't either. They shoot where they are told. The one way the network affects the world is a **hit**: when a weapon's shot arrives, the radar tracking that target tells the world to remove it.

---

## 1. Responsibilities

- Load wave files; spawn and move targets in real time.
- Answer radar scans with what is physically within range.
- Remove a target when a radar reports it was hit.
- Show a "truth" map for comparing against what the Command Center believes.

Not its job: simulating shells, deciding whether a shot hits (a computed shot always hits), tracking, classification, or anything about engagements.

---

## 2. Running it

```bash
npm run dev -w @tdts/world-sim
```

Config path defaults to `scenario/world-sim.json`; pass `-- --config <path>` to use another. Paths inside the config are relative to the config file.

```json
{
  "port": 7000,
  "uiPort": 7001,
  "wavesDir": "waves",
  "view": { "center": { "lat": 47.2, "lon": 8.0 }, "zoom": 8 }
}
```

| Setting    | What                                                    |
| ---------- | ------------------------------------------------------- |
| `port`     | WebSocket for radars                                    |
| `uiPort`   | Truth map web page (`http://localhost:7001`) and its WS |
| `wavesDir` | Folder of wave files                                    |
| `view`     | Where the truth map starts (center, zoom)               |

---

## 3. World model

### Targets

Each target in a wave file becomes a live target when its wave starts:

- **Id:** `<run id>-<target id>`, e.g. `W2-t1`. Each started wave gets a run id `W1`, `W2`, …, so the same file can be started twice.
- **Life cycle:** `SCHEDULED → FLYING → ARRIVED | DESTROYED`. A target spawns at `wave start + spawnAtS`, flies a great-circle line to its destination at constant speed, and is removed when it arrives or is hit.
- **Heading** is the bearing from its current position to its destination, updated every tick.
- **Radar signature** is fixed at spawn from its kind, with ±0.05 random variation:

| kind       | base signature | answers IFF |
| ---------- | -------------- | ----------- |
| `drone`    | 0.90           | no          |
| `friendly` | 0.90           | yes         |
| `bird`     | 0.20           | no          |

### Waves

- Wave files live in `wavesDir` and follow `WaveFileSchema` (see the system design). A destination is just a point; it isn't a city or a protected area.
- The UI lists every file in the folder. The list is re-read on request, so new files appear without a restart. Invalid files are listed with their validation error.
- Several waves can run at once. A wave run is **finished** when all its targets have arrived or been destroyed.
- **Stop all** removes every target immediately.

### Hits

- A radar sends `targetHit { truthId }` for an object it tracks, after the Command Center told it a weapon's shot arrived.
- The target is removed as **destroyed**, and the kill is shown on the map for 3 s.
- Several radars may track the same target and all report the hit; the first report removes it, the rest are ignored.

### Tick

Every `WORLD_TICK_MS` (100 ms), in this order:

1. Spawn scheduled targets whose time has come.
2. Move flying targets. Mark arrivals.
3. Mark finished wave runs.
4. Push a state snapshot to connected UIs.

The simulation logic is a plain class (`World`) driven by `tick(now)`, with no timers or sockets inside, so it can be unit-tested with a fake clock.

---

## 4. Radar link (port 7000)

Uses `ToWorldSimSchema` / `FromWorldSimSchema` from `@tdts/shared`.

| Message               | Behavior                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `hello`               | Identifies the radar (radarId, position, range). Required before anything else; it also puts the radar on the truth map.            |
| `scan` → `scanResult` | Every **flying** target within `rangeM` of `position` (2D distance): truthId, exact position, altitude, signature and IFF response. |
| `targetHit`           | Removes that target as destroyed (see Hits).                                                                                        |
| anything invalid      | `error { code, detail }`; the connection stays open. Codes: `BAD_MESSAGE`, `NOT_IDENTIFIED`.                                        |

Scan results are **exact**. Adding noise is the radar's job, so each radar can have its own noise level.

Every `scanResult` carries `observedAt`: the time of the world tick its positions belong to. Radars must time-stamp observations with it, not with the time the reply arrived. Tick jitter (up to 100 ms) on a 1–2 s scan interval is otherwise a few percent of speed error, which is hundreds of meters of aiming error on a long shot.

Connected radars are listed on the truth map; they are removed when their socket closes.

---

## 5. UI (port 7001)

A single page: a map, plus a sidebar.

**Map**

- Targets as dots colored by true kind (drone red, friendly blue, bird amber), with a dashed line to their destination and a tooltip (id, kind, speed, altitude).
- Connected radars with their range circles.
- Kills as an orange ring where the target was destroyed, fading over 3 s.

**Sidebar**

- **Counters:** drones, friendlies and birds flying; total destroyed.
- **Wave files:** each file with its name and target count (or its error), and a Start button. Refresh and Stop all buttons.
- **Waves:** run id, name, and counts (waiting / flying / arrived / destroyed).
- **Connected radars.**
- **Event log:** wave started/finished, target appeared/arrived/destroyed.

### UI channel (`/ws` on the UI port)

Defined in `src/protocol.ts`, private to this program. Messages are `{ type, payload }`.

| Direction   | type           | payload                                           |
| ----------- | -------------- | ------------------------------------------------- |
| server → UI | `init`         | map view, wave files                              |
| server → UI | `state`        | now, targets, kills, radars, wave runs, event log |
| server → UI | `waveFiles`    | wave files (after a refresh)                      |
| server → UI | `error`        | detail                                            |
| UI → server | `startWave`    | file                                              |
| UI → server | `stopAll`      | —                                                 |
| UI → server | `refreshWaves` | —                                                 |

`state` is sent every tick (10 Hz). It's the full picture, not a diff, which is simple and plenty fast at this scale.

The UI is served by the same Node process through Vite's middleware mode, so there is one process and one port, with hot reload during development.

---

## 6. Code layout

```
apps/world-sim/
├─ index.html, vite.config.ts
└─ src/
   ├─ protocol.ts          UI channel schemas (server + browser)
   ├─ server/
   │  ├─ main.ts           entry: config, servers, tick loop
   │  ├─ config.ts         config file schema and loading
   │  ├─ world.ts          World: the simulation (pure, testable)
   │  ├─ waves.ts          listing and loading wave files
   │  ├─ radar-server.ts   port 7000 WebSocket (radars only)
   │  └─ ui-server.ts      HTTP + Vite + /ws for the UI
   └─ ui/                  React app: map + sidebar
```

---

## 7. Tests

`World` is tested with a fake clock: spawn timing, movement and arrival, scan range and contents, hits (including duplicate reports and not-yet-spawned targets), kill display timing, wave-run completion, stop all.

## 8. Later

- Define regions (where things happen, the starting map view) from the World Simulator UI.
