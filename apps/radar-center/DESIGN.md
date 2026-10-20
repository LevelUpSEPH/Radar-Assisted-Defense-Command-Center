# Radar Center — Design

Part of [TDTS](../../docs/DESIGN.md). Status: **milestone 4 in progress**: piece 1 (registers with its device key, heartbeats, reconnects, status page) and piece 2 (scans the World Simulator; tracks with altitude, trajectory, speed and drone likelihood on its page) done. Next: reporting tracks to the Command Center.

A Radar Center is one radar site, and the **only** kind of program that connects to the World Simulator. It scans it for what is physically in range, turns raw detections into tracks with speed, heading and a likelihood of being a flying vehicle, and reports them to the Command Center. Its operator can mark tracks as friendly or enemy. Many Radar Centers run at once, one process each.

---

## 1. Responsibilities

- Register with the Command Center using its key.
- Scan on a fixed interval; build and maintain local tracks.
- Add measurement noise; estimate speed and heading; score vehicle likelihood.
- Report tracks with an IFF suggestion or the operator's marking.
- Pass hits on to the World Simulator and confirm kills.
- Operator UI: track list, small map, IFF marking.

Not its job: deciding a track's classification (the Command Center does), or fusing with other radars.

---

## 2. Config (`scenario/radars/<name>.json`)

```json
{
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

Start: `npm run dev -w @tdts/radar-center -- --config scenario/radars/north.json [--key TDTS-…]`.

**Registration key:** not in the config. The operator copies a radar key from the Command Center and enters it on the radar's page (**Register**). The radar remembers it in `registrationFile` (default `apps/radar-center/data/registrations/<config name>`) and uses it on every start. The page asks for a key whenever there is none or the current one stopped working (rejected or revoked), and offers **Change key** otherwise; a new key takes effect immediately, without a restart. `--key` does the same from the command line, for scripted launches.

**Device identity:** the key pair lives in `identityFile`, by default `apps/radar-center/data/identities/<config name>`. Both files are git-ignored; the identity holds the private key.

---

## 3. Start-up

1. Load its device key pair from its identity file (created on first start; the private key never leaves the device). Connect to the Command Center and send `register` with its public key (`rangeM` as capability). Answer the `challenge` by signing the nonce. Wait for `registered`. On `pending`, keep connected and show "waiting for operator approval". On `rejected`, show the reason and stop (and ask for a key).
2. Connect to the World Simulator and send `hello { radarId: unitId, position, rangeM }`.
3. Start the scan loop and the heartbeat (`HEARTBEAT_INTERVAL_MS`).
4. If either connection drops, retry every 2 s; scanning pauses until both are up.
5. On `revoked`, stop everything and show it in the UI.

---

## 4. Each scan

1. Send `scan { scanId, position, rangeM }` to the World Simulator and wait for `scanResult`. Its `observedAt` is the observation time for every detection in it; use it (not the arrival time) for speed estimation and as the track's `observedAt`.
2. **Local tracks.** The radar keeps its own track IDs (`T-0007`; the Command Center tells radars apart by unit id). The World Simulator's `truthId` is used only to link consecutive scans of the same object into one track, a stand-in for real association logic. It is **never** sent to the Command Center.
3. **Noise.** Each reported position is the true position moved a random distance (up to `positionNoiseM`) in a random direction.
4. **Trajectory: speed, heading and position** come from a least-squares straight-line fit through the noisy positions of the last 10 scans (on a flat local grid in meters). Fitting averages the noise out: with 50 m noise, speed is typically within ~2 m/s and heading within ~1–2° once 10 scans are in, where a first-to-last estimate could be off by 20% or more. The reported position is the fitted line at the newest scan, so it is smoother than any single measurement. With 2 scans the estimate is first-to-last; with 1 scan the track reports speed 0 ("measuring").
5. **Vehicle likelihood (0–1):**
   - `speedScore` = 1 above 30 m/s, falling linearly to 0 at 10 m/s (birds are slow). Before speed is known (1 scan) it counts as 0.5.
   - `likelihood = 0.6 × signature + 0.4 × speedScore`, plus ±0.05 random noise, clamped to [0, 1].
   - Smoothed over scans (exponential moving average, newest scan weighted 0.3), so it settles as the track ages.
   - Shown in three bands: ≥ 70% likely drone, 40–70% unsure, < 40% unlikely.
6. **IFF:** the operator's marking if there is one; otherwise `FRIENDLY` if the target answered IFF, else `UNKNOWN`.
7. Send `tracks { scanAt, tracks: [...] }` to the Command Center, including every current track (also those not seen this scan but not yet dropped).

A track not seen for `RADAR_TRACK_DROP_SCANS` (3) scans is dropped. An object that comes back after that gets a new track id.

Scanning runs whether or not the radar is registered: a radar keeps watching the sky even while the Command Center is unreachable. Altitude is reported as measured (no noise).

---

## 5. Kill confirmation

On `confirmKill { checkId, radarTrackId }`, a weapon's shot has arrived at the object behind that track. A computed shot always hits, so the radar:

1. sends `targetHit { truthId }` to the World Simulator for the object linked to `radarTrackId` (it knows which one from its scans);
2. waits for its next scan, then answers `killReport { checkId, destroyed }`, where `destroyed` is true if the object is gone.

If the track is unknown (already dropped), it answers `destroyed: true` without touching the world.

---

## 6. UI (port from config)

- **Status bar:** registration state (registered / pending / rejected / revoked), connections, unit id.
- **Status:** Command Center registration, and the **radar hardware** (the World Simulator connection, presented as the radar's own hardware: "Antenna sweeping every 1.0 s" or "No signal"). The radar's page and logs never mention a simulation; it should look and behave like a real radar.
- **Map:** radar position and range circle; each track as a dot colored by drone likelihood, its measured positions as a faint trail, and a dashed line showing where it will be in 60 s.
- **Tracks list:** only what a radar can measure: id, altitude, speed, heading (degrees and compass point) and drone likelihood (bar, percentage, band). Tracks missing from recent scans are dimmed.
- **IFF (later piece):** buttons to mark `FRIENDLY` / `ENEMY` / `UNKNOWN` (or clear the marking).

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
