# TDTS — Design Document

Status: **draft, under review** · Last updated: 2026-10-19

An interactive, real-time simulation of a defense network that detects flying targets with radars and engages them with mortar-like weapons ("Shot Controls"), coordinated by a Command Center. The goal is a clear, watchable demonstration of the concepts — not physical realism.

---

## 1. Goals and non-goals

**Goals**

- Separate programs (Radar Center, Command Center, Shot Control, World Simulator) that talk only over the network, as if they ran on separate devices.
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

---

## 3. Technology

- **Language:** TypeScript everywhere (Node.js 22 or newer).
- **Repo:** one npm-workspaces monorepo, with a `shared` package for message types, validation and geo math, so all programs agree on the protocol.
- **Transport:** WebSockets (`ws`). The Command Center and World Simulator are servers; Radars and Shot Controls are clients of both.
- **Validation:** `zod` schemas for every message; invalid messages are rejected and logged.
- **UIs:** each program serves its own browser page (Vite + React). Maps use Leaflet with OpenStreetMap tiles (**needs internet for map tiles**).
- **Persistence:** the Command Center stores keys and registered units in a local JSON file so they survive restarts. Nothing else persists.

### Proposed layout

```
TDTS/
├─ docs/DESIGN.md
├─ packages/shared/        message types + zod schemas, geo utils, constants
├─ apps/world-sim/         World Simulator (server + truth map UI)
├─ apps/command-center/    Command Center (server + operator UI)
├─ apps/radar-center/      Radar Center (client + IFF UI)
├─ apps/shot-control/      Shot Control (client + weapon UI)
└─ scenario/
   ├─ cities.json          real-world cities (World Simulator)
   ├─ waves/*.json         incoming waves
   ├─ radars/*.json        one config per radar instance
   ├─ weapons/*.json       one config per weapon instance
   └─ command-center.json
```

Kebab-case folder names are used because spaces break npm workspaces and scripts.

A root script (`npm run scenario`) starts the World Simulator, the Command Center, and one process per radar and weapon config file, so a whole demo starts with one command.

---

## 4. World model

- **Coordinates:** WGS84 `{ lat, lon }` in degrees. Altitude is a single number in meters, shown but not used in the math.
- **Distances and bearings:** great-circle (haversine) in the shared geo utils: `distance(a, b)`, `bearing(a, b)`, `destination(from, bearingDeg, meters)`.
- **Time:** real time, Unix epoch milliseconds. All programs run on one machine, so they share a clock.
- **Tick:** the World Simulator advances targets at 10 Hz.
- **Cities and regions** are owned by the World Simulator: real cities with real coordinates. They start from `scenario/cities.json`; defining regions and cities from the World Simulator program itself comes in a later milestone. The Command Center gets the city list from the World Simulator when it connects. City locations are public, so this doesn't break the information rule.

```json
{
  "cities": [
    { "id": "c1", "name": "<city>", "position": { "lat": 0.0, "lon": 0.0 }, "radiusM": 8000 }
  ]
}
```

### Targets

A target flies in a straight line (great-circle) from `start` to `destination` at a constant speed, then disappears. It has no other effect; reaching a city is not scored.

| kind       | radar signature | answers IFF | meaning         |
| ---------- | --------------- | ----------- | --------------- |
| `drone`    | high (≈0.9)     | no          | hostile vehicle |
| `friendly` | high (≈0.9)     | yes         | own aircraft    |
| `bird`     | low (≈0.2)      | no          | clutter / decoy |

### Wave file (`scenario/waves/*.json`)

```json
{
  "name": "Wave 1",
  "targets": [
    {
      "id": "t1",
      "kind": "drone",
      "spawnAtS": 0,
      "start": { "lat": 0.0, "lon": 0.0 },
      "destination": { "lat": 0.0, "lon": 0.0 },
      "speedMps": 50,
      "altitudeM": 300
    }
  ]
}
```

`spawnAtS` is seconds after the wave starts. Waves are started from the World Simulator UI (pick a file, press Start). Several waves can run at once.

### Shells and hits

- A weapon tells the World Simulator: `shell { from, impactPoint, impactAt }`.
- The World Simulator shows the shell flying and, at `impactAt`, destroys every target within `BLAST_RADIUS_M` (shared constant, default 100 m) of `impactPoint`.
- No dispersion. Targets fly straight, so a correctly computed shot always hits. A miss can still happen if the track was too noisy or stale, and the re-engagement path handles that.

---

## 5. Registration and keys

All keys are created in the Command Center UI.

- **Key format:** `TDTS-XXXX-XXXX-XXXX` (random, 60 bits, base32).
- **Key fields:** `key`, `unitType` (`radar` | `weapon`), `mode` (`auto` | `manual`), optional `name`, optional `expectedPosition`, `status`.
- **Key status:** `ISSUED → BOUND → REVOKED`. Keys **never expire**. `REVOKED` is final.

### Automatic registration

1. The operator generates a key with only the unit type.
2. The key goes into the radar or weapon config file.
3. On startup, the unit connects and sends `register { key, unitType, position, capabilities }`.
4. The Command Center binds the key to a new `unitId` and replies `registered { unitId }`.

### Manual registration

1. The operator generates a key with unit type, name and an **approximate position**.
2. When the device connects with that key, the Command Center compares the reported position with the approximate one.
3. Within `MANUAL_MATCH_TOLERANCE_M` (default 2 km): accepted and bound. The unit's reported position is used from then on.
4. Outside the tolerance: the unit is held as `PENDING` (connected, but receives no tasks and its reports are ignored). The operator approves it in the UI, which binds it, or rejects it, which disconnects it and leaves the key `ISSUED`.

### Rules for both modes

- **Wrong unit type** for the key → rejected (`TYPE_MISMATCH`).
- **Reconnecting** with an already `BOUND` key → same `unitId`; it resumes.
- **Already connected:** a second connection with the same key is rejected (`ALREADY_CONNECTED`).
- **Heartbeat:** units send `heartbeat` every 2 s. A unit missing for 6 s is marked `OFFLINE`. An offline weapon's engagements are reassigned.
- **Revocation:** the operator revokes the key. The Command Center sends `revoked`, closes the socket, and refuses all future connections with that key. If it was a weapon with an active engagement, the engagement is cancelled and the target reassigned.

The World Simulator accepts any radar or weapon that tells it its `unitId`. It's a simulation stand-in for the physical world, not part of the security model.

---

## 6. Radar Center

**Config (`scenario/radars/r1.json`):**

```json
{
  "key": "TDTS-....",
  "name": "Radar North",
  "position": { "lat": 0.0, "lon": 0.0 },
  "rangeM": 60000,
  "scanIntervalMs": 1000,
  "positionNoiseM": 50,
  "commandCenterUrl": "ws://localhost:7100",
  "worldSimUrl": "ws://localhost:7000",
  "uiPort": 7201
}
```

**Each scan:**

1. Request `scan { position, rangeM }` from the World Simulator. It returns `[ { truthId, position, altitudeM, signature, iffResponds } ]`.
2. **Local tracks.** The radar keeps its own track IDs (`R1-0007`). The World Simulator's `truthId` is used only to link scans of the same object into one track, which stands in for real association logic; it is never sent to the Command Center.
3. **Noise.** Add random position noise up to `positionNoiseM`.
4. **Speed and heading** come from the last few noisy positions (a simple moving average).
5. **Vehicle likelihood (0–1):** combines the signature and how vehicle-like the speed is. A bird's low signature and low speed give a low score; a drone or friendly gives a high one. Some randomness makes it imperfect.
6. **IFF suggestion:** `FRIENDLY` if the target answers IFF, otherwise `UNKNOWN`.
7. Send `tracks [ { radarTrackId, position, altitudeM, speedMps, headingDeg, likelihood, iff } ]` to the Command Center.

When an object no longer appears in scans, its track is dropped after 3 missed scans.

**IFF interface (Radar UI):** a list and small map of the radar's tracks. The operator can mark a track `FRIENDLY`, `ENEMY` or `UNKNOWN`. The marking is a **report** to the Command Center, not a decision. It replaces the IFF suggestion in the `iff` field of that track's next `tracks` report.

**Kill check:** on `confirmKill { checkId, position, radiusM }` from the Command Center, the radar looks at its next scan. If no track is within `radiusM` of the expected position, it replies `killReport { checkId, destroyed: true }`; otherwise `destroyed: false` with the surviving track's ID.

---

## 7. Command Center

**Config (`scenario/command-center.json`):** port, `worldSimUrl`, `uiPort`, `fireMode` (`auto` | `approval`, default `approval`), `minLikelihoodToEngage` (default 0.6), `maxWeaponsPerTarget` (default 2).

### 7.1 Track fusion

Several radars may report the same object. The Command Center keeps **system tracks** (`T-0042`):

- A radar track that is already linked to a system track updates it.
- A new radar track joins the nearest system track within `FUSION_GATE_M` (default 1 km) whose heading is within 30°. Otherwise it creates a new system track.
- A system track's position is the average of its linked radar tracks' latest positions. It's dropped when it has no linked radar tracks.

### 7.2 Classification

Every system track has `classification`: `UNKNOWN` | `FRIENDLY` | `ENEMY`.

- **Radars report; the Command Center decides.** Without an override, the classification is:
  1. `FRIENDLY` if **at least one** linked radar reports it friendly;
  2. otherwise `ENEMY` if any linked radar reports it enemy;
  3. otherwise `UNKNOWN`.
- **Command Center override:** the operator can set the classification on the map. Once overridden, radar reports are shown but no longer change it, until the operator clears the override. Overriding to `ENEMY` is the only way to engage a track that a radar reports as friendly.
- **Engagement:** only `ENEMY` tracks with `likelihood ≥ minLikelihoodToEngage` are engaged.
- **Cancellation:** if a track stops being `ENEMY` while an engagement is not yet fired, the engagement is cancelled (§8).

### 7.3 Threat evaluation

For each enemy track, extend its heading as a straight line and find the first city whose `radiusM` it crosses. That gives `threatenedCity` and `timeToCityS`. Targets threatening a city sooner have higher priority. Tracks not heading at any city come last, ordered by distance to the nearest city.

### 7.4 Weapon assignment

There is no fixed look-ahead time: each weapon's own prepare time, shell speed and range decide when it can shoot. For a track and a weapon, the Command Center computes the **earliest intercept**:

```
tReady = now + (weapon is IDLE ? prepareTimeS : 0)
for impact time T from now, in 0.5 s steps, until the target leaves the max range of the weapon
                                             or the extrapolation limit (10 min):
    P      = predicted target position at T     (current position + speed × heading)
    d      = distance(weapon, P)
    if d < minRangeM or d > maxRangeM: continue
    tFire  = T − d / shellSpeedMps
    if tFire >= tReady: return { T, P, tFire }
return none
```

Each planning cycle (every 1 s):

1. Take the enemy tracks in priority order.
2. For each track with fewer than `maxWeaponsPerTarget` active engagements, look at every connected weapon that is `IDLE` or `READY`-but-unassigned and has ammo. Pick the weapon with the **earliest `T`**.
3. Create an engagement and send `prepare`. A second weapon is added only if the first one's intercept is later than half the track's `timeToCityS`, or if a previous engagement on it missed.
4. A weapon has only one engagement at a time.

### 7.5 Fire control

- `fireMode: auto` → `fire` is sent as soon as the weapon reports `READY`.
- `fireMode: approval` → the engagement waits on the map with **Approve** and **Reject** buttons.
- The switch can be flipped live in the UI.

### 7.6 Kill confirmation

Following your rule: the weapon reports the shot, the Command Center asks the radar, the radar reports back.

1. The weapon sends `shotFired { engagementId, impactPoint, impactAt }`.
2. At `impactAt + 1 s`, the Command Center sends `confirmKill` to every radar that covers `impactPoint`.
3. Any radar answering `destroyed: false` → the engagement is a **MISS** and the track is re-queued for assignment.
4. All radars answering `destroyed: true` → the engagement is a **KILL** and the track is closed. If no radar answers within 3 s, the engagement is `UNCONFIRMED`.

### 7.7 Operator UI

- **Map:** cities, radars (with range circles), weapons (min/max range rings, state, ammo), system tracks (colored by classification, with heading vector and predicted intercept point), and shells in flight.
- **Panels:** key management (generate, list, revoke); units list (online/offline); engagements list with approve/reject; fire-mode switch; weapon range editing.

---

## 8. Shot Control (weapon)

**Config (`scenario/weapons/w1.json`):**

```json
{
  "key": "TDTS-....",
  "name": "Battery Alpha",
  "position": { "lat": 0.0, "lon": 0.0 },
  "minRangeM": 2000,
  "maxRangeM": 15000,
  "ammo": 20,
  "prepareTimeS": 8,
  "reloadTimeS": 12,
  "shellSpeedMps": 300,
  "commandCenterUrl": "ws://localhost:7100",
  "worldSimUrl": "ws://localhost:7000",
  "uiPort": 7301
}
```

### State machine

```
                prepare                 (prepareTimeS elapsed)
   ┌──────┐ ─────────────▶ ┌───────────┐ ─────────────────────▶ ┌───────┐
   │ IDLE │                │ PREPARING │                        │ READY │
   └──────┘ ◀───────────── └───────────┘                        └───────┘
      ▲         cancel                                            │   │ fire
      │                       cancel                              │   ▼
      │◀──────────────────────────────────────────────────────────┘ ┌────────┐
      │                                                             │ FIRING │  waits for tFire, then sends shell
      │        (reloadTimeS elapsed)       ┌───────────┐  shell out └────────┘
      └────────────────────────────────────│ RELOADING │◀───────────────┘
                                           └───────────┘
   PREPARING, FIRING and RELOADING are reported as BUSY.
   ammo = 0 → EMPTY (reported, never assigned).
```

- **`prepare { engagementId, track }`:** go to `PREPARING`. After `prepareTimeS`, go to `READY` and report it.
- **Track updates:** while engaged, the weapon receives `trackUpdate` messages for its target from the Command Center.
- **`fire`:** the weapon computes **its own** firing solution with the same earliest-intercept math (§7.4) on the latest track data and goes to `FIRING`. At `tFire` it sends `shell` to the World Simulator and `shotFired` to the Command Center, reduces ammo by one, and goes to `RELOADING`.
- **No valid solution:** if the solution becomes invalid (the target turned out of range), it reports `fireFailed { reason }` and returns to `READY`.
- **`cancel`:** accepted in `PREPARING`, `READY` and `FIRING`. It returns to `IDLE`, and nothing is fired.
- **After reloading,** go to `IDLE` and report it.

**Range editing:** min and max range can be changed from the weapon's own UI or from the Command Center. In both cases the weapon applies the change and reports the new values in its next `status`. The weapon is always the source of truth for its own settings. A change during an engagement takes effect for the next solution.

**Weapon UI:** state badge (IDLE / BUSY: PREPARING / READY / …), ammo, a progress bar for prepare and reload, current engagement and target, a range editor, and a small map with range rings.

---

## 9. Protocol

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
| radar → CC     | `tracks`                  | list of radar tracks (§6), each with its current IFF report                                          |
| CC → radar     | `confirmKill`             | checkId, position, radiusM                                                                           |
| radar → CC     | `killReport`              | checkId, destroyed, survivingRadarTrackId?                                                           |
| CC → weapon    | `prepare`                 | engagementId, track                                                                                  |
| CC → weapon    | `trackUpdate`             | engagementId, track                                                                                  |
| CC → weapon    | `fire` / `cancel`         | engagementId                                                                                         |
| CC → weapon    | `setRanges`               | minRangeM, maxRangeM                                                                                 |
| weapon → CC    | `status`                  | state, ammo, ranges, engagementId?                                                                   |
| weapon → CC    | `shotFired`               | engagementId, impactPoint, impactAt                                                                  |
| weapon → CC    | `fireFailed`              | engagementId, reason                                                                                 |
| unit → world   | `hello`                   | unitId, unitType, position                                                                           |
| radar → world  | `scan` → `scanResult`     | position, rangeM → detections                                                                        |
| weapon → world | `shell`                   | from, impactPoint, impactAt                                                                          |
| CC → world     | `getCities` → `cities`    | — → city list                                                                                        |
| world → UIs    | `truthState`              | targets, shells (World Simulator UI only)                                                            |

The exact schemas live in `packages/shared/src/messages.ts`; that file is the source of truth, and this table is a summary. Each program's own browser UI channel (e.g. `truthState`) is defined with that program.

Ports: World Simulator `7000` (UI `7001`), Command Center `7100` (UI `7101`), radar UIs `72xx`, weapon UIs `73xx`.

---

## 10. Build plan (milestones)

Each milestone ends with something you can run and watch.

1. ✅ **Foundation:** monorepo, `shared` package (types, zod schemas, geo utils, earliest-intercept search, key generation, with unit tests), lint and format.
2. **World Simulator:** loads cities and a wave, moves targets, truth map UI with a wave start button.
3. **Command Center registry:** key generation, auto and manual registration, heartbeats, revocation, units panel, persistence.
4. **Radar Center:** registers, scans, adds noise, computes speed, heading and likelihood, IFF UI. The Command Center fuses tracks and shows them on its map.
5. **Shot Control:** registers, state machine, UI, range editing from both sides, ammo and reload.
6. **Engagement:** threat evaluation, assignment, prepare/fire/cancel, approval switch, shells and impacts in the World Simulator, kill confirmation, re-engagement.
7. **Scenario runner and polish:** the `npm run scenario` launcher, a sample scenario (real cities, several radars and weapons, mixed waves), a README.

---

## 11. Decisions log

- **Folders:** kebab-case `apps/*` and `packages/*`.
- **Regions and cities:** defined from the World Simulator program, added later. A small placeholder city file is used until then.
- **Default numbers:** the proposed values are starting points, tuned as needed.
- **Manual position mismatch:** the unit is held as pending for operator approval (§5).
- **Classification conflicts:** friendly wins if at least one radar reports friendly, unless the Command Center overrides it to enemy (§7.2).
