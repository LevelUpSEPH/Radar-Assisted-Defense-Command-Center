import type { LatLon, MapView as MapViewConfig, TargetKind } from "@tdts/shared";
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
import type { WorldState } from "../protocol";

export const KIND_COLOR: Record<TargetKind, string> = {
  drone: "#ef4444",
  friendly: "#3b82f6",
  bird: "#f59e0b",
};
// Areas, trails and lines are drawn with `interactive: false`: clicks and hovers
// pass through them, so only points (tracks, units) can be picked.
const RADAR_COLOR = "#22c55e";
const KILL_COLOR = "#fb923c";
const KILL_DISPLAY_MS = 3_000;

const toLatLng = (p: LatLon): [number, number] => [p.lat, p.lon];

export function MapView({ view, state }: { view: MapViewConfig | null; state: WorldState | null }) {
  return (
    <MapContainer center={[47, 8]} zoom={8} className="map" preferCanvas>
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        className="dark-tiles"
      />
      <ApplyView view={view} />

      {state?.radars.map((r) => (
        <Circle
          key={r.radarId}
          center={toLatLng(r.position)}
          radius={r.rangeM}
          pathOptions={{
            color: RADAR_COLOR,
            weight: 1,
            opacity: 0.6,
            fillOpacity: 0.04,
            interactive: false,
          }}
        />
      ))}
      {state?.radars.map((r) => (
        <CircleMarker
          key={`${r.radarId}-site`}
          center={toLatLng(r.position)}
          radius={6}
          pathOptions={{ color: RADAR_COLOR, weight: 2, fillOpacity: 0.4 }}
        >
          <Tooltip>radar {r.radarId}</Tooltip>
        </CircleMarker>
      ))}

      {state?.targets.map((t) => (
        <Polyline
          key={`${t.id}-path`}
          positions={[toLatLng(t.position), toLatLng(t.destination)]}
          pathOptions={{
            color: KIND_COLOR[t.kind],
            weight: 1,
            opacity: 0.4,
            dashArray: "4 6",
            interactive: false,
          }}
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

      {state?.kills.map((k) => {
        const fade = Math.max(0, 1 - (state.now - k.at) / KILL_DISPLAY_MS);
        return (
          <CircleMarker
            key={k.targetId}
            center={toLatLng(k.point)}
            radius={14 - 6 * fade}
            pathOptions={{ color: KILL_COLOR, weight: 3, opacity: fade, fillOpacity: 0.4 * fade }}
          >
            <Tooltip>{k.targetId} destroyed</Tooltip>
          </CircleMarker>
        );
      })}

      <Legend />
    </MapContainer>
  );
}

/** Moves the map to the configured view once, when it first arrives. */
function ApplyView({ view }: { view: MapViewConfig | null }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !view) return;
    done.current = true;
    map.setView(toLatLng(view.center), view.zoom);
  }, [view, map]);
  return null;
}

function Legend() {
  const items: [string, string][] = [
    ["Drone", KIND_COLOR.drone],
    ["Friendly", KIND_COLOR.friendly],
    ["Bird", KIND_COLOR.bird],
    ["Radar", RADAR_COLOR],
    ["Destroyed", KILL_COLOR],
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
