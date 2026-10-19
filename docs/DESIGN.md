# TDTS — System Design

Status: **agreed, in progress** · Last updated: 2026-10-19

An interactive, real-time simulation of a defense network that detects flying targets with radars and engages them with mortar-like weapons ("Shot Controls"), coordinated by a Command Center. The goal is a clear, watchable demonstration of the concepts — not physical realism.

This document covers the system as a whole: the programs, how they talk, and the rules every program follows. Each program has its own design document:

| Program         | Document                                                          |
| --------------- | ----------------------------------------------------------------- |
| World Simulator | [apps/world-sim/DESIGN.md](../apps/world-sim/DESIGN.md)           |
| Command Center  | [apps/command-center/DESIGN.md](../apps/command-center/DESIGN.md) |
| Radar Center    | [apps/radar-center/DESIGN.md](../apps/radar-center/DESIGN.md)     |
| Shot Control    | [apps/shot-control/DESIGN.md](../apps/shot-control/DESIGN.md)     |
| Shared library  | [packages/shared/README.md](../packages/shared/README.md)         |

---

## 1. Goals and non-goals

**Goals**

- Separate programs (World Simulator, Command Center, Radar Center, Shot Control) that talk only over the network, as if they ran on separate devices.
- A live 2D map on real-world coordinates (lat/lon) where you can watch targets fly, radars detect them, and weapons engage them.
- Key-based registration of radars and weapons, with revocation.
- Correct engagement logic: lead calculation (fire at where the target _will be_), weapon selection, kill confirmation, re-engagement, and cancellation.

**Non-goals (for now)**

- Physical realism: no terrain, wind, firing arcs, barrel slew, shell drag or dispersion.
- Faster-than-real-time, pause, or replay.
- Running across real separate machines (everything runs locally; the design must not _prevent_ it, but clock sync and discovery are out of scope).
- Authentication beyond registration keys (no TLS, no user accounts).

---

## 2. Programs

| Program             | Role                                                                                                                                      | Instances |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **World Simulator** | Owns the _ground truth_: cities, real target positions, shells, impacts. Loads waves from JSON.                                           | 1         |
| **Command Center**  | Registry and keys, track fusion, classification, threat evaluation, weapon assignment, engagement control. Main operator map.             | 1         |
| **Radar Center**    | Senses targets in its range, reports noisy tracks with speed, heading and vehicle likelihood. Has an IFF (friend/enemy) report interface. | many      |
| **Shot Control**    | A weapon. Prepares, computes its own firing solution, fires, reloads, reports status and ammo. Configurable ranges.                       | many      |

```
                  ┌──────────────────────────┐
                  │     World Simulator      │  ground truth, waves, impacts
                  └──▲──────────────────▲────┘
           scan /    │                  │  shell (impact point + time)
           scan result                  │
   ┌─────────────────┴┐   tracks   ┌────┴─────────────┐  prepare / fire / cancel  ┌──────────────┐
   │  Radar Center(s) │──────────▶│  Command Center  │─────────────────────────▶│ Shot Control │
   │  + IFF UI        │◀──────────│  + map UI        │◀─────────────────────────│ (s) + UI     │
   └──────────────────┘ kill check └──────────────────┘   status / shot fired     └──────────────┘
```

### Information boundaries (the key design rule)

- Only the **World Simulator** knows true positions and target kinds.
- **Radars** see only what a scan returns: position (with noise added by the radar), a radar signature value, and whether the target answers IFF. They never see the target's `kind` or destination.
- The **Command Center** knows only what radars report and what weapons report.
- **Weapons** know only the track data the Command Center sends them.

So the Command Center's map can be wrong (noise, a misclassified bird), and that is intended. The World Simulator has its own "truth" map for comparison.

### End-to-end flow

1. The operator generates keys in the Command Center; radars and weapons start up and register with them.
2. A wave is started in the World Simulator; targets begin to fly.
3. Radars scan the World Simulator and report tracks to the Command Center.
4. The Command Center fuses tracks, classifies them, ranks threats, and sends `prepare` to the weapon that can intercept soonest.
5. The weapon prepares (busy), reports ready, and on `fire` computes its firing solution and fires a shell into the World Simulator.
6. The World Simulator resolves the impact; the Command Center asks the radars whether the target is gone, and re-engages if not.

---

## 3. Technology

- **Language:** TypeScript everywhere (Node.js 22 or newer).
- **Repo:** one npm-workspaces monorepo, with a `shared` package for message types, validation and geo math, so all programs agree on the protocol.
- **Transport:** WebSockets (`ws`). The Command Center and World Simulator are servers; Radars and Shot Controls are clients of both.
- **Validation:** `zod` schemas for every message; invalid messages are rejected and logged.
- **UIs:** each program serves its own browser page (Vite + React). Maps use Leaflet with OpenStreetMap tiles (**needs internet for map tiles**).
- **Persistence:** the Command Center stores keys and registered units in a local JSON file so they survive restarts. Nothing else persists.

### Layout

```
TDTS/
├─ docs/DESIGN.md          this document
├─ packages/shared/        message types + zod schemas, geo utils, intercept math, constants
├─ apps/world-sim/         World Simulator (server + truth map UI)
├─ apps/command-center/    Command Center (server + operator UI)
├─ apps/radar-center/      Radar Center (client + IFF UI)
├─ apps/shot-control/      Shot Control (client + weapon UI)
└─ scenario/
   ├─ world-sim.json       World Simulator config
   ├─ cities.json          real-world cities
   ├─ waves/*.json         incoming waves
   ├─ radars/*.json        one config per radar instance
   ├─ weapons/*.json       one config per weapon instance
   └─ command-center.json
```

A root script (`npm run scenario`, milestone 7) starts the World Simulator, the Command Center, and one process per radar and weapon config file, so a whole demo starts with one command.

---

## 4. Shared conventions

- **Coordinates:** WGS84 `{ lat, lon }` in degrees. Altitude is a single number in meters, shown but not used in the math.
- **Distances and bearings:** great-circle (haversine), from the shared geo utils. Bearings are degrees clockwise from north, `[0, 360)`.
- **Units:** meters, meters per second, seconds in config; epoch milliseconds on the wire.
- **Time:** real time. All programs run on one machine, so they share a clock.
- **Tuning values** (blast radius, gates, timeouts) live in `packages/shared/src/constants.ts`.

---

## 5. Protocol

Every message uses one envelope:

```json
{ "type": "prepare", "msgId": "uuid", "ts": 1760000000000, "payload": {} }
```

| Direction      | type                      | payload (summary)                                                                                    |
| -------------- | ------------------------- | ---------------------------------------------------------------------------------------------------- |
| unit → CC      | `register`                | key, unitType, name, position, capabilities (radar: rangeM; weapon: ranges, ammo, times, shellSpeed) |
| CC → unit      | `registered` / `rejected` | unitId / reason                                                                                      |
| CC → unit      | `pending`                 | POSITION_MISMATCH, distanceM (manual key, waiting for operator)                                      |
| unit → CC      | `heartbeat`               | —                                                                                                    |
| CC → unit      | `revoked`                 | —                                                                                                    |
| radar → CC     | `tracks`                  | list of radar tracks, each with its current IFF report                                               |
| CC → radar     | `confirmKill`             | checkId, position, radiusM                                                                           |
| radar → CC     | `killReport`              | checkId, destroyed, survivingRadarTrackId?                                                           |
| CC → weapon    | `prepare`                 | engagementId, track                                                                                  |
| CC → weapon    | `trackUpdate`             | engagementId, track                                                                                  |
| CC → weapon    | `fire` / `cancel`         | engagementId                                                                                         |
| CC → weapon    | `setRanges`               | minRangeM, maxRangeM                                                                                 |
| weapon → CC    | `status`                  | state, ammo, ranges, engagementId, stateUntil                                                        |
| weapon → CC    | `shotFired`               | engagementId, firedAt, impactAt, impactPoint                                                         |
| weapon → CC    | `fireFailed`              | engagementId, reason                                                                                 |
| any → world    | `hello`                   | unitId, unitType, position                                                                           |
| radar → world  | `scan` → `scanResult`     | position, rangeM → observedAt, detections                                                            |
| weapon → world | `shell`                   | from, impactPoint, firedAt, impactAt                                                                 |
| CC → world     | `getCities` → `cities`    | — → city list                                                                                        |
| server → any   | `error`                   | code, detail                                                                                         |

The exact schemas live in `packages/shared/src/messages.ts`; that file is the source of truth, and this table is a summary. Each program's own browser UI channel is defined in that program's document.

**Ports:** World Simulator `7000` (UI `7001`), Command Center `7100` (UI `7101`), radar UIs `72xx`, weapon UIs `73xx`.

---

## 6. Build plan (milestones)

Each milestone ends with something you can run and watch.

1. ✅ **Foundation:** monorepo, `shared` package (types, zod schemas, geo utils, earliest-intercept search, key generation, with unit tests), lint and format.
2. ✅ **World Simulator:** loads cities and waves, moves targets, answers scans, resolves shells, truth map UI with wave controls.
3. **Command Center registry:** key generation, auto and manual registration, heartbeats, revocation, units panel, persistence.
4. **Radar Center:** registers, scans, adds noise, computes speed, heading and likelihood, IFF UI. The Command Center fuses tracks and shows them on its map.
5. **Shot Control:** registers, state machine, UI, range editing from both sides, ammo and reload.
6. **Engagement:** threat evaluation, assignment, prepare/fire/cancel, approval switch, kill confirmation, re-engagement.
7. **Scenario runner and polish:** the `npm run scenario` launcher, a sample scenario (several radars and weapons, mixed waves), a README.

---

## 7. Decisions log

- **Separate programs** on a network, not one process: they are meant to run on separate devices.
- **World Simulator** is its own program, so only it knows the truth.
- **Folders:** kebab-case `apps/*` and `packages/*`.
- **Regions and cities:** defined from the World Simulator program, added later. A small placeholder city file is used until then.
- **Default numbers:** the proposed values are starting points, tuned as needed.
- **Prediction horizon:** not fixed; each weapon's prepare time, shell speed and range decide it.
- **Hits:** shell flight time = distance ÷ shell speed; no dispersion.
- **Manual position mismatch:** the unit is held as pending for operator approval.
- **Classification conflicts:** friendly wins if at least one radar reports friendly, unless the Command Center overrides it to enemy.
- **Reclassification before firing** cancels the shot.
