import type { AirTrack } from "../protocol";
import { IFF_STYLE, likelihoodLabel } from "./track-style";

const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (deg: number) => POINTS[Math.round(deg / 45) % 8];

/** What the radars report right now, most likely drones first. */
export function AirPanel({ tracks }: { tracks: AirTrack[] }) {
  const sorted = [...tracks].sort((a, b) => b.likelihood - a.likelihood);
  return (
    <section>
      <h2>Air picture ({tracks.length})</h2>
      {tracks.length === 0 ? (
        <p className="muted">No radar reports anything.</p>
      ) : (
        <ul className="list">
          {sorted.map((t) => {
            const iff = IFF_STYLE[t.iff];
            return (
              <li key={`${t.unitId}/${t.radarTrackId}`} className="row">
                <div className="row-main">
                  <span>
                    <span className="iff-dot" style={{ background: iff.color }} />
                    <strong>{t.radarTrackId}</strong>
                    <span className="muted small"> · {t.unitId}</span>
                  </span>
                  <span className="small">
                    {t.altitudeM.toFixed(0)} m · {t.speedMps.toFixed(0)} m/s ·{" "}
                    {t.headingDeg.toFixed(0)}° {compass(t.headingDeg)}
                  </span>
                  <span className="small muted">
                    {Math.round(t.likelihood * 100)}% · {likelihoodLabel(t.likelihood)}
                  </span>
                </div>
                {t.iff !== "UNKNOWN" && (
                  <span
                    className="pill"
                    style={{ color: iff.color, borderColor: iff.color }}
                    title={`${t.unitId} reports it as ${t.iff.toLowerCase()} (its IFF reply or its operator's marking)`}
                  >
                    Reported {iff.label.toLowerCase()}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
