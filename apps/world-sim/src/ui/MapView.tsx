import {
  BLAST_RADIUS_M,
  bearingDeg,
  destination,
  distanceM,
  type City,
  type LatLon,
  type TargetKind,
} from "@tdts/shared";
import { latLngBounds } from "leaflet";
import { useEffect, useRef } from "react";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import type { TruthShell, WorldState } from "../protocol";

export const KIND_COLOR: Record<TargetKind, string> = {
  drone: "#ef4444",
  friendly: "#3b82f6",
  bird: "#f59e0b",
};
const RADAR_COLOR = "#22c55e";
const WEAPON_COLOR = "#a855f7";
const SHELL_COLOR = "#fb923c";
const CITY_COLOR = "#94a3b8";

const toLatLng = (p: LatLon): [number, number] => [p.lat, p.lon];

export function MapView({ cities, state }: { cities: City[]; state: WorldState | null }) {
  return (
    <MapContainer center={[47, 8]} zoom={8} className="map" preferCanvas>
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        className="dark-tiles"
      />
      <FitToCities cities={cities} />

      {cities.map((c) => (
        <Circle
          key={c.id}
          center={toLatLng(c.position)}
          radius={c.radiusM}
          pathOptions={{ color: CITY_COLOR, weight: 1, fillOpacity: 0.08 }}
        >
          <Tooltip permanent direction="center" className="city-label">
            {c.name}
          </Tooltip>
        </Circle>
      ))}

      {state?.units.map((u) =>
        u.position ? (
          <CircleMarker
            key={u.unitId}
            center={toLatLng(u.position)}
            radius={7}
            pathOptions={{
              color: u.unitType === "radar" ? RADAR_COLOR : WEAPON_COLOR,
              weight: 2,
              fillOpacity: 0.3,
            }}
          >
            <Tooltip>
              {u.unitType} {u.unitId}
            </Tooltip>
          </CircleMarker>
        ) : null,
      )}

      {state?.targets.map((t) => (
        <Polyline
          key={`${t.id}-path`}
          positions={[toLatLng(t.position), toLatLng(t.destination)]}
          pathOptions={{ color: KIND_COLOR[t.kind], weight: 1, opacity: 0.4, dashArray: "4 6" }}
        />
      ))}
      {state?.targets.map((t) => (
        <CircleMarker
          key={t.id}
          center={toLatLng(t.position)}
          radius={5}
          pathOptions={{
            color: KIND_COLOR[t.kind],
            fillColor: KIND_COLOR[t.kind],
            fillOpacity: 0.9,
          }}
        >
          <Tooltip>
            <strong>{t.id}</strong> · {t.kind}
            <br />
            {t.speedMps.toFixed(0)} m/s · {t.altitudeM.toFixed(0)} m · {t.headingDeg.toFixed(0)}°
          </Tooltip>
        </CircleMarker>
      ))}

      {state?.shells.map((s) => (
        <ShellMarker key={s.shellId} shell={s} now={state.now} />
      ))}

      {state?.impacts.map((i) => {
        const fade = Math.max(0, 1 - (state.now - i.at) / 3_000);
        return (
          <Circle
            key={i.shellId}
            center={toLatLng(i.point)}
            radius={BLAST_RADIUS_M}
            pathOptions={{
              color: SHELL_COLOR,
              weight: 2,
              opacity: fade,
              fillOpacity: 0.5 * fade,
            }}
          />
        );
      })}

      <Legend />
    </MapContainer>
  );
}

function ShellMarker({ shell, now }: { shell: TruthShell; now: number }) {
  const progress = Math.min(
    1,
    Math.max(0, (now - shell.firedAt) / (shell.impactAt - shell.firedAt)),
  );
  const total = distanceM(shell.from, shell.impactPoint);
  const at = destination(shell.from, bearingDeg(shell.from, shell.impactPoint), total * progress);
  return (
    <>
      <Polyline
        positions={[toLatLng(shell.from), toLatLng(shell.impactPoint)]}
        pathOptions={{ color: SHELL_COLOR, weight: 1, opacity: 0.5 }}
      />
      <CircleMarker
        center={toLatLng(at)}
        radius={3}
        pathOptions={{ color: SHELL_COLOR, fillColor: SHELL_COLOR, fillOpacity: 1 }}
      >
        <Tooltip>
          {shell.shellId} from {shell.unitId} · impact in{" "}
          {Math.max(0, (shell.impactAt - now) / 1000).toFixed(1)} s
        </Tooltip>
      </CircleMarker>
    </>
  );
}

/** Fits the view to the cities once, when they first arrive. */
function FitToCities({ cities }: { cities: City[] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || cities.length === 0) return;
    done.current = true;
    const bounds = latLngBounds(cities.map((c) => toLatLng(c.position)));
    map.fitBounds(bounds.pad(0.6));
  }, [cities, map]);
  return null;
}

function Legend() {
  const items: [string, string][] = [
    ["Drone", KIND_COLOR.drone],
    ["Friendly", KIND_COLOR.friendly],
    ["Bird", KIND_COLOR.bird],
    ["Radar", RADAR_COLOR],
    ["Weapon", WEAPON_COLOR],
    ["Shell", SHELL_COLOR],
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
      </div>
    </div>
  );
}
