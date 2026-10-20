import type { RadarTrack } from "../protocol";
import { likelihoodBand } from "./likelihood";

export function TracksPanel({ tracks }: { tracks: RadarTrack[] }) {
  return (
    <section>
      <h2>In range ({tracks.length})</h2>
      {tracks.length === 0 ? (
        <p className="muted">Nothing in range.</p>
      ) : (
        <ul className="list">
          {tracks.map((t) => (
            <TrackRow key={t.radarTrackId} track={t} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TrackRow({ track: t }: { track: RadarTrack }) {
  const band = likelihoodBand(t.likelihood);
  const moving = t.trail.length >= 2;
  return (
    <li className={`row track ${t.missedScans > 0 ? "stale" : ""}`}>
      <div className="row-main">
        <span>
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
              style={{ width: `${Math.round(t.likelihood * 100)}%`, background: band.color }}
            />
          </div>
          <span className="small" style={{ color: band.color }}>
            {Math.round(t.likelihood * 100)}% · {band.label}
          </span>
        </div>
      </div>
    </li>
  );
}

const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (deg: number) => POINTS[Math.round(deg / 45) % 8];
