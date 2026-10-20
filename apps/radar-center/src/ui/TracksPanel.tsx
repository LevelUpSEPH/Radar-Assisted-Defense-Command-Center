import type { Iff } from "@tdts/shared";
import type { RadarTrack, UiToServer } from "../protocol";
import { IFF_STYLE, LIKELIHOOD_COLOR, likelihoodLabel } from "./track-style";

export function TracksPanel({
  tracks,
  disabled,
  send,
}: {
  tracks: RadarTrack[];
  disabled: boolean;
  send(msg: UiToServer): void;
}) {
  return (
    <section>
      <h2>In range ({tracks.length})</h2>
      {tracks.length === 0 ? (
        <p className="muted">Nothing in range.</p>
      ) : (
        <ul className="list">
          {tracks.map((t) => (
            <TrackRow key={t.radarTrackId} track={t} disabled={disabled} send={send} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TrackRow({
  track: t,
  disabled,
  send,
}: {
  track: RadarTrack;
  disabled: boolean;
  send(msg: UiToServer): void;
}) {
  const moving = t.trail.length >= 2;
  const mark = (marking: Iff | null) =>
    send({ type: "markTrack", payload: { radarTrackId: t.radarTrackId, marking } });

  return (
    <li className={`row track ${t.missedScans > 0 ? "stale" : ""}`}>
      <div className="row-main">
        <span>
          <span className="iff-dot" style={{ background: IFF_STYLE[t.iff].color }} />
          <strong>{t.radarTrackId}</strong>
          {t.missedScans > 0 && (
            <span className="muted small"> · lost for {t.missedScans} scan(s)</span>
          )}
        </span>
        <dl className="track-facts">
          <dt>Altitude</dt>
          <dd>{t.altitudeM.toFixed(0)} m</dd>
          <dt>Speed</dt>
          <dd>{moving ? `${t.speedMps.toFixed(0)} m/s` : "measuring…"}</dd>
          <dt>Heading</dt>
          <dd>{moving ? `${t.headingDeg.toFixed(0)}° ${compass(t.headingDeg)}` : "measuring…"}</dd>
        </dl>
        <div className="likelihood" title="Likelihood of being a drone">
          <div className="bar">
            <div
              className="fill"
              style={{ width: `${Math.round(t.likelihood * 100)}%`, background: LIKELIHOOD_COLOR }}
            />
          </div>
          <span className="small muted">
            {Math.round(t.likelihood * 100)}% · {likelihoodLabel(t.likelihood)}
          </span>
        </div>

        <div className="iff">
          <span
            className="pill"
            style={{ color: IFF_STYLE[t.iff].color, borderColor: IFF_STYLE[t.iff].color }}
            title="What this radar reports"
          >
            {IFF_STYLE[t.iff].label}
          </span>
          <span className="muted small">{iffSource(t)}</span>
        </div>
        <div className="iff-actions" role="group" aria-label={`Mark ${t.radarTrackId}`}>
          <button
            type="button"
            className={`small ${t.marking === "FRIENDLY" ? "on-friendly" : ""}`}
            aria-pressed={t.marking === "FRIENDLY"}
            disabled={disabled}
            onClick={() => mark("FRIENDLY")}
          >
            Friend
          </button>
          <button
            type="button"
            className={`small ${t.marking === "ENEMY" ? "on-enemy" : ""}`}
            aria-pressed={t.marking === "ENEMY"}
            disabled={disabled}
            onClick={() => mark("ENEMY")}
          >
            Enemy
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
    </li>
  );
}

/** Why the radar reports what it reports. */
function iffSource(t: RadarTrack): string {
  if (t.marking) return "marked by operator";
  return t.answersIff ? "answered IFF" : "no IFF reply";
}

const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (deg: number) => POINTS[Math.round(deg / 45) % 8];
