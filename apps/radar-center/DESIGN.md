# Radar Center — Design

Part of [TDTS](../../docs/DESIGN.md). Status: **planned** (milestone 4).

A Radar Center is one radar site. It scans the World Simulator for what is physically in range, turns raw detections into tracks with speed, heading and a likelihood of being a flying vehicle, and reports them to the Command Center. Its operator can mark tracks as friendly or enemy. Many Radar Centers run at once, one process each.

---

## 1. Responsibilities

- Register with the Command Center using its key.
- Scan on a fixed interval; build and maintain local tracks.
- Add measurement noise; estimate speed and heading; score vehicle likelihood.
- Report tracks with an IFF suggestion or the operator's marking.
- Answer kill checks.
- Operator UI: track list, small map, IFF marking.

Not its job: deciding a track's classification (the Command Center does), or fusing with other radars.

---

## 2. Config (`scenario/radars/<name>.json`)

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

Start: `npm run dev -w @tdts/radar-center -- --config scenario/radars/north.json`.

---

## 3. Start-up

1. Connect to the Command Center and send `register` (`rangeM` as capability). Wait for `registered`. On `pending`, keep connected and show "waiting for operator approval". On `rejected`, show the reason and stop.
2. Connect to the World Simulator and send `hello { unitId, unitType: "radar", position }`.
3. Start the scan loop and the heartbeat (`HEARTBEAT_INTERVAL_MS`).
4. If either connection drops, retry every 2 s; scanning pauses until both are up.
5. On `revoked`, stop everything and show it in the UI.

---

## 4. Each scan

1. Send `scan { scanId, position, rangeM }` to the World Simulator and wait for `scanResult`. Its `observedAt` is the observation time for every detection in it; use it (not the arrival time) for speed estimation and as the track's `observedAt`.
2. **Local tracks.** The radar keeps its own track IDs (`<radar name>-0007`). The World Simulator's `truthId` is used only to link consecutive scans of the same object into one track, a stand-in for real association logic. It is **never** sent to the Command Center.
3. **Noise.** Each reported position is the true position moved a random distance (up to `positionNoiseM`) in a random direction.
4. **Speed and heading** come from the noisy positions of the last 5 scans (first to last position over elapsed time). A track needs 2 scans before it has speed and heading; until then it reports 0.
5. **Vehicle likelihood (0–1):**
   - `speedScore` = 1 above 30 m/s, falling linearly to 0 at 10 m/s (birds are slow).
   - `likelihood = 0.6 × signature + 0.4 × speedScore`, plus ±0.05 random noise, clamped to [0, 1].
   - Smoothed over scans (moving average), so it settles as the track ages.
6. **IFF:** the operator's marking if there is one; otherwise `FRIENDLY` if the target answered IFF, else `UNKNOWN`.
7. Send `tracks { scanAt, tracks: [...] }` to the Command Center, including every current track (also those not seen this scan but not yet dropped).

A track not seen for `RADAR_TRACK_DROP_SCANS` (3) scans is dropped.

---

## 5. Kill check

On `confirmKill { checkId, position, radiusM }`, the radar waits for its **next** scan, then:

- no track within `radiusM` of `position` → `killReport { checkId, destroyed: true }`;
- otherwise → `killReport { checkId, destroyed: false, survivingRadarTrackId }`.

---

## 6. UI (port from config)

- **Status bar:** registration state (registered / pending / rejected / revoked), connections, unit id.
- **Small map:** radar position, range circle, tracks with heading vectors.
- **Track table:** id, speed, heading, altitude, likelihood, IFF; buttons to mark `FRIENDLY` / `ENEMY` / `UNKNOWN` (or clear the marking).

The marking is a **report** to the Command Center, not a decision. It is sent in the `iff` field of the track's next `tracks` report.

---

## 7. Code layout (planned)

```
apps/radar-center/src/
├─ protocol.ts            UI channel schemas
├─ server/
│  ├─ main.ts
│  ├─ tracker.ts          detections → tracks: noise, speed/heading, likelihood, drop (pure, tested)
│  ├─ links.ts            Command Center + World Simulator connections, reconnects
│  └─ ui-server.ts
└─ ui/
```
