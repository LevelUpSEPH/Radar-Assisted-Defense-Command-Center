import { useState, type FormEvent } from "react";
import type { LinkStatus, UiToServer } from "../protocol";
import type { WeaponSocket } from "./useWeaponSocket";
import { WeaponPanel } from "./WeaponPanel";

const km = (m: number) => `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;

export function Sidebar({ weapon }: { weapon: WeaponSocket }) {
  const { connected, state, error, clearError, send } = weapon;

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <div>
          <h1>{state?.name ?? "Shot Control"}</h1>
          <p className="subtitle">Shot Control</p>
        </div>
        <span className={`pill ${connected ? "pill-ok" : "pill-bad"}`}>
          {connected ? "Live" : "Disconnected"}
        </span>
      </header>

      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
          <button className="link" onClick={clearError} aria-label="Dismiss error">
            ✕
          </button>
        </div>
      )}

      {state && (
        <>
          <section>
            <h2>Status</h2>
            <ul className="list">
              <li>
                <LinkCard
                  link={state.link}
                  url={state.commandCenterUrl}
                  registrationKey={state.registrationKey}
                  disabled={!connected}
                  send={(msg) => {
                    clearError();
                    send(msg);
                  }}
                />
              </li>
            </ul>
          </section>

          <WeaponPanel state={state} />

          <section>
            <h2>This weapon</h2>
            <dl className="facts">
              <dt>Range</dt>
              <dd>
                {km(state.minRangeM)} – {km(state.maxRangeM)}
              </dd>
              <dt>Magazine</dt>
              <dd>{state.ammo} rounds</dd>
              <dt>Prepare</dt>
              <dd>{state.prepareTimeS} s</dd>
              <dt>Reload</dt>
              <dd>{state.reloadTimeS} s</dd>
              <dt>Shell speed</dt>
              <dd>{state.shellSpeedMps} m/s</dd>
              <dt>Position</dt>
              <dd>
                {state.position.lat.toFixed(4)}, {state.position.lon.toFixed(4)}
              </dd>
              <dt>Device</dt>
              <dd>
                <code className="fingerprint" title="Fingerprint of this weapon's device key">
                  {state.deviceId}
                </code>
              </dd>
            </dl>
          </section>
        </>
      )}
    </aside>
  );
}

const LINK_TEXT: Record<LinkStatus["state"], { pill: string; label: string }> = {
  "no-key": { pill: "pill-bad", label: "No key" },
  connecting: { pill: "", label: "Connecting" },
  verifying: { pill: "", label: "Verifying" },
  registered: { pill: "pill-ok", label: "Registered" },
  pending: { pill: "pill-warn", label: "Pending" },
  rejected: { pill: "pill-bad", label: "Rejected" },
  revoked: { pill: "pill-bad", label: "Revoked" },
};

/** States where the radar can't get in with its current key: ask for one right away. */
const NEEDS_KEY: readonly LinkStatus["state"][] = ["no-key", "rejected", "revoked"];

function LinkCard({
  link,
  url,
  registrationKey,
  disabled,
  send,
}: {
  link: LinkStatus;
  url: string;
  registrationKey: string | null;
  disabled: boolean;
  send(msg: UiToServer): void;
}) {
  const { pill, label } = LINK_TEXT[link.state];
  const [changing, setChanging] = useState(false);
  const askForKey = NEEDS_KEY.includes(link.state) || changing;

  return (
    <div className="row link-card">
      <div className="row-main">
        <span title={url}>
          Command Center
          {link.state === "registered" && (
            <>
              {" "}
              · <strong>{link.unitId}</strong>
            </>
          )}
        </span>
        <span className="muted small">{explain(link)}</span>

        {askForKey ? (
          <KeyForm
            disabled={disabled}
            onSubmit={(key) => {
              send({ type: "setKey", payload: { key } });
              setChanging(false);
            }}
            onCancel={changing ? () => setChanging(false) : undefined}
          />
        ) : (
          registrationKey && (
            <span className="muted small">
              Key <code className="key">{registrationKey}</code> ·{" "}
              <button type="button" className="link" onClick={() => setChanging(true)}>
                Change key
              </button>
            </span>
          )
        )}
      </div>
      <span className={`pill ${pill}`}>{label}</span>
    </div>
  );
}

function KeyForm({
  disabled,
  onSubmit,
  onCancel,
}: {
  disabled: boolean;
  onSubmit(key: string): void;
  onCancel?: () => void;
}) {
  const [key, setKey] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;
    onSubmit(key);
    setKey("");
  };

  return (
    <form className="key-entry" onSubmit={submit}>
      <label className="field">
        <span>Registration key</span>
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="TDTS-XXXX-XXXX-XXXX"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <div className="key-entry-actions">
        <button type="submit" disabled={disabled || !key.trim()}>
          Register
        </button>
        {onCancel && (
          <button type="button" className="link" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function explain(link: LinkStatus): string {
  switch (link.state) {
    case "no-key":
      return "Generate a weapon key in the Command Center, then enter it here.";
    case "connecting":
      return "Trying to reach the Command Center; retrying every 2 s.";
    case "verifying":
      return "Signed the challenge with this weapon's device key; waiting for the answer.";
    case "registered":
      return "Registered and sending heartbeats.";
    case "pending":
      return `Connected ${(link.distanceM / 1000).toFixed(1)} km from where this key expects us. Waiting for the operator to approve.`;
    case "rejected":
      return REJECT_TEXT[link.reason] + (link.detail ? ` (${link.detail})` : "");
    case "revoked":
      return "The operator deleted this weapon's key. Enter a new one to rejoin.";
  }
}

const REJECT_TEXT: Record<Extract<LinkStatus, { state: "rejected" }>["reason"], string> = {
  INVALID_KEY: "The Command Center doesn't know this key.",
  REVOKED: "This key has been revoked.",
  TYPE_MISMATCH: "This key is for a radar, not a weapon.",
  ALREADY_CONNECTED: "Another connection is using this key; retrying.",
  REJECTED_BY_OPERATOR: "The operator rejected this weapon.",
  DEVICE_MISMATCH: "This key belongs to another device.",
  BAD_SIGNATURE: "The device key signature didn't verify.",
};
