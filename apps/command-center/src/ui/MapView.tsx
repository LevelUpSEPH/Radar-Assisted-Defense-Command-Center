import type { LatLon, MapView as MapViewConfig } from "@tdts/shared";
import { useEffect, useRef } from "react";
import { Circle, CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { UnitView } from "../protocol";

const RADAR_COLOR = "#22c55e";
const WEAPON_COLOR = "#a855f7";
const OFFLINE_COLOR = "#64748b";

const toLatLng = (p: LatLon): [number, number] => [p.lat, p.lon];

export function MapView({ view, units }: { view: MapViewConfig | null; units: UnitView[] }) {
  // Pending units aren't part of the network yet, so they aren't drawn.
  const shown = units.filter((u) => u.status !== "PENDING");

  return (
    <MapContainer center={[47, 8]} zoom={8} className="map" preferCanvas>
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        className="dark-tiles"
      />
      <ApplyView view={view} />
      {shown.map((u) => (
        <UnitMarker key={u.key} unit={u} />
      ))}
      <Legend />
    </MapContainer>
  );
}

function UnitMarker({ unit }: { unit: UnitView }) {
  const online = unit.status === "ONLINE";
  const color = !online ? OFFLINE_COLOR : unit.unitType === "radar" ? RADAR_COLOR : WEAPON_COLOR;
  const center = toLatLng(unit.position);
  const ring = { color, weight: 1, opacity: online ? 0.7 : 0.4, fillOpacity: 0.04 };
  const label = (
    <Tooltip>
      <strong>{unit.unitId}</strong> · {unit.name} · {unit.status.toLowerCase()}
    </Tooltip>
  );

  return (
    <>
      {unit.unitType === "radar" ? (
        <Circle center={center} radius={unit.capabilities.rangeM} pathOptions={ring} />
      ) : (
        <>
          <Circle center={center} radius={unit.capabilities.maxRangeM} pathOptions={ring} />
          <Circle
            center={center}
            radius={unit.capabilities.minRangeM}
            pathOptions={{ ...ring, dashArray: "4 4", fillOpacity: 0 }}
          />
        </>
      )}
      <CircleMarker
        center={center}
        radius={7}
        pathOptions={{ color, weight: 2, fillColor: color, fillOpacity: online ? 0.6 : 0.2 }}
      >
        {label}
      </CircleMarker>
    </>
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
    ["Radar (range)", RADAR_COLOR],
    ["Weapon (min/max range)", WEAPON_COLOR],
    ["Offline", OFFLINE_COLOR],
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
