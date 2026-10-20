import type { AirTrack } from "../protocol";
import { likelihoodBand } from "./likelihood";

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
            const band = likelihoodBand(t.likelihood);
            return (
              <li key={`${t.unitId}/${t.radarTrackId}`} className="row">
                <div className="row-main">
                  <span>
                    <strong>{t.radarTrackId}</strong>
                    <span className="muted small"> · {t.unitId}</span>
                  </span>
                  <span className="small">
                    {t.altitudeM.toFixed(0)} m · {t.speedMps.toFixed(0)} m/s ·{" "}
                    {t.headingDeg.toFixed(0)}° {compass(t.headingDeg)}
                  </span>
                  <span className="small" style={{ color: band.color }}>
                    {Math.round(t.likelihood * 100)}% · {band.label}
                  </span>
                </div>
                {t.iff === "FRIENDLY" && (
                  <span className="pill pill-friendly" title="Answered the IFF interrogation">
                    IFF friendly
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
