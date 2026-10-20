import type { LatLon } from "@tdts/shared";
import { latLng } from "leaflet";
import { useEffect, useRef } from "react";
import { Circle, CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { WeaponPageState } from "../protocol";

// Range rings are drawn with `interactive: false`: clicks and hovers pass
// through them, so only points can be picked.
const WEAPON_COLOR = "#a855f7";

const toLatLng = (p: LatLon): [number, number] => [p.lat, p.lon];

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
            radius={state.maxRangeM}
            pathOptions={{
              color: WEAPON_COLOR,
              weight: 1,
              opacity: 0.8,
              fillOpacity: 0.06,
              interactive: false,
            }}
          />
          <Circle
            center={toLatLng(state.position)}
            radius={state.minRangeM}
            pathOptions={{
              color: WEAPON_COLOR,
              weight: 1,
              opacity: 0.8,
              dashArray: "4 4",
              fillColor: "#000",
              fillOpacity: 0.25,
              interactive: false,
            }}
          />
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
  return (
    <div className="legend leaflet-bottom leaflet-left">
      <div className="leaflet-control">
        <div className="legend-item">
          <span className="swatch" style={{ background: WEAPON_COLOR }} />
          Can hit (min–max range)
        </div>
        <div className="legend-item muted">shaded center: too close</div>
      </div>
    </div>
  );
}
