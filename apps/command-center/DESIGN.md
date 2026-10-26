# Command Center — Design

Part of [TDTS](../../docs/DESIGN.md). Status: **milestone 3 in progress**: piece 1 (map), piece 2 (generate, list and delete keys, saved to `dataFile`) piece 3 (units register with keys, heartbeats, units list and map markers), piece 4 (approve or reject pending units) and piece 5 (device keys) done. Milestone 4: radars' tracks arrive, are fused into system tracks and classified (radar reports, operator override, engageability). Milestone 5: engagements (weapon assignment, prepare and fire with the fire-mode switch, kill confirmation through the radars) done.

The Command Center is the brain of the network. It registers radars and weapons, builds one picture of the sky from all radar reports, decides what is an enemy, and tells weapons when to prepare and fire. It never sees ground truth and **never connects to the World Simulator**: everything it knows comes from radar and weapon reports.

---

## 1. Responsibilities

- Issue, track and revoke registration keys; register units; watch heartbeats.
- Fuse radar tracks into system tracks.
- Decide each track's classification.
- Rank threats by urgency.
- Assign weapons, control firing (automatic or with approval), cancel shots.
- When a shot arrives, have the radars remove the target from the world and confirm the kill.
- Operator UI: the main map and control panels.

---

## 2. Config (`scenario/command-center.json`)

```json
{
  "port": 7100,
  "uiPort": 7101,
  "view": { "center": { "lat": 47.2, "lon": 8.0 }, "zoom": 8 },
  "dataFile": "../apps/command-center/data/state.json",
  "fireMode": "approval",
  "minLikelihoodToEngage": 0.6,
  "maxWeaponsPerTarget": 2
}
```

`view` is where the operator map starts. Settings are added to this file as the pieces that need them are built.

---

## 3. Registration and keys

All keys are created in the Command Center UI.

- **Key format:** `TDTS-XXXX-XXXX-XXXX` (random, 60 bits, Crockford base32; `generateKey()` in shared).
- **Key fields:** `key`, `unitType` (`radar` | `weapon`), `mode` (`auto` | `manual`), optional `name`, optional `expectedPosition`, `status`, `unitId` once bound.
- **Key status:** `ISSUED → BOUND → REVOKED`. Keys **never expire**. `REVOKED` is final.
- **Deleting** a key removes it for good (after an on-screen confirmation). A unit presenting it later gets `INVALID_KEY`; a unit currently using it is disconnected, the same as a revoke.

### Automatic registration

1. The operator generates a key with only the unit type.
2. The key goes into the radar or weapon config file.
3. On startup, the unit connects and sends `register { key, unitType, name, position, capabilities }`.
4. The Command Center binds the key to a new `unitId` and replies `registered { unitId }`.

### Manual registration

1. The operator generates a key with unit type, name and an **approximate position**.
2. When the device connects with that key, the Command Center compares the reported position with the approximate one.
3. Within `MANUAL_MATCH_TOLERANCE_M` (2 km): accepted and bound. The unit's reported position is used from then on.
4. Outside the tolerance: the Command Center replies `pending { POSITION_MISMATCH, distanceM }`. The unit stays connected, but gets no tasks and its reports are ignored. The operator **approves** (binds it where it actually is, and it gets `registered`) or **rejects** it (`rejected { REJECTED_BY_OPERATOR }`, disconnected, key stays `ISSUED` so the right device can still use it).
5. Once a manual key is bound, the 2 km check on later connections is against the unit's **last accepted position**, so an approved unit can reconnect from the same spot; moving 2 km or more from there makes it pending again.

### Device keys (proving identity)

A registration key is a shared secret: anyone who copies it could pretend to be the unit. MAC and IP addresses don't fix that, because a device can claim any MAC, the server can't even see it over a WebSocket, and IPs are spoofable and change. Instead, each unit proves who it is with a key only it holds:

1. **Each device has its own Ed25519 key pair**, kept in a local identity file. The private key never leaves the device.
2. `register` carries the device's **public key**. If the key checks pass, the Command Center answers with `challenge { nonce }`: 32 random bytes, new for every connection.
3. The unit answers `challengeResponse { signature }`: the nonce, bound to its registration key, signed with its private key. Only then do the auto, manual and pending rules run.
4. A wrong signature is `rejected { BAD_SIGNATURE }`. A connection that never answers times out (heartbeats don't count until the challenge is answered).
5. **When a key is bound, it is bound to that device.** Later connections must present the same public key, or they get `rejected { DEVICE_MISMATCH }`. A copied registration key is useless without the device's private key. To replace a device, delete its key and issue a new one.
6. The operator sees each unit's **device fingerprint** (first 8 bytes of the SHA-256 of its public key) in the units list.

Units saved before device keys existed have no public key yet; they adopt the first device that proves itself. Without TLS the exchange could be watched on the network, but a watcher still can't sign a fresh challenge; TLS can be added later without changing this design.

### Rules for both modes

| Situation                                 | Result                                                            |
| ----------------------------------------- | ----------------------------------------------------------------- |
| Unknown key                               | `rejected { INVALID_KEY }`                                        |
| Bound key, different device               | `rejected { DEVICE_MISMATCH }`                                    |
| Challenge signature doesn't verify        | `rejected { BAD_SIGNATURE }`                                      |
| Revoked key                               | `rejected { REVOKED }`                                            |
| Key for the other unit type               | `rejected { TYPE_MISMATCH }`                                      |
| Key already in use by a live connection   | `rejected { ALREADY_CONNECTED }`                                  |
| Reconnect with a `BOUND` key              | same `unitId`; it resumes                                         |
| No `heartbeat` for `HEARTBEAT_TIMEOUT_MS` | unit `OFFLINE`; a weapon's engagements are reassigned             |
| Operator revokes the key                  | `revoked`, socket closed, any engagement cancelled and reassigned |

Only `register` is accepted before registration; anything else gets `error { NOT_REGISTERED }`.

### Persistence

Keys and registered units (id, type, name, position, capabilities, device public key) are saved to `dataFile` on every change, so a restart keeps them. Tracks and engagements are not saved.

---

## 4. Air picture and track fusion

### Air picture (done)

Every registered radar sends `tracks` after each sweep. The Command Center keeps each radar's **latest** report as it is, tagged with the radar's unit id:

- A newer sweep replaces the radar's previous one entirely; an older sweep is ignored.
- A radar's tracks disappear when it disconnects, times out or its key is deleted, and when it hasn't reported for 5 s.
- Only registered radars may report; anything else gets `error { NOT_REGISTERED }` or `error { WRONG_UNIT_TYPE }`.
- The operator page shows them on the map exactly as the radar draws them (colored by friend/enemy status: friend blue, enemy red, unknown yellow; a trail of the last 10 reported positions; heading line 60 s ahead) and in an **Air picture** list (most likely drones first; "Reported friend" / "Reported enemy" when a radar says so). Drone likelihood is shown as a number and word in neutral colors. The radar doesn't send its trails; the Command Center builds each trail from successive reports.
- The map starts on the configured view and, the first time units are known, frames their coverage (once; after that the operator pans freely).

### Track fusion (done)

Several radars may report the same object. The Command Center keeps **system tracks** (`S-0042`; the `S` keeps them apart from radar track ids like `T-0007`):

- A radar track already linked to a system track stays linked for as long as its radar reports it.
- A new radar track joins the nearest system track within `FUSION_GATE_M` (1 km) whose heading is within `FUSION_HEADING_GATE_DEG` (30°). The heading gate is skipped when either is slower than 5 m/s, where heading means little. **A system track takes at most one track per radar**: a radar never sees one object twice. Otherwise the radar track starts a new system track.
- **Fused values:** radars sweep at different moments, so each linked report is first projected (dead-reckoned) to the newest report's time, then positions and altitudes are averaged and speed and heading come from the averaged velocity vector. Likelihood is the highest any radar reports. The same projection is used when matching a new radar track against a system track.
- A radar track not reported in its radar's latest `tracks` message is unlinked. A system track with no linked radar tracks is dropped. Each system track keeps a trail of its last 10 fused positions for the map.
- Fusion runs on every report and once a second (`PLANNING_INTERVAL_MS`), so radars that went quiet drop out even when nothing else happens.
- Not done (yet): splitting a system track whose radar tracks drift apart after being fused.

---

## 5. Classification

Every system track has `classification`: `UNKNOWN` | `FRIENDLY` | `ENEMY`.

- **Radars report; the Command Center decides.** Without an override, the classification is:
  1. `FRIENDLY` if **at least one** linked radar reports it friendly;
  2. otherwise `ENEMY` if any linked radar reports it enemy;
  3. otherwise `UNKNOWN`.
- **Override:** the operator can set the classification by clicking the track on the map (a popup) or in the tracks list (Friend / Enemy / Unknown; **Use radar reports** clears it). Once overridden, radar reports are shown but no longer change it, until the operator clears the override. Overriding to `ENEMY` is the only way to engage a track that a radar reports as friendly.
- **Engagement:** only `ENEMY` tracks with `likelihood ≥ minLikelihoodToEngage` (config, default 0.6) are engaged. Such tracks are marked **Engageable** (list badge, ring on the map) and sorted first; an enemy below the threshold says so.
- **Cancellation:** if a track stops being an engageable enemy while an engagement has not fired yet, the engagement is cancelled.

---

## 6. Threat ranking

There are no cities: the system protects everything. **Proposal, to confirm when we build it:** rank enemy tracks by urgency, meaning the one whose **last chance to be intercepted** by any available weapon comes soonest goes first. A target about to leave all weapon coverage is engaged before one that will stay in range for minutes.

---

## 7. Weapon assignment

There is no fixed look-ahead time: each weapon's own prepare time, shell speed and range decide when it can shoot. For a track and a weapon, the Command Center runs `findEarliestIntercept` (shared), with `readyAt = now + prepareTimeS` for an `IDLE` weapon or `now` for a `READY` one.

Every `PLANNING_INTERVAL_MS` (1 s):

1. Take the engageable enemy tracks in priority order.
2. For each track with fewer than `maxWeaponsPerTarget` active engagements, look at every registered, online weapon that is `IDLE` (or `READY` without an engagement) and has ammo. Pick the one with the **earliest impact time**.
3. Create an engagement and send `prepare`. Since a computed shot always hits, a second weapon is only assigned when the first engagement is lost (cancelled, `fireFailed`, weapon offline or revoked). Whether to also assign backups up front is **open**.
4. A weapon has at most one engagement at a time. A track confirmed destroyed is never engaged again, even while fusion still holds it for a few seconds after the radars lose it.
5. While an engagement is active, the weapon gets a `trackUpdate` every time the track updates.

### Engagement life cycle

```
PREPARING → READY → AWAITING_APPROVAL → FIRING → IN_FLIGHT → CONFIRMING → KILL | UNCONFIRMED
     └──────────┴───────────┴──────────────┴─→ CANCELLED (reclassified, track lost, weapon offline/revoked, rejected)
```

`AWAITING_APPROVAL` exists only in `approval` fire mode. `FIRING` covers the time between `fire` and the shot (the weapon waits for its fire time). `IN_FLIGHT` lasts until the shell's arrival time. A `fireFailed` returns the engagement to `READY` for the next planning cycle to decide.

---

## 8. Fire control

- `fireMode: auto` → `fire` is sent as soon as the weapon reports `READY`.
- `fireMode: approval` → the engagement waits on the map with **Approve** and **Reject** buttons.
- The switch can be flipped live in the UI.

---

## 9. Kill confirmation

The weapon reports the shot, the Command Center tells the radar, the radar reports back. A computed shot always hits, so this is how the hit reaches the world, not a check of whether it hit.

1. The weapon sends `shotFired { engagementId, firedAt, impactAt, impactPoint }`.
2. At `impactAt + KILL_CHECK_DELAY_MS`, the Command Center sends `confirmKill { checkId, radarTrackId }` to every radar that has a track linked to the target's system track.
3. Each radar tells the World Simulator `targetHit` for the object behind its track, then answers `killReport { checkId, destroyed }` once the object is gone from its scans.
4. Any radar answering `destroyed: true` → **KILL**; the track is closed.
5. No answer within `KILL_CHECK_TIMEOUT_MS` → **UNCONFIRMED** (e.g. the radar went offline); the track is re-queued if it is still reported.

---

## 10. Operator UI (port 7101)

- **Map:** radars (with range circles), weapons (min/max range rings, state, ammo), system tracks (colored by classification, with heading vector), the weapon → target line while an engagement waits, shots in flight (launch point → aim point, with the shell moving along it). Only points are clickable; areas and lines let clicks through.
- **Track popup (click a track):** classification and who decided it, Enemy / Friend / Unknown and **Use radar reports**, and the track's engagement with **Approve** / **Reject** when it awaits approval.
- **Keys panel:** generate (auto or manual with name + approximate position), list with status, copy, delete (with confirmation), revoke.
- **Units panel:** online/offline/pending, approve/reject pending units.
- **Tracks panel (done):** system tracks, engageable enemies first: classification and who decided it, engageability, altitude/speed/heading, likelihood, which radars see it (with each radar's report), override controls.
- **Engagements panel (done):** fire-mode switch; active engagements with state, weapon, target, countdowns, Approve / Reject / Call off; recent ones folded away.
- **Weapon panel:** edit a weapon's ranges (`setRanges`).

---

## 11. Trying it without real units

Until the Radar Center and Shot Control exist, a dev tool stands in for them:

```bash
npm run fake-unit -w @tdts/command-center -- --type radar --key TDTS-XXXX-XXXX-XXXX --lat 47.45 --lon 8.55
```

Options: `--type radar|weapon`, `--key`, `--name`, `--lat`, `--lon`, `--no-heartbeat` (to see a timeout), `--url`. It prints every reply and stays connected until Ctrl+C.

---

## 12. Code layout (planned)

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
