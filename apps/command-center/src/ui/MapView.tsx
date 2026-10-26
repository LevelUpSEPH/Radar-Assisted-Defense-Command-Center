import {
  bearingDeg,
  destination,
  distanceM,
  extrapolate,
  type LatLon,
  type MapView as MapViewConfig,
} from "@tdts/shared";
import { latLng, latLngBounds } from "leaflet";
import { Fragment, useEffect, useRef } from "react";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import type { Iff } from "@tdts/shared";
import type {
  EngagementState,
  EngagementView,
  SystemTrackView,
  UiToServer,
  UnitView,
} from "../protocol";
import { EngagementControls, engagementText, useNow } from "./EngagementsPanel";
import { IFF_ORDER, IFF_STYLE } from "./track-style";
import { liveRanges } from "./UnitsPanel";

// Areas, trails and lines are drawn with `interactive: false`: clicks and hovers
// pass through them, so only points (tracks, units) can be picked.
const RADAR_COLOR = "#22c55e";
const WEAPON_COLOR = "#a855f7";
const OFFLINE_COLOR = "#64748b";
/** How far ahead the dashed trajectory line reaches. */
const PROJECT_S = 60;

const km = (m: number) => `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
const toLatLng = (p: LatLon): [number, number] => [p.lat, p.lon];

export function MapView({
  view,
  units,
  tracks,
  engagements,
  heldTracks,
  disabled,
  send,
}: {
  view: MapViewConfig | null;
  units: UnitView[];
  tracks: SystemTrackView[];
  engagements: EngagementView[];
  heldTracks: string[];
  disabled: boolean;
  send(msg: UiToServer): void;
}) {
  const activeEngagement = (trackId: string) =>
    engagements.find((e) => e.trackId === trackId && ACTIVE_STATES.includes(e.state));
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
      {tracks.map((t) => (
        <SystemTrackMarker
          key={t.trackId}
          track={t}
          engagement={activeEngagement(t.trackId)}
          held={heldTracks.includes(t.trackId)}
          disabled={disabled}
          send={send}
        />
      ))}
      <EngagementOverlay engagements={engagements} units={shown} tracks={tracks} />
      <Legend />
    </MapContainer>
  );
}

function UnitMarker({ unit }: { unit: UnitView }) {
  const online = unit.status === "ONLINE";
  const color = !online ? OFFLINE_COLOR : unit.unitType === "radar" ? RADAR_COLOR : WEAPON_COLOR;
  const center = toLatLng(unit.position);
  const ranges = unit.unitType === "weapon" ? liveRanges(unit) : null;
  const ring = {
    color,
    weight: 1,
    opacity: online ? 0.7 : 0.4,
    fillOpacity: 0.04,
    interactive: false,
  };
  const label = (
    <Tooltip>
      <strong>{unit.unitId}</strong> · {unit.name} · {unit.status.toLowerCase()}
      {unit.unitType === "weapon" && ranges && (
        <>
          <br />
          can hit {km(ranges.minRangeM)}–{km(ranges.maxRangeM)}
          {unit.weaponStatus && (
            <>
              <br />
              {unit.weaponStatus.state.toLowerCase()} · {unit.weaponStatus.ammo} rounds
            </>
          )}
        </>
      )}
    </Tooltip>
  );

  return (
    <>
      {unit.unitType === "radar" && (
        <Circle center={center} radius={unit.capabilities.rangeM} pathOptions={ring} />
      )}
      {ranges && (
        <>
          <Circle center={center} radius={ranges.maxRangeM} pathOptions={ring} />
          {/* Too close to hit: dashed and shaded, as on the weapon's own page. */}
          <Circle
            center={center}
            radius={ranges.minRangeM}
            pathOptions={{
              ...ring,
              opacity: online ? 0.9 : 0.4,
              dashArray: "4 4",
              fillColor: "#000",
              fillOpacity: 0.3,
            }}
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

/**
 * A fused track: colored by its classification, with a trail of recent fused
 * positions and its heading 60 s ahead. Engageable enemies get an outer ring.
 */
const ACTIVE_STATES: readonly EngagementState[] = [
  "PREPARING",
  "AWAITING_APPROVAL",
  "FIRING",
  "IN_FLIGHT",
  "CONFIRMING",
];

function SystemTrackMarker({
  track: t,
  engagement,
  held,
  disabled,
  send,
}: {
  track: SystemTrackView;
  engagement: EngagementView | undefined;
  held: boolean;
  disabled: boolean;
  send(msg: UiToServer): void;
}) {
  const { color, label } = IFF_STYLE[t.classification];
  const ahead =
    t.speedMps > 0 ? extrapolate(t.position, t.speedMps, t.headingDeg, PROJECT_S) : null;
  return (
    <>
      {t.trail.map((p, i) => (
        <CircleMarker
          key={i}
          center={toLatLng(p)}
          radius={1.5}
          pathOptions={{ color, weight: 0, fillColor: color, fillOpacity: 0.5, interactive: false }}
        />
      ))}
      {ahead && (
        <Polyline
          positions={[toLatLng(t.position), toLatLng(ahead)]}
          pathOptions={{ color, weight: 1.5, opacity: 0.8, dashArray: "5 5", interactive: false }}
        />
      )}
      {t.engageable && (
        <CircleMarker
          center={toLatLng(t.position)}
          radius={11}
          pathOptions={{ color, weight: 1.5, fillOpacity: 0, dashArray: "3 3", interactive: false }}
        />
      )}
      <CircleMarker
        center={toLatLng(t.position)}
        radius={6}
        pathOptions={{ color, weight: 2, fillColor: color, fillOpacity: 0.85 }}
      >
        <Tooltip>
          <strong>{t.trackId}</strong> · {label}
          {t.classificationSource === "operator" && " (operator)"}
          {t.engageable && " · engageable"}
          <br />
          {t.altitudeM.toFixed(0)} m · {t.speedMps.toFixed(0)} m/s · {t.headingDeg.toFixed(0)}° ·
          drone likelihood {Math.round(t.likelihood * 100)}%
          <br />
          seen by {t.sources.map((s) => `${s.unitId} ${s.radarTrackId}`).join(", ")}
        </Tooltip>
        <Popup className="track-popup" autoPanPadding={[16, 16]}>
          <TrackActions
            track={t}
            engagement={engagement}
            held={held}
            disabled={disabled}
            send={send}
          />
        </Popup>
      </CircleMarker>
    </>
  );
}

/** What the operator can do with a track, right on the map (opens on click). */
function TrackActions({
  track: t,
  engagement,
  held,
  disabled,
  send,
}: {
  track: SystemTrackView;
  engagement: EngagementView | undefined;
  held: boolean;
  disabled: boolean;
  send(msg: UiToServer): void;
}) {
  const now = useNow();
  const style = IFF_STYLE[t.classification];
  const overridden = t.classificationSource === "operator";
  const set = (classification: Iff | null) =>
    send({ type: "classifyTrack", payload: { trackId: t.trackId, classification } });

  return (
    <div className="popup-body">
      <div className="popup-head">
        <strong>{t.trackId}</strong>
        <span className="pill" style={{ color: style.color, borderColor: style.color }}>
          {style.label}
        </span>
        <span className="muted small">{overridden ? "set by operator" : "from radar reports"}</span>
      </div>
      <div className="small muted">
        {t.altitudeM.toFixed(0)} m · {t.speedMps.toFixed(0)} m/s · {t.headingDeg.toFixed(0)}° ·{" "}
        {Math.round(t.likelihood * 100)}% drone
      </div>
      <div className="popup-actions" role="group" aria-label={`Classify ${t.trackId}`}>
        {(["ENEMY", "FRIENDLY", "UNKNOWN"] as const).map((c) => (
          <button
            key={c}
            type="button"
            className={`small ${overridden && t.classification === c ? `on-${c.toLowerCase()}` : ""}`}
            aria-pressed={overridden && t.classification === c}
            disabled={disabled}
            onClick={() => set(c)}
          >
            {IFF_STYLE[c].label}
          </button>
        ))}
      </div>
      {overridden && (
        <button type="button" className="link small" disabled={disabled} onClick={() => set(null)}>
          Use radar reports
        </button>
      )}
      {engagement && (
        <div className="popup-engagement small">
          <span>
            {engagement.engagementId} · {engagement.weaponUnitId}: {engagementText(engagement, now)}
          </span>
          <EngagementControls engagement={engagement} disabled={disabled} send={send} />
        </div>
      )}
      {held && (
        <div className="popup-engagement small">
          <span>Held: stopped by the operator, not engaged until resumed.</span>
          <span className="decision">
            <button
              type="button"
              className="small"
              disabled={disabled}
              onClick={() => send({ type: "resumeTrack", payload: { trackId: t.trackId } })}
            >
              Resume
            </button>
          </span>
        </div>
      )}
      {!engagement && !held && t.engageable && (
        <div className="small muted">Engageable; waiting for a free weapon.</div>
      )}
    </div>
  );
}

const SHELL_COLOR = "#fb923c";

/**
 * Engagements on the map: a thin line from the weapon to its target while it
 * prepares and aims; once fired, the shell's path to the impact point with the
 * shell moving along it.
 */
function EngagementOverlay({
  engagements,
  units,
  tracks,
}: {
  engagements: EngagementView[];
  units: UnitView[];
  tracks: SystemTrackView[];
}) {
  const now = useNow(100);
  const weaponAt = new Map(units.map((u) => [u.unitId, u.position]));
  const trackAt = new Map(tracks.map((t) => [t.trackId, t.position]));
  const quiet = { interactive: false };

  return (
    <>
      {engagements.map((e) => {
        const from = weaponAt.get(e.weaponUnitId);
        if (!from) return null;
        if (["PREPARING", "AWAITING_APPROVAL", "FIRING"].includes(e.state)) {
          const to = trackAt.get(e.trackId);
          if (!to) return null;
          return (
            <Fragment key={e.engagementId}>
              <Polyline
                positions={[toLatLng(from), toLatLng(to)]}
                pathOptions={{
                  color: WEAPON_COLOR,
                  weight: 1,
                  opacity: 0.7,
                  dashArray: "2 6",
                  ...quiet,
                }}
              />
              {e.predicted && (
                <HitPoint
                  target={to}
                  hit={e.predicted.impactPoint}
                  label={`${e.engagementId} · ${e.weaponUnitId} meets ${e.trackId} here in ${Math.max(0, (e.predicted.impactAt - now) / 1000).toFixed(0)} s`}
                />
              )}
            </Fragment>
          );
        }
        if ((e.state === "IN_FLIGHT" || e.state === "CONFIRMING") && e.shot) {
          const { firedAt, impactAt, impactPoint } = e.shot;
          const progress = Math.min(1, Math.max(0, (now - firedAt) / (impactAt - firedAt)));
          const shellAt = destination(
            from,
            bearingDeg(from, impactPoint),
            distanceM(from, impactPoint) * progress,
          );
          return (
            <Fragment key={e.engagementId}>
              <Polyline
                positions={[toLatLng(from), toLatLng(impactPoint)]}
                pathOptions={{ color: SHELL_COLOR, weight: 1, opacity: 0.6, ...quiet }}
              />
              <CircleMarker
                center={toLatLng(impactPoint)}
                radius={9}
                pathOptions={{
                  color: SHELL_COLOR,
                  weight: 1.5,
                  fillOpacity: 0,
                  dashArray: "2 3",
                  ...quiet,
                }}
              />
              {progress < 1 && (
                <CircleMarker
                  center={toLatLng(shellAt)}
                  radius={3}
                  pathOptions={{ color: SHELL_COLOR, fillColor: SHELL_COLOR, fillOpacity: 1 }}
                >
                  <Tooltip>
                    {e.engagementId} · {e.weaponUnitId} → {e.trackId} · lands in{" "}
                    {Math.max(0, (impactAt - now) / 1000).toFixed(0)} s
                  </Tooltip>
                </CircleMarker>
              )}
            </Fragment>
          );
        }
        return null;
      })}
    </>
  );
}

/**
 * Where the shell is expected to meet the target: the target's path up to that
 * point, and a crosshair-like ring on it.
 */
function HitPoint({ target, hit, label }: { target: LatLon; hit: LatLon; label: string }) {
  return (
    <>
      <Polyline
        positions={[toLatLng(target), toLatLng(hit)]}
        pathOptions={{ color: SHELL_COLOR, weight: 2, opacity: 0.8, interactive: false }}
      />
      <CircleMarker
        center={toLatLng(hit)}
        radius={8}
        pathOptions={{ color: SHELL_COLOR, weight: 2, fillColor: SHELL_COLOR, fillOpacity: 0.15 }}
      >
        <Tooltip>{label}</Tooltip>
      </CircleMarker>
      <CircleMarker
        center={toLatLng(hit)}
        radius={2}
        pathOptions={{
          color: SHELL_COLOR,
          fillColor: SHELL_COLOR,
          fillOpacity: 1,
          interactive: false,
        }}
      />
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
        const reach = u.unitType === "radar" ? u.capabilities.rangeM : liveRanges(u).maxRangeM;
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
    ["Expected hit point / shell", SHELL_COLOR],
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
        {IFF_ORDER.map((iff) => (
          <div key={iff} className="legend-item">
            <span className="swatch" style={{ background: IFF_STYLE[iff].color }} />
            {IFF_STYLE[iff].label}
          </div>
        ))}
        <div className="legend-item muted">shaded around a weapon: too close</div>
        <div className="legend-item muted">- - - next {PROJECT_S} s</div>
      </div>
    </div>
  );
}
