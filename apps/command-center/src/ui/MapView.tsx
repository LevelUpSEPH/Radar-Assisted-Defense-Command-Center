import { extrapolate, type LatLon, type MapView as MapViewConfig } from "@tdts/shared";
import { latLng, latLngBounds } from "leaflet";
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
import type { AirTrack, UnitView } from "../protocol";
import { LIKELIHOOD_BANDS, likelihoodBand } from "./likelihood";

const RADAR_COLOR = "#22c55e";
const WEAPON_COLOR = "#a855f7";
const OFFLINE_COLOR = "#64748b";
/** How far ahead the dashed trajectory line reaches. */
const PROJECT_S = 60;

const toLatLng = (p: LatLon): [number, number] => [p.lat, p.lon];

export function MapView({
  view,
  units,
  airTracks,
}: {
  view: MapViewConfig | null;
  units: UnitView[];
  airTracks: AirTrack[];
}) {
  // Pending units aren't part of the network yet, so they aren't drawn.
  const shown = units.filter((u) => u.status !== "PENDING");

  return (
    <MapContainer center={[47, 8]} zoom={8} className="map" preferCanvas>
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        className="dark-tiles"
      />
      <FrameMap view={view} units={shown} />
      {shown.map((u) => (
        <UnitMarker key={u.key} unit={u} />
      ))}
      {airTracks.map((t) => (
        <AirTrackMarker key={`${t.unitId}/${t.radarTrackId}`} track={t} />
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

/** A track as a radar reports it: colored by drone likelihood, heading shown 60 s ahead. */
function AirTrackMarker({ track: t }: { track: AirTrack }) {
  const { color } = likelihoodBand(t.likelihood);
  const ahead =
    t.speedMps > 0 ? extrapolate(t.position, t.speedMps, t.headingDeg, PROJECT_S) : null;
  return (
    <>
      {/* Where the radar reported it in recent sweeps. */}
      {t.trail.map((p, i) => (
        <CircleMarker
          key={i}
          center={toLatLng(p)}
          radius={1.5}
          pathOptions={{ color, weight: 0, fillColor: color, fillOpacity: 0.5 }}
        />
      ))}
      {ahead && (
        <Polyline
          positions={[toLatLng(t.position), toLatLng(ahead)]}
          pathOptions={{ color, weight: 1.5, opacity: 0.8, dashArray: "5 5" }}
        />
      )}
      <CircleMarker
        center={toLatLng(t.position)}
        radius={6}
        pathOptions={{ color, weight: 2, fillColor: color, fillOpacity: 0.85 }}
      >
        <Tooltip>
          <strong>{t.radarTrackId}</strong> · {t.unitId}
          <br />
          {t.altitudeM.toFixed(0)} m · {t.speedMps.toFixed(0)} m/s · {t.headingDeg.toFixed(0)}°
          <br />
          drone likelihood {Math.round(t.likelihood * 100)}%
          {t.iff === "FRIENDLY" && " · IFF friendly"}
        </Tooltip>
      </CircleMarker>
    </>
  );
}

/**
 * Starts on the configured view, then frames the units' coverage the first
 * time any units are known, so the operator sees where the radars look without
 * hunting for them. Only once each: after that the operator pans freely.
 */
function FrameMap({ view, units }: { view: MapViewConfig | null; units: UnitView[] }) {
  const map = useMap();
  const viewApplied = useRef(false);
  const unitsFramed = useRef(false);

  useEffect(() => {
    if (unitsFramed.current) return;
    if (units.length > 0) {
      unitsFramed.current = true;
      const bounds = latLngBounds([]);
      for (const u of units) {
        const reach = u.unitType === "radar" ? u.capabilities.rangeM : u.capabilities.maxRangeM;
        bounds.extend(latLng(u.position.lat, u.position.lon).toBounds(reach * 2));
      }
      map.fitBounds(bounds.pad(0.05));
    } else if (view && !viewApplied.current) {
      viewApplied.current = true;
      map.setView(toLatLng(view.center), view.zoom);
    }
  }, [view, units, map]);
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
        {LIKELIHOOD_BANDS.map((b) => (
          <div key={b.label} className="legend-item">
            <span className="swatch" style={{ background: b.color }} />
            {b.label}
          </div>
        ))}
        <div className="legend-item muted">- - - next {PROJECT_S} s</div>
      </div>
    </div>
  );
}
