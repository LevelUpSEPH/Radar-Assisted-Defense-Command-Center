import type { LatLon } from "@tdts/shared";
import { latLng } from "leaflet";
import { useEffect, useRef } from "react";
import { Circle, CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { RadarState } from "../protocol";

const RADAR_COLOR = "#22c55e";

const toLatLng = (p: LatLon): [number, number] => [p.lat, p.lon];

export function MapView({ state }: { state: RadarState | null }) {
  return (
    <MapContainer center={[47, 8]} zoom={8} className="map" preferCanvas>
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        className="dark-tiles"
      />
      {state && (
        <>
          <FitToRange position={state.position} rangeM={state.rangeM} />
          <Circle
            center={toLatLng(state.position)}
            radius={state.rangeM}
            pathOptions={{ color: RADAR_COLOR, weight: 1, opacity: 0.7, fillOpacity: 0.05 }}
          />
          <CircleMarker
            center={toLatLng(state.position)}
            radius={7}
            pathOptions={{
              color: RADAR_COLOR,
              weight: 2,
              fillColor: RADAR_COLOR,
              fillOpacity: 0.6,
            }}
          >
            <Tooltip>{state.name}</Tooltip>
          </CircleMarker>
        </>
      )}
    </MapContainer>
  );
}

/** Frames this radar's coverage once, when its state first arrives. */
function FitToRange({ position, rangeM }: { position: LatLon; rangeM: number }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    map.fitBounds(latLng(position.lat, position.lon).toBounds(rangeM * 2.2));
  }, [map, position, rangeM]);
  return null;
}
