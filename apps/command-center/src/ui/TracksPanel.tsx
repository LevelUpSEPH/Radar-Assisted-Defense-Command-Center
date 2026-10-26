import type { Iff } from "@tdts/shared";
import type { EngagementState, EngagementView, SystemTrackView, UiToServer } from "../protocol";
import { engagementText, useNow } from "./EngagementsPanel";

const ACTIVE_STATES: readonly EngagementState[] = [
  "PREPARING",
  "AWAITING_APPROVAL",
  "FIRING",
  "IN_FLIGHT",
  "CONFIRMING",
];
import { IFF_STYLE, likelihoodLabel } from "./track-style";

const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (deg: number) => POINTS[Math.round(deg / 45) % 8];

/** Engageable enemies first, then other enemies, unknowns, friends; likelier drones first. */
const RANK: Record<Iff, number> = { ENEMY: 0, UNKNOWN: 1, FRIENDLY: 2 };
function byThreat(a: SystemTrackView, b: SystemTrackView): number {
  return (
    Number(b.engageable) - Number(a.engageable) ||
    RANK[a.classification] - RANK[b.classification] ||
    b.likelihood - a.likelihood
  );
}

export function TracksPanel({
  tracks,
  engagements,
  minLikelihoodToEngage,
  disabled,
  send,
}: {
  tracks: SystemTrackView[];
  engagements: EngagementView[];
  minLikelihoodToEngage: number;
  disabled: boolean;
  send(msg: UiToServer): void;
}) {
  const now = useNow();
  const engagementOf = (trackId: string) =>
    engagements.find((e) => e.trackId === trackId && ACTIVE_STATES.includes(e.state));
  const engageable = tracks.filter((t) => t.engageable).length;
  return (
    <section>
      <h2>
        Tracks ({tracks.length})
        {engageable > 0 && <span className="enemy-count"> · {engageable} engageable</span>}
      </h2>
      {tracks.length === 0 ? (
        <p className="muted">No radar reports anything.</p>
      ) : (
        <ul className="list">
          {[...tracks].sort(byThreat).map((t) => (
            <TrackRow
              key={t.trackId}
              track={t}
              engagement={engagementOf(t.trackId)}
              now={now}
              minLikelihoodToEngage={minLikelihoodToEngage}
              disabled={disabled}
              send={send}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function TrackRow({
  track: t,
  engagement,
  now,
  minLikelihoodToEngage,
  disabled,
  send,
}: {
  track: SystemTrackView;
  engagement: EngagementView | undefined;
  now: number;
  minLikelihoodToEngage: number;
  disabled: boolean;
  send(msg: UiToServer): void;
}) {
  const style = IFF_STYLE[t.classification];
  const set = (classification: Iff | null) =>
    send({ type: "classifyTrack", payload: { trackId: t.trackId, classification } });
  const overridden = t.classificationSource === "operator";

  return (
    <li className={`row system-track ${t.engageable ? "engageable" : ""}`}>
      <div className="row-main">
        <span>
          <span className="iff-dot" style={{ background: style.color }} />
          <strong>{t.trackId}</strong>
          {t.engageable && <span className="badge-engageable">Engageable</span>}
        </span>
        {engagement && (
          <span className="small engaged-by">
            {engagement.weaponUnitId}: {engagementText(engagement, now)}
          </span>
        )}
        <span className="small">
          {t.altitudeM.toFixed(0)} m · {t.speedMps.toFixed(0)} m/s · {t.headingDeg.toFixed(0)}°{" "}
          {compass(t.headingDeg)}
        </span>
        <span className="small muted">
          {Math.round(t.likelihood * 100)}% · {likelihoodLabel(t.likelihood)}
          {t.classification === "ENEMY" &&
            !t.engageable &&
            ` · below ${Math.round(minLikelihoodToEngage * 100)}% to engage`}
        </span>
        <span className="small muted">
          Seen by{" "}
          {t.sources.map((s, i) => (
            <span key={`${s.unitId}/${s.radarTrackId}`}>
              {i > 0 && ", "}
              {s.unitId} {s.radarTrackId}
              {s.iff !== "UNKNOWN" && (
                <span style={{ color: IFF_STYLE[s.iff].color }}>
                  {" "}
                  ({IFF_STYLE[s.iff].label.toLowerCase()})
                </span>
              )}
            </span>
          ))}
        </span>

        <div className="classify">
          <span className="pill" style={{ color: style.color, borderColor: style.color }}>
            {style.label}
          </span>
          <span className="muted small">
            {overridden ? "set by operator" : "from radar reports"}
          </span>
        </div>
        <div className="classify-actions" role="group" aria-label={`Classify ${t.trackId}`}>
          {(["FRIENDLY", "ENEMY", "UNKNOWN"] as const).map((c) => (
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
          {overridden && (
            <button
              type="button"
              className="link small"
              disabled={disabled}
              onClick={() => set(null)}
            >
              Use radar reports
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
