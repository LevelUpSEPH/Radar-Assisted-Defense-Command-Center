# Command Center — Design

Part of [TDTS](../../docs/DESIGN.md). Status: **planned** (milestones 3, 4 and 6).

The Command Center is the brain of the network. It registers radars and weapons, builds one picture of the sky from all radar reports, decides what is an enemy, and tells weapons when to prepare and fire. It never sees ground truth: everything it knows comes from radar and weapon reports.

---

## 1. Responsibilities

- Issue, track and revoke registration keys; register units; watch heartbeats.
- Fuse radar tracks into system tracks.
- Decide each track's classification.
- Rank threats against cities.
- Assign weapons, control firing (automatic or with approval), cancel shots.
- Confirm kills through radars and re-engage on a miss.
- Operator UI: the main map and control panels.

---

## 2. Config (`scenario/command-center.json`)

```json
{
  "port": 7100,
  "uiPort": 7101,
  "worldSimUrl": "ws://localhost:7000",
  "dataFile": "../apps/command-center/data/state.json",
  "fireMode": "approval",
  "minLikelihoodToEngage": 0.6,
  "maxWeaponsPerTarget": 2
}
```

The Command Center connects to the World Simulator **only** for `getCities` (city locations are public knowledge).

---

## 3. Registration and keys

All keys are created in the Command Center UI.

- **Key format:** `TDTS-XXXX-XXXX-XXXX` (random, 60 bits, Crockford base32; `generateKey()` in shared).
- **Key fields:** `key`, `unitType` (`radar` | `weapon`), `mode` (`auto` | `manual`), optional `name`, optional `expectedPosition`, `status`, `unitId` once bound.
- **Key status:** `ISSUED → BOUND → REVOKED`. Keys **never expire**. `REVOKED` is final.

### Automatic registration

1. The operator generates a key with only the unit type.
2. The key goes into the radar or weapon config file.
3. On startup, the unit connects and sends `register { key, unitType, name, position, capabilities }`.
4. The Command Center binds the key to a new `unitId` and replies `registered { unitId }`.

### Manual registration

1. The operator generates a key with unit type, name and an **approximate position**.
2. When the device connects with that key, the Command Center compares the reported position with the approximate one.
3. Within `MANUAL_MATCH_TOLERANCE_M` (2 km): accepted and bound. The unit's reported position is used from then on.
4. Outside the tolerance: the Command Center replies `pending { POSITION_MISMATCH, distanceM }`. The unit stays connected, but gets no tasks and its reports are ignored. The operator **approves** (binds it) or **rejects** it (`rejected { REJECTED_BY_OPERATOR }`, disconnected, key stays `ISSUED`).

### Rules for both modes

| Situation                                 | Result                                                            |
| ----------------------------------------- | ----------------------------------------------------------------- |
| Unknown key                               | `rejected { INVALID_KEY }`                                        |
| Revoked key                               | `rejected { REVOKED }`                                            |
| Key for the other unit type               | `rejected { TYPE_MISMATCH }`                                      |
| Key already in use by a live connection   | `rejected { ALREADY_CONNECTED }`                                  |
| Reconnect with a `BOUND` key              | same `unitId`; it resumes                                         |
| No `heartbeat` for `HEARTBEAT_TIMEOUT_MS` | unit `OFFLINE`; a weapon's engagements are reassigned             |
| Operator revokes the key                  | `revoked`, socket closed, any engagement cancelled and reassigned |

Only `register` is accepted before registration; anything else gets `error { NOT_REGISTERED }`.

### Persistence

Keys and registered units (id, type, name, position, capabilities) are saved to `dataFile` on every change, so a restart keeps them. Tracks and engagements are not saved.

---

## 4. Track fusion

Several radars may report the same object. The Command Center keeps **system tracks** (`T-0042`):

- A radar track already linked to a system track updates it.
- A new radar track joins the nearest system track within `FUSION_GATE_M` (1 km) whose heading is within `FUSION_HEADING_GATE_DEG` (30°). Otherwise it creates a new system track.
- A system track's position, speed and heading are the average of its linked radar tracks' latest values. Its likelihood is the highest of them.
- A radar track not reported in a radar's latest `tracks` message is unlinked. A system track with no linked radar tracks is dropped.

---

## 5. Classification

Every system track has `classification`: `UNKNOWN` | `FRIENDLY` | `ENEMY`.

- **Radars report; the Command Center decides.** Without an override, the classification is:
  1. `FRIENDLY` if **at least one** linked radar reports it friendly;
  2. otherwise `ENEMY` if any linked radar reports it enemy;
  3. otherwise `UNKNOWN`.
- **Override:** the operator can set the classification on the map. Once overridden, radar reports are shown but no longer change it, until the operator clears the override. Overriding to `ENEMY` is the only way to engage a track that a radar reports as friendly.
- **Engagement:** only `ENEMY` tracks with `likelihood ≥ minLikelihoodToEngage` are engaged.
- **Cancellation:** if a track stops being an engageable enemy while an engagement has not fired yet, the engagement is cancelled.

---

## 6. Threat evaluation

For each enemy track, extend its heading as a straight line and find the first city whose `radiusM` it crosses. That gives `threatenedCity` and `timeToCityS`. Targets threatening a city sooner have higher priority. Tracks not heading at any city come last, ordered by distance to the nearest city.

---

## 7. Weapon assignment

There is no fixed look-ahead time: each weapon's own prepare time, shell speed and range decide when it can shoot. For a track and a weapon, the Command Center runs `findEarliestIntercept` (shared), with `readyAt = now + prepareTimeS` for an `IDLE` weapon or `now` for a `READY` one.

Every `PLANNING_INTERVAL_MS` (1 s):

1. Take the engageable enemy tracks in priority order.
2. For each track with fewer than `maxWeaponsPerTarget` active engagements, look at every registered, online weapon that is `IDLE` (or `READY` without an engagement) and has ammo. Pick the one with the **earliest impact time**.
3. Create an engagement and send `prepare`. A second weapon is added only if the first one's impact time is later than half the track's `timeToCityS`, or if a previous engagement on that track missed.
4. A weapon has at most one engagement at a time.
5. While an engagement is active, the weapon gets a `trackUpdate` every time the track updates.

### Engagement life cycle

```
PREPARING → READY → AWAITING_APPROVAL → FIRING → IN_FLIGHT → CONFIRMING → KILL | MISS | UNCONFIRMED
     └──────────┴───────────┴──────────────┴─→ CANCELLED (reclassified, track lost, weapon offline/revoked, rejected)
```

`AWAITING_APPROVAL` exists only in `approval` fire mode. `FIRING` covers the time between `fire` and the shell leaving (the weapon waits for its fire time). A `fireFailed` returns the engagement to `READY` for the next planning cycle to decide.

---

## 8. Fire control

- `fireMode: auto` → `fire` is sent as soon as the weapon reports `READY`.
- `fireMode: approval` → the engagement waits on the map with **Approve** and **Reject** buttons.
- The switch can be flipped live in the UI.

---

## 9. Kill confirmation

The weapon reports the shot, the Command Center asks the radar, the radar reports back.

1. The weapon sends `shotFired { engagementId, firedAt, impactAt, impactPoint }`.
2. At `impactAt + KILL_CHECK_DELAY_MS`, the Command Center sends `confirmKill { checkId, position, radiusM }` to every radar whose range covers `impactPoint`.
3. Any radar answering `destroyed: false` → **MISS**; the track is re-queued for assignment.
4. All radars answering `destroyed: true` → **KILL**; the track is closed.
5. No answer within `KILL_CHECK_TIMEOUT_MS` → **UNCONFIRMED**.

---

## 10. Operator UI (port 7101)

- **Map:** cities, radars (with range circles), weapons (min/max range rings, state, ammo), system tracks (colored by classification, with heading vector and predicted intercept point), shells in flight.
- **Keys panel:** generate (auto or manual with name + approximate position), list with status, revoke, copy.
- **Units panel:** online/offline/pending, approve/reject pending units.
- **Tracks panel:** classification, likelihood, reporting radars, override controls.
- **Engagements panel:** state, weapon, target, approve/reject; fire-mode switch.
- **Weapon panel:** edit a weapon's ranges (`setRanges`).

---

## 11. Code layout (planned)

```
apps/command-center/src/
├─ protocol.ts             UI channel schemas
├─ server/
│  ├─ main.ts
│  ├─ registry.ts          keys, units, heartbeats, persistence
│  ├─ fusion.ts            radar tracks → system tracks
│  ├─ classification.ts
│  ├─ threats.ts
│  ├─ planner.ts           weapon assignment
│  ├─ engagements.ts       engagement state machine, kill checks
│  ├─ unit-server.ts
│  └─ ui-server.ts
└─ ui/
```

Each of registry, fusion, classification, threats, planner and engagements is pure logic with unit tests, wired together by `main.ts`.
