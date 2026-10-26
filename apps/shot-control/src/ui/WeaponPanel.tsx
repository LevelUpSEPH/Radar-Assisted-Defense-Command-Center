import { BUSY_STATES, type WeaponState } from "@tdts/shared";
import { useEffect, useState } from "react";
import type { UiToServer, WeaponPageState } from "../protocol";

const STATE_TEXT: Record<WeaponState, { label: string; tone: string; explain: string }> = {
  IDLE: { label: "Idle", tone: "pill-ok", explain: "Available. Waiting for the Command Center." },
  PREPARING: { label: "Preparing", tone: "pill-warn", explain: "Getting ready to fire." },
  READY: { label: "Ready", tone: "pill-ok", explain: "Ready to fire on command." },
  FIRING: { label: "Firing", tone: "pill-warn", explain: "Aiming; fires at the computed moment." },
  RELOADING: { label: "Reloading", tone: "pill-warn", explain: "Shot fired; reloading." },
  EMPTY: { label: "Empty", tone: "pill-bad", explain: "Out of ammunition." },
};

/** Re-renders a few times a second, for countdowns. */
function useNow(intervalMs = 200): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

const seconds = (ms: number) => `${Math.max(0, ms / 1000).toFixed(1)} s`;

/** Before the shot, the operator can still stop or restart. */
const STOPPABLE: readonly WeaponState[] = ["PREPARING", "READY", "FIRING"];

export function WeaponPanel({
  state,
  disabled,
  send,
}: {
  state: WeaponPageState;
  disabled: boolean;
  send(msg: UiToServer): void;
}) {
  const now = useNow();
  const { status, engagement, lastShot } = state;
  const text = STATE_TEXT[status.state];
  const busy = BUSY_STATES.includes(status.state);

  // Progress through PREPARING / RELOADING, whose end time the weapon reports.
  const phaseS =
    status.state === "PREPARING"
      ? state.prepareTimeS
      : status.state === "RELOADING"
        ? state.reloadTimeS
        : null;
  const progress =
    phaseS && status.stateUntil
      ? Math.min(1, Math.max(0, 1 - (status.stateUntil - now) / (phaseS * 1000)))
      : null;

  return (
    <section>
      <h2>Weapon</h2>
      <div className="row weapon-card">
        <div className="row-main">
          <span className="weapon-state">
            <span className={`pill ${text.tone}`}>{text.label}</span>
            {busy && <span className="muted small">BUSY</span>}
          </span>
          <span className="muted small">{text.explain}</span>

          {progress !== null && status.stateUntil && (
            <div className="phase">
              <div className="bar">
                <div className="fill" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <span className="small muted">{seconds(status.stateUntil - now)} left</span>
            </div>
          )}

          <dl className="facts">
            <dt>Ammo</dt>
            <dd>
              {status.ammo} / {state.ammo} rounds
            </dd>
            {engagement && (
              <>
                <dt>Engagement</dt>
                <dd>
                  {engagement.engagementId} · target {engagement.trackId}
                </dd>
                {engagement.predicted && (
                  <>
                    <dt>Expected hit</dt>
                    <dd>
                      in {seconds(engagement.predicted.impactAt - now)},{" "}
                      {(engagement.predicted.distanceM / 1000).toFixed(1)} km out
                    </dd>
                  </>
                )}
                {engagement.solution && (
                  <>
                    <dt>Fires in</dt>
                    <dd>{seconds(engagement.solution.fireAt - now)}</dd>
                    <dt>Shot</dt>
                    <dd>
                      {(engagement.solution.distanceM / 1000).toFixed(1)} km, lands{" "}
                      {seconds(engagement.solution.impactAt - engagement.solution.fireAt)} after
                      firing
                    </dd>
                  </>
                )}
              </>
            )}
            {lastShot && (
              <>
                <dt>Last shot</dt>
                <dd>
                  {lastShot.engagementId} ·{" "}
                  {lastShot.impactAt > now
                    ? `lands in ${seconds(lastShot.impactAt - now)}`
                    : `landed ${new Date(lastShot.impactAt).toLocaleTimeString([], { hour12: false })}`}
                </dd>
              </>
            )}
          </dl>

          {engagement && STOPPABLE.includes(status.state) && (
            <span className="decision">
              <button
                type="button"
                className="danger small"
                disabled={disabled}
                title="Stand down now; the Command Center holds the target until its operator resumes it"
                onClick={() => send({ type: "stopEngagement", payload: {} })}
              >
                Stop
              </button>
              <button
                type="button"
                className="small"
                disabled={disabled}
                title="Prepare again from the beginning"
                onClick={() => send({ type: "restartEngagement", payload: {} })}
              >
                Restart
              </button>
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
