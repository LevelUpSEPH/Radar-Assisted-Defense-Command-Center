import type { LatLon, MapView as MapViewConfig } from "@tdts/shared";
import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";

const toLatLng = (p: LatLon): [number, number] => [p.lat, p.lon];

export function MapView({ view }: { view: MapViewConfig | null }) {
  return (
    <MapContainer center={[47, 8]} zoom={8} className="map" preferCanvas>
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        className="dark-tiles"
      />
      <ApplyView view={view} />
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
