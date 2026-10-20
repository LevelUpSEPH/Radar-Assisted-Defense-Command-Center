import type { LinkStatus } from "../protocol";
import { TracksPanel } from "./TracksPanel";
import type { RadarSocket } from "./useRadarSocket";

export function Sidebar({ radar }: { radar: RadarSocket }) {
  const { connected, state } = radar;

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <div>
          <h1>{state?.name ?? "Radar Center"}</h1>
          <p className="subtitle">Radar Center</p>
        </div>
        <span className={`pill ${connected ? "pill-ok" : "pill-bad"}`}>
          {connected ? "Live" : "Disconnected"}
        </span>
      </header>

      {state && (
        <>
          <section>
            <h2>Links</h2>
            <ul className="list">
              <li>
                <LinkCard link={state.link} url={state.commandCenterUrl} />
              </li>
              <li className="row">
                <div className="row-main">
                  <span>World Simulator</span>
                  <span className="muted small">
                    {state.worldConnected
                      ? `Scanning every ${(state.scanIntervalMs / 1000).toFixed(1)} s`
                      : "Can't see anything: retrying every 2 s"}
                  </span>
                </div>
                <span className={`pill ${state.worldConnected ? "pill-ok" : "pill-bad"}`}>
                  {state.worldConnected ? "Scanning" : "Offline"}
                </span>
              </li>
            </ul>
          </section>

          <TracksPanel tracks={state.tracks} />

          <section>
            <h2>This radar</h2>
            <dl className="facts">
              <dt>Position</dt>
              <dd>
                {state.position.lat.toFixed(4)}, {state.position.lon.toFixed(4)}
              </dd>
              <dt>Range</dt>
              <dd>{(state.rangeM / 1000).toFixed(0)} km</dd>
              <dt>Device</dt>
              <dd>
                <code className="fingerprint" title="Fingerprint of this radar's device key">
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

function LinkCard({ link, url }: { link: LinkStatus; url: string }) {
  const { pill, label } = LINK_TEXT[link.state];
  return (
    <div className="row">
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
      </div>
      <span className={`pill ${pill}`}>{label}</span>
    </div>
  );
}

function explain(link: LinkStatus): string {
  switch (link.state) {
    case "no-key":
      return 'Generate a radar key in the Command Center and put it in this radar\'s config ("key"), or start it with --key.';
    case "connecting":
      return "Trying to reach the Command Center; retrying every 2 s.";
    case "verifying":
      return "Signed the challenge with this radar's device key; waiting for the answer.";
    case "registered":
      return "Registered and sending heartbeats.";
    case "pending":
      return `Connected ${(link.distanceM / 1000).toFixed(1)} km from where this key expects us. Waiting for the operator to approve.`;
    case "rejected":
      return REJECT_TEXT[link.reason] + (link.detail ? ` (${link.detail})` : "");
    case "revoked":
      return "The operator deleted this radar's key. It needs a new key to rejoin.";
  }
}

const REJECT_TEXT: Record<Extract<LinkStatus, { state: "rejected" }>["reason"], string> = {
  INVALID_KEY: "The Command Center doesn't know this key.",
  REVOKED: "This key has been revoked.",
  TYPE_MISMATCH: "This key is for a weapon, not a radar.",
  ALREADY_CONNECTED: "Another connection is using this key; retrying.",
  REJECTED_BY_OPERATOR: "The operator rejected this radar.",
  DEVICE_MISMATCH: "This key belongs to another device.",
  BAD_SIGNATURE: "The device key signature didn't verify.",
};
