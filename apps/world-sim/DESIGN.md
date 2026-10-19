# World Simulator — Design

Part of [TDTS](../../docs/DESIGN.md). Status: **milestone 2 done**.

The World Simulator stands in for the physical world. It owns the **ground truth**: where cities are, where every target really is, which shells are in the air, and what an impact destroys. It is the only program that knows a target's true kind and destination.

It is not part of the defense network: radars and weapons connect to it only to "sense" and to "fire", the way real devices interact with the world around them.

---

## 1. Responsibilities

- Load cities and wave files.
- Spawn and move targets in real time.
- Answer radar scans with what is physically within range.
- Fly shells and resolve impacts.
- Show a "truth" map for comparing against what the Command Center believes.

Not its job: tracking, classification, or deciding anything about engagements.

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
  "citiesFile": "cities.json",
  "wavesDir": "waves"
}
```

| Port     | What                                                    |
| -------- | ------------------------------------------------------- |
| `port`   | WebSocket for radars, weapons and the Command Center    |
| `uiPort` | Truth map web page (`http://localhost:7001`) and its WS |

---

## 3. World model

### Cities

From `citiesFile` (`CitiesFileSchema`). Each has an id, a name, a real position and a radius. Defining regions and cities from inside the program comes later; until then the file is edited by hand.

### Targets

Each target in a wave file becomes a live target when its wave starts:

- **Id:** `<run id>-<target id>`, e.g. `W2-t1`. Each started wave gets a run id `W1`, `W2`, …, so the same file can be started twice.
- **Life cycle:** `SCHEDULED → FLYING → ARRIVED | DESTROYED`. A target spawns at `wave start + spawnAtS`, flies a great-circle line to its destination at constant speed, and is removed when it arrives or is destroyed.
- **Heading** is the bearing from its current position to its destination, updated every tick.
- **Radar signature** is fixed at spawn from its kind, with ±0.05 random variation:

| kind       | base signature | answers IFF |
| ---------- | -------------- | ----------- |
| `drone`    | 0.90           | no          |
| `friendly` | 0.90           | yes         |
| `bird`     | 0.20           | no          |

### Waves

- Wave files live in `wavesDir` and follow `WaveFileSchema` (see the system design).
- The UI lists every file in the folder. The list is re-read on request, so new files appear without a restart. Invalid files are listed with their validation error.
- Several waves can run at once. A wave run is **finished** when all its targets have arrived or been destroyed.
- **Stop all** removes every target and shell immediately.

### Shells

- A weapon sends `shell { shellId, from, impactPoint, firedAt, impactAt }`.
- The shell is kept until `impactAt`. Its position in between is interpolated linearly along the great circle; it's only for display.
- **At impact,** every flying target within `BLAST_RADIUS_M` of `impactPoint` **at the moment `impactAt`** is destroyed. To be exact, each target's position is extrapolated from the last tick to `impactAt`, so the 100 ms tick doesn't blur the result.
- The impact is kept for 3 s for the UI blast effect, together with the ids it destroyed.

### Tick

Every `WORLD_TICK_MS` (100 ms), in this order:

1. Resolve shells whose `impactAt` has passed.
2. Spawn scheduled targets whose time has come.
3. Move flying targets. Mark arrivals.
4. Mark finished wave runs.
5. Push a state snapshot to connected UIs.

The simulation logic is a plain class (`World`) driven by `tick(now)`, with no timers or sockets inside, so it can be unit-tested with a fake clock.

---

## 4. Unit link (port 7000)

Uses `ToWorldSimSchema` / `FromWorldSimSchema` from `@tdts/shared`.

| Message                | Behavior                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `hello`                | Identifies the connection (unitId, type, position). Required before `scan` or `shell`; it's also what lets the truth map show units.        |
| `scan` → `scanResult`  | Every **flying** target within `rangeM` of `position` (2D distance). Returns truthId, exact position, altitude, signature and IFF response. |
| `shell`                | Accepted if `impactAt > firedAt`. An `impactAt` already in the past resolves on the next tick.                                              |
| `getCities` → `cities` | The city list.                                                                                                                              |
| anything invalid       | `error { code, detail }`; the connection stays open. Codes: `BAD_MESSAGE`, `NOT_IDENTIFIED`, `BAD_SHELL`.                                   |

Scan results are **exact**. Adding noise is the radar's job, so each radar can have its own noise level.

Every `scanResult` carries `observedAt`: the time of the world tick its positions belong to. Radars must time-stamp observations with it, not with the time the reply arrived. Tick jitter (up to 100 ms) on a 1–2 s scan interval is otherwise a few percent of speed error, which is hundreds of meters at impact on a long shot. The first end-to-end test shot missed by exactly that.

Connected units are listed on the truth map; they are removed when their socket closes.

---

## 5. UI (port 7001)

A single page: a map, plus a sidebar.

**Map**

- Cities as circles of their radius, with names.
- Targets as dots colored by true kind (drone red, friendly blue, bird amber), with a dashed line to their destination and a tooltip (id, kind, speed, altitude).
- Connected radars and weapons as markers.
- Shells as a line from launch to impact point, with a moving dot.
- Impacts as a blast-radius circle that fades over 3 s.

**Sidebar**

- **Waves:** each file with its name and target count (or its error), and a Start button. Refresh and Stop all buttons.
- **Running waves:** run id, name, and counts (scheduled / flying / arrived / destroyed).
- **Connected units.**
- **Event log:** wave started/finished, target spawned/arrived/destroyed, shell fired/impact.

### UI channel (`/ws` on the UI port)

Defined in `src/protocol.ts`, private to this program. Messages are `{ type, payload }`.

| Direction   | type           | payload                                                    |
| ----------- | -------------- | ---------------------------------------------------------- |
| server → UI | `init`         | cities, wave files                                         |
| server → UI | `state`        | now, targets, shells, impacts, units, wave runs, event log |
| server → UI | `waveFiles`    | wave files (after a refresh)                               |
| server → UI | `error`        | detail                                                     |
| UI → server | `startWave`    | file                                                       |
| UI → server | `stopAll`      | —                                                          |
| UI → server | `refreshWaves` | —                                                          |

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
   │  ├─ unit-server.ts    port 7000 WebSocket
   │  └─ ui-server.ts      HTTP + Vite + /ws for the UI
   └─ ui/                  React app: map + sidebar
```

---

## 7. Tests

`World` is tested with a fake clock: spawn timing, movement and arrival, scan range and contents, shell hits and near-misses, impact timing between ticks, wave-run completion, stop all.

## 8. Later

- Define regions and cities from the World Simulator UI.
- Optional: show each radar's range and each weapon's range rings (needs those values in `hello`).
