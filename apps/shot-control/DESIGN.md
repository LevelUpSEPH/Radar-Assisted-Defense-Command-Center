# Shot Control — Design

Part of [TDTS](../../docs/DESIGN.md). Status: **milestone 5 in progress**: piece 1 (registers with its device key and a key entered on its page, heartbeats, reconnects, status page with range rings) done. Next: the weapon state machine and status reports.

A Shot Control is one mortar-like weapon. When the Command Center tells it to prepare, it gets ready (busy), reports ready, and on `fire` computes its own firing solution and fires where the target will be. A computed shot always hits (ideal test scene), so shells are not simulated anywhere. Then it reloads (busy) and is available again. Many Shot Controls run at once, one process each.

---

## 1. Responsibilities

- Register with the Command Center using its key.
- Run the weapon state machine: prepare, fire, reload, cancel.
- Compute its own firing solution from the track data it is sent.
- Report shots (with arrival time and point) and status to the Command Center.
- Keep ammo count and ranges; accept range changes from its UI and from the Command Center.
- Operator UI: state, ammo, progress, ranges.

Not its job: choosing targets, or deciding whether a shot killed.

---

## 2. Config (`scenario/weapons/<name>.json`)

```json
{
  "name": "Battery Alpha",
  "position": { "lat": 0.0, "lon": 0.0 },
  "minRangeM": 2000,
  "maxRangeM": 15000,
  "ammo": 20,
  "prepareTimeS": 8,
  "reloadTimeS": 12,
  "shellSpeedMps": 300,
  "commandCenterUrl": "ws://localhost:7100",
  "uiPort": 7301
}
```

Start: `npm run dev -w @tdts/shot-control -- --config scenario/weapons/alpha.json [--key TDTS-…]` (page on the config's `uiPort`, 7301 for Battery Alpha).

Like the Radar Center, the weapon keeps its device identity and the registration key entered on its page in git-ignored files (`identityFile`, `registrationFile`, under `apps/shot-control/data/`). The identity, key store, Command Center link and page server are the Radar Center's, copied; moving them into a shared package is a later clean-up.

The registration key is entered on the weapon's page and remembered, exactly like the Radar Center (no key in the config). Start-up, reconnect and revocation behave like the Radar Center's: load the device identity, register, answer the challenge, then heartbeats. A weapon **never connects to the World Simulator**: it shoots where it is told.

---

## 3. State machine

```
                prepare                 (prepareTimeS elapsed)
   ┌──────┐ ─────────────▶ ┌───────────┐ ─────────────────────▶ ┌───────┐
   │ IDLE │                │ PREPARING │                        │ READY │
   └──────┘ ◀───────────── └───────────┘                        └───────┘
      ▲         cancel                                            │   │ fire
      │                       cancel                              │   ▼
      │◀──────────────────────────────────────────────────────────┘ ┌────────┐
      │                                                             │ FIRING │  waits for fire time, then fires
      │        (reloadTimeS elapsed)       ┌───────────┐  shell out └────────┘
      └────────────────────────────────────│ RELOADING │◀───────────────┘
                                           └───────────┘
   PREPARING, FIRING and RELOADING are reported as BUSY.
   ammo = 0 after reloading → EMPTY (reported, never assigned).
```

| State                          | On                 | Does                                                                               |
| ------------------------------ | ------------------ | ---------------------------------------------------------------------------------- |
| `IDLE`                         | `prepare`          | store engagement + track, → `PREPARING` for `prepareTimeS`                         |
| `PREPARING`                    | timer done         | → `READY`                                                                          |
| `READY`                        | `fire`             | compute solution (below); none → `fireFailed`, stay `READY`; else → `FIRING`       |
| `FIRING`                       | fire time reached  | re-check solution with the latest track; send `shotFired`, ammo − 1, → `RELOADING` |
| `RELOADING`                    | timer done         | → `IDLE` (or `EMPTY` if ammo is 0)                                                 |
| `PREPARING`, `READY`, `FIRING` | `cancel`           | drop the engagement, → `IDLE`; nothing is fired                                    |
| any                            | `trackUpdate`      | replace the stored track (only for the current engagement)                         |
| any other                      | unexpected command | ignored, reported in `error`-level log; state unchanged                            |

A `status` is sent on every state change, on range changes, and with every heartbeat. `stateUntil` carries the end of the current `PREPARING` / `RELOADING` phase for progress bars.

---

## 4. Firing solution

The weapon runs `findEarliestIntercept` (shared) on its own position, ranges and shell speed, with the **latest** track and `readyAt = now`. The result gives the fire time, impact time and impact point.

- **On `fire`:** compute the solution. If there is none (target out of reach), reply `fireFailed { reason: "NO_SOLUTION" }` and stay `READY`.
- **While `FIRING`:** re-compute on every `trackUpdate`, so the aim follows the latest data.
- **At the fire time:** fire. If the solution has disappeared by then, reply `fireFailed` and return to `READY`.
- **The shot:** `shotFired { engagementId, firedAt: now, impactAt: now + distance / shellSpeedMps, impactPoint }` to the Command Center. That's all; the shot is a guaranteed hit at `impactAt`.

---

## 5. Ranges

Min and max range can be changed from the weapon's own UI or from the Command Center (`setRanges`). In both cases the weapon applies the change and reports the new values in its next `status`. The weapon is always the source of truth for its own settings. A change during an engagement takes effect from the next solution. Invalid values (min ≥ max) are refused.

---

## 6. UI (port from config)

- **State badge:** IDLE / BUSY (PREPARING, FIRING, RELOADING) / READY / EMPTY, with a progress bar for prepare and reload.
- **Ammo** remaining.
- **Engagement:** id, target track, current solution (fire time, impact point, distance).
- **Range editor:** min/max inputs with apply.
- **Small map:** weapon position, min/max range rings, target and aim point.
- **Registration state** and connections, as in the Radar Center.

---

## 7. Code layout (planned)

```
apps/shot-control/src/
├─ protocol.ts            UI channel schemas
├─ server/
│  ├─ main.ts
│  ├─ weapon.ts           state machine + solution (pure, driven by a clock; tested)
│  ├─ links.ts            Command Center + World Simulator connections
│  └─ ui-server.ts
└─ ui/
```
