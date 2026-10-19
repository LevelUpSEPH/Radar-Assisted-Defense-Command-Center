import { KeysPanel } from "./KeysPanel";
import { UnitsPanel } from "./UnitsPanel";
import type { CommandSocket } from "./useCommandSocket";

export function Sidebar({ cc }: { cc: CommandSocket }) {
  const { connected, state, error, clearError, send } = cc;

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <div>
          <h1>Command Center</h1>
          <p className="subtitle">Operator view</p>
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

      <UnitsPanel units={state?.units ?? []} />

      <KeysPanel keys={state?.keys ?? []} disabled={!connected} send={send} />
    </aside>
  );
}
