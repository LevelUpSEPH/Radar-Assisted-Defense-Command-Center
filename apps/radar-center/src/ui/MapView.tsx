import { extrapolate, type Iff, type LatLon } from "@tdts/shared";
import { latLng } from "leaflet";
import { useEffect, useRef } from "react";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  Popup,
  Tooltip,
  useMap,
} from "react-leaflet";
import type { RadarState, RadarTrack, UiToServer } from "../protocol";
import { IFF_ORDER, IFF_STYLE } from "./track-style";

// Areas, trails and lines are drawn with `interactive: false`: clicks and hovers
// pass through them, so only points (tracks, units) can be picked.
const RADAR_COLOR = "#22c55e";
/** How far ahead the dashed trajectory line reaches. */
const PROJECT_S = 60;

const toLatLng = (p: LatLon): [number, number] => [p.lat, p.lon];

export function MapView({
  state,
  disabled,
  send,
}: {
  state: RadarState | null;
  disabled: boolean;
  send(msg: UiToServer): void;
}) {
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
            pathOptions={{
              color: RADAR_COLOR,
              weight: 1,
              opacity: 0.7,
              fillOpacity: 0.05,
              interactive: false,
            }}
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
          {state.tracks.map((t) => (
            <TrackMarker key={t.radarTrackId} track={t} disabled={disabled} send={send} />
          ))}
        </>
      )}
      <Legend />
    </MapContainer>
  );
}

function TrackMarker({
  track: t,
  disabled,
  send,
}: {
  track: RadarTrack;
  disabled: boolean;
  send(msg: UiToServer): void;
}) {
  const { color, label } = IFF_STYLE[t.iff];
  const opacity = t.missedScans > 0 ? 0.4 : 1;
  const moving = t.trail.length >= 2 && t.speedMps > 0;
  const ahead = moving ? extrapolate(t.position, t.speedMps, t.headingDeg, PROJECT_S) : null;

  return (
    <>
      {/* What the radar measured: noisy points. */}
      {t.trail.map((p, i) => (
        <CircleMarker
          key={i}
          center={toLatLng(p)}
          radius={1.5}
          pathOptions={{
            color,
            weight: 0,
            fillColor: color,
            fillOpacity: 0.5 * opacity,
            interactive: false,
          }}
        />
      ))}
      {/* Where it's heading: the fitted trajectory, projected ahead. */}
      {ahead && (
        <Polyline
          positions={[toLatLng(t.position), toLatLng(ahead)]}
          pathOptions={{
            color,
            weight: 1.5,
            opacity: 0.8 * opacity,
            dashArray: "5 5",
            interactive: false,
          }}
        />
      )}
      <CircleMarker
        center={toLatLng(t.position)}
        radius={6}
        pathOptions={{ color, weight: 2, fillColor: color, fillOpacity: 0.85 * opacity, opacity }}
      >
        <Tooltip>
          <strong>{t.radarTrackId}</strong>
          <br />
          {t.altitudeM.toFixed(0)} m ·{" "}
          {moving ? `${t.speedMps.toFixed(0)} m/s · ${t.headingDeg.toFixed(0)}°` : "measuring…"}
          <br />
          {label} · drone likelihood {Math.round(t.likelihood * 100)}%
        </Tooltip>
        <Popup className="track-popup" autoPanPadding={[16, 16]}>
          <MarkActions track={t} disabled={disabled} send={send} />
        </Popup>
      </CircleMarker>
    </>
  );
}

/** Friend / enemy marking, right on the map (opens on click). */
function MarkActions({
  track: t,
  disabled,
  send,
}: {
  track: RadarTrack;
  disabled: boolean;
  send(msg: UiToServer): void;
}) {
  const style = IFF_STYLE[t.iff];
  const mark = (marking: Iff | null) =>
    send({ type: "markTrack", payload: { radarTrackId: t.radarTrackId, marking } });
  const why = t.marking ? "marked by operator" : t.answersIff ? "answered IFF" : "no IFF reply";

  return (
    <div className="popup-body">
      <div className="popup-head">
        <strong>{t.radarTrackId}</strong>
        <span className="pill" style={{ color: style.color, borderColor: style.color }}>
          {style.label}
        </span>
        <span className="muted small">{why}</span>
      </div>
      <div className="small muted">
        {t.altitudeM.toFixed(0)} m · {t.speedMps.toFixed(0)} m/s · {t.headingDeg.toFixed(0)}° ·{" "}
        {Math.round(t.likelihood * 100)}% drone
      </div>
      <div className="popup-actions" role="group" aria-label={`Mark ${t.radarTrackId}`}>
        <button
          type="button"
          className={`small ${t.marking === "ENEMY" ? "on-enemy" : ""}`}
          aria-pressed={t.marking === "ENEMY"}
          disabled={disabled}
          onClick={() => mark("ENEMY")}
        >
          Enemy
        </button>
        <button
          type="button"
          className={`small ${t.marking === "FRIENDLY" ? "on-friendly" : ""}`}
          aria-pressed={t.marking === "FRIENDLY"}
          disabled={disabled}
          onClick={() => mark("FRIENDLY")}
        >
          Friend
        </button>
        {t.marking !== null && (
          <button
            type="button"
            className="link small"
            disabled={disabled}
            onClick={() => mark(null)}
          >
            Clear
          </button>
        )}
      </div>
    </div>
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

function Legend() {
  return (
    <div className="legend leaflet-bottom leaflet-left">
      <div className="leaflet-control">
        {IFF_ORDER.map((iff) => (
          <div key={iff} className="legend-item">
            <span className="swatch" style={{ background: IFF_STYLE[iff].color }} />
            {IFF_STYLE[iff].label}
          </div>
        ))}
        <div className="legend-item muted">- - - next {PROJECT_S} s</div>
      </div>
    </div>
  );
}
