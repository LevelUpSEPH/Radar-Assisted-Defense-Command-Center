import {
  bearingDeg,
  destination,
  distanceM,
  extrapolate,
  type LatLon,
  type SystemTrack,
} from "@tdts/shared";
import { latLng } from "leaflet";
import { useEffect, useRef, useState } from "react";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import type { WeaponPageState } from "../protocol";

// Range rings and lines are drawn with `interactive: false`: clicks and hovers
// pass through them, so only points can be picked.
const WEAPON_COLOR = "#a855f7";
const TARGET_COLOR = "#ef4444";
const SHELL_COLOR = "#fb923c";
/** How far ahead the target's heading line reaches. */
const PROJECT_S = 60;
const quiet = { interactive: false };

const toLatLng = (p: LatLon): [number, number] => [p.lat, p.lon];

/** Re-renders a few times a second, for the moving shell. */
function useNow(intervalMs = 100): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function MapView({ state }: { state: WeaponPageState | null }) {
  return (
    <MapContainer center={[47, 8]} zoom={8} className="map" preferCanvas>
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        className="dark-tiles"
      />
      {state && (
        <>
          <FitToRange position={state.position} rangeM={state.maxRangeM} />
          {/* Where the weapon can hit: between the inner (min) and outer (max) ring. */}
          <Circle
            center={toLatLng(state.position)}
            radius={state.status.maxRangeM}
            pathOptions={{
              color: WEAPON_COLOR,
              weight: 1,
              opacity: 0.8,
              fillOpacity: 0.06,
              ...quiet,
            }}
          />
          <Circle
            center={toLatLng(state.position)}
            radius={state.status.minRangeM}
            pathOptions={{
              color: WEAPON_COLOR,
              weight: 1,
              opacity: 0.8,
              dashArray: "4 4",
              fillColor: "#000",
              fillOpacity: 0.25,
              ...quiet,
            }}
          />
          <Assignment state={state} />
          <CircleMarker
            center={toLatLng(state.position)}
            radius={7}
            pathOptions={{
              color: WEAPON_COLOR,
              weight: 2,
              fillColor: WEAPON_COLOR,
              fillOpacity: 0.6,
            }}
          >
            <Tooltip>{state.name}</Tooltip>
          </CircleMarker>
        </>
      )}
      <Legend />
    </MapContainer>
  );
}

/**
 * What the Command Center assigned: the target with its heading and a line to
 * it; once told to fire, the aim point; after firing, the shell on its way.
 */
function Assignment({ state }: { state: WeaponPageState }) {
  const now = useNow();
  const { engagement, lastShot, position } = state;
  const shellFlying = lastShot && now < lastShot.impactAt;

  return (
    <>
      {engagement && (
        <TargetMarker
          track={engagement.track}
          from={position}
          hit={engagement.solution ?? engagement.predicted}
          aimed={engagement.solution !== null}
          label={`${engagement.trackId} (${engagement.engagementId})`}
          now={now}
        />
      )}
      {lastShot && shellFlying && (
        <>
          <Polyline
            positions={[toLatLng(position), toLatLng(lastShot.impactPoint)]}
            pathOptions={{ color: SHELL_COLOR, weight: 1, opacity: 0.6, ...quiet }}
          />
          <CircleMarker
            center={toLatLng(lastShot.impactPoint)}
            radius={9}
            pathOptions={{
              color: SHELL_COLOR,
              weight: 1.5,
              fillOpacity: 0,
              dashArray: "2 3",
              ...quiet,
            }}
          />
          <CircleMarker
            center={toLatLng(
              destination(
                position,
                bearingDeg(position, lastShot.impactPoint),
                distanceM(position, lastShot.impactPoint) *
                  Math.min(1, (now - lastShot.firedAt) / (lastShot.impactAt - lastShot.firedAt)),
              ),
            )}
            radius={3}
            pathOptions={{ color: SHELL_COLOR, fillColor: SHELL_COLOR, fillOpacity: 1 }}
          >
            <Tooltip>
              Shell for {lastShot.engagementId} · lands in{" "}
              {Math.max(0, (lastShot.impactAt - now) / 1000).toFixed(0)} s
            </Tooltip>
          </CircleMarker>
        </>
      )}
    </>
  );
}

function TargetMarker({
  track,
  from,
  hit,
  aimed,
  label,
  now,
}: {
  track: SystemTrack;
  from: LatLon;
  /** Where the shell meets the target: the fire solution, or the expected one before `fire`. */
  hit: { impactAt: number; impactPoint: LatLon } | null;
  /** Told to fire: this is the aim point, not just an expectation. */
  aimed: boolean;
  label: string;
  now: number;
}) {
  const aimPoint = hit?.impactPoint ?? null;
  // Where the target is now, dead-reckoned from the Command Center's last report.
  const here = extrapolate(
    track.position,
    track.speedMps,
    track.headingDeg,
    (now - track.observedAt) / 1000,
  );
  const ahead = extrapolate(here, track.speedMps, track.headingDeg, PROJECT_S);
  return (
    <>
      <Polyline
        positions={[toLatLng(from), toLatLng(here)]}
        pathOptions={{ color: WEAPON_COLOR, weight: 1, opacity: 0.7, dashArray: "2 6", ...quiet }}
      />
      <Polyline
        positions={[toLatLng(here), toLatLng(ahead)]}
        pathOptions={{ color: TARGET_COLOR, weight: 1.5, opacity: 0.8, dashArray: "5 5", ...quiet }}
      />
      {hit && aimPoint && (
        <>
          <Polyline
            positions={[toLatLng(from), toLatLng(aimPoint)]}
            pathOptions={{
              color: SHELL_COLOR,
              weight: 1,
              opacity: 0.5,
              dashArray: "6 4",
              ...quiet,
            }}
          />
          {/* The target's path up to where the shell meets it. */}
          <Polyline
            positions={[toLatLng(here), toLatLng(aimPoint)]}
            pathOptions={{ color: SHELL_COLOR, weight: 2, opacity: 0.8, ...quiet }}
          />
          <CircleMarker
            center={toLatLng(aimPoint)}
            radius={8}
            pathOptions={{
              color: SHELL_COLOR,
              weight: 2,
              fillColor: SHELL_COLOR,
              fillOpacity: 0.15,
              dashArray: aimed ? undefined : "3 3",
            }}
          >
            <Tooltip>
              {aimed ? "Aim point" : "Expected hit"}: the shell meets {track.trackId} here in{" "}
              {Math.max(0, (hit.impactAt - now) / 1000).toFixed(0)} s,{" "}
              {(distanceM(from, aimPoint) / 1000).toFixed(1)} km out
            </Tooltip>
          </CircleMarker>
          <CircleMarker
            center={toLatLng(aimPoint)}
            radius={2}
            pathOptions={{ color: SHELL_COLOR, fillColor: SHELL_COLOR, fillOpacity: 1, ...quiet }}
          />
        </>
      )}
      <CircleMarker
        center={toLatLng(here)}
        radius={6}
        pathOptions={{ color: TARGET_COLOR, weight: 2, fillColor: TARGET_COLOR, fillOpacity: 0.85 }}
      >
        <Tooltip>
          Target {label}
          <br />
          {track.altitudeM.toFixed(0)} m · {track.speedMps.toFixed(0)} m/s ·{" "}
          {track.headingDeg.toFixed(0)}°
          {aimPoint && hit && (
            <>
              <br />
              {aimed ? "aimed" : "expected hit"} in{" "}
              {Math.max(0, (hit.impactAt - now) / 1000).toFixed(0)} s
            </>
          )}
        </Tooltip>
      </CircleMarker>
    </>
  );
}

/** Frames the weapon's reach once, when its state first arrives. */
function FitToRange({ position, rangeM }: { position: LatLon; rangeM: number }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    map.fitBounds(latLng(position.lat, position.lon).toBounds(rangeM * 2.4));
  }, [map, position, rangeM]);
  return null;
}

function Legend() {
  const items: [string, string][] = [
    ["Can hit (min–max range)", WEAPON_COLOR],
    ["Assigned target", TARGET_COLOR],
    ["Hit point (dashed: expected) / shell", SHELL_COLOR],
  ];
  return (
    <div className="legend leaflet-bottom leaflet-left">
      <div className="leaflet-control">
        {items.map(([label, color]) => (
          <div key={label} className="legend-item">
            <span className="swatch" style={{ background: color }} />
            {label}
          </div>
        ))}
        <div className="legend-item muted">shaded center: too close</div>
      </div>
    </div>
  );
}
