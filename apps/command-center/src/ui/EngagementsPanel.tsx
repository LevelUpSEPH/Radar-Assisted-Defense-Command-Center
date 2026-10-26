import { useEffect, useState } from "react";
import type { EngagementState, EngagementView, FireMode, UiToServer } from "../protocol";

/** Re-renders a few times a second, for countdowns. */
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

const s = (ms: number) => `${Math.max(0, ms / 1000).toFixed(0)} s`;

const ACTIVE: readonly EngagementState[] = [
  "PREPARING",
  "AWAITING_APPROVAL",
  "FIRING",
  "IN_FLIGHT",
  "CONFIRMING",
];
const CALLABLE_OFF: readonly EngagementState[] = ["PREPARING", "FIRING"];

/** One line about where an engagement stands, with a countdown where there is one. */
export function engagementText(e: EngagementView, now: number): string {
  switch (e.state) {
    case "PREPARING":
      return e.readyAt ? `preparing, ready in ${s(e.readyAt - now)}` : "preparing";
    case "AWAITING_APPROVAL":
      return "ready, waiting for approval";
    case "FIRING":
      return "aiming, fires at the computed moment";
    case "IN_FLIGHT":
      return e.shot ? `shell in flight, lands in ${s(e.shot.impactAt - now)}` : "shell in flight";
    case "CONFIRMING":
      return "shell landed, radars confirming";
    case "KILL":
      return "kill confirmed";
    case "UNCONFIRMED":
      return `unconfirmed${e.reason ? `: ${e.reason}` : ""}`;
    case "CANCELLED":
      return `called off${e.reason ? `: ${e.reason}` : ""}`;
  }
}

const TONE: Record<EngagementState, string> = {
  PREPARING: "pill-warn",
  AWAITING_APPROVAL: "pill-warn",
  FIRING: "pill-warn",
  IN_FLIGHT: "pill-warn",
  CONFIRMING: "pill-warn",
  KILL: "pill-ok",
  UNCONFIRMED: "pill-bad",
  CANCELLED: "",
};

export function EngagementsPanel({
  engagements,
  fireMode,
  disabled,
  send,
}: {
  engagements: EngagementView[];
  fireMode: FireMode;
  disabled: boolean;
  send(msg: UiToServer): void;
}) {
  const now = useNow();
  const active = engagements.filter((e) => ACTIVE.includes(e.state));
  const finished = engagements.filter((e) => !ACTIVE.includes(e.state)).slice(0, 5);

  return (
    <section>
      <div className="section-head">
        <h2>Engagements</h2>
      </div>
      <div className="segmented fire-mode" role="group" aria-label="Fire mode">
        {(["approval", "auto"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={fireMode === m ? "on" : ""}
            aria-pressed={fireMode === m}
            disabled={disabled}
            onClick={() => send({ type: "setFireMode", payload: { fireMode: m } })}
          >
            {m === "approval" ? "Approve each shot" : "Fire automatically"}
          </button>
        ))}
      </div>

      {active.length === 0 ? (
        <p className="muted small">No weapon is engaging anything.</p>
      ) : (
        <ul className="list">
          {active.map((e) => (
            <li
              key={e.engagementId}
              className={`row ${e.state === "AWAITING_APPROVAL" ? "awaiting" : ""}`}
            >
              <div className="row-main">
                <span>
                  <strong>{e.engagementId}</strong>
                  <span className="muted small">
                    {" "}
                    · {e.weaponUnitId} → {e.trackId}
                  </span>
                </span>
                <span className="small">{engagementText(e, now)}</span>
                {e.state === "AWAITING_APPROVAL" && (
                  <span className="decision">
                    <button
                      type="button"
                      className="approve"
                      disabled={disabled}
                      onClick={() =>
                        send({
                          type: "approveEngagement",
                          payload: { engagementId: e.engagementId },
                        })
                      }
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="danger"
                      disabled={disabled}
                      onClick={() =>
                        send({
                          type: "rejectEngagement",
                          payload: { engagementId: e.engagementId },
                        })
                      }
                    >
                      Reject
                    </button>
                  </span>
                )}
                {CALLABLE_OFF.includes(e.state) && (
                  <button
                    type="button"
                    className="link danger-link small call-off"
                    disabled={disabled}
                    onClick={() =>
                      send({ type: "rejectEngagement", payload: { engagementId: e.engagementId } })
                    }
                  >
                    Call off
                  </button>
                )}
              </div>
              <span className={`pill ${TONE[e.state]}`}>{e.state.replace("_", " ")}</span>
            </li>
          ))}
        </ul>
      )}

      {finished.length > 0 && (
        <details className="history">
          <summary className="muted small">Recent ({finished.length})</summary>
          <ul className="list">
            {finished.map((e) => (
              <li key={e.engagementId} className="row">
                <div className="row-main">
                  <span className="small">
                    <strong>{e.engagementId}</strong> · {e.weaponUnitId} → {e.trackId}
                  </span>
                  <span className="muted small">{engagementText(e, now)}</span>
                </div>
                <span className={`pill ${TONE[e.state]}`}>{e.state}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
