import { KIND_COLOR } from "./MapView";
import type { WorldSocket } from "./useWorldSocket";

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour12: false });

export function Sidebar({ world }: { world: WorldSocket }) {
  const { connected, waveFiles, state, error, clearError, send } = world;
  const runs = state ? [...state.waveRuns].reverse() : [];
  const radars = state?.radars ?? [];
  const destroyed = state?.waveRuns.reduce((n, r) => n + r.destroyed, 0) ?? 0;
  const log = state ? [...state.log].reverse() : [];
  const counts = state ? countKinds(state.targets.map((t) => t.kind)) : null;

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <div>
          <h1>World Simulator</h1>
          <p className="subtitle">Ground truth</p>
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

      {counts && (
        <div className="stats">
          <Stat label="Drones" value={counts.drone} color={KIND_COLOR.drone} />
          <Stat label="Friendly" value={counts.friendly} color={KIND_COLOR.friendly} />
          <Stat label="Birds" value={counts.bird} color={KIND_COLOR.bird} />
          <Stat label="Destroyed" value={destroyed} />
        </div>
      )}

      <section>
        <div className="section-head">
          <h2>Wave files</h2>
          <button className="link" onClick={() => send({ type: "refreshWaves", payload: {} })}>
            Refresh
          </button>
        </div>
        {waveFiles.length === 0 && <p className="muted">No wave files found.</p>}
        <ul className="list">
          {waveFiles.map((w) => (
            <li key={w.file} className="row">
              <div className="row-main">
                {w.ok ? (
                  <>
                    <span>{w.name}</span>
                    <span className="muted small">
                      {w.file} · {w.targetCount} targets
                    </span>
                  </>
                ) : (
                  <>
                    <span>{w.file}</span>
                    <span className="bad small">{w.error}</span>
                  </>
                )}
              </div>
              <button
                disabled={!w.ok || !connected}
                onClick={() => send({ type: "startWave", payload: { file: w.file } })}
              >
                Start
              </button>
            </li>
          ))}
        </ul>
        <button
          className="danger full"
          disabled={!connected}
          onClick={() => send({ type: "stopAll", payload: {} })}
        >
          Stop all
        </button>
      </section>

      <section>
        <h2>Waves</h2>
        {runs.length === 0 && <p className="muted">None started yet.</p>}
        <ul className="list">
          {runs.map((r) => (
            <li key={r.runId} className="row">
              <div className="row-main">
                <span>
                  {r.runId} · {r.name}
                </span>
                <span className="muted small">
                  {r.scheduled} waiting · {r.flying} flying · {r.arrived} arrived · {r.destroyed}{" "}
                  destroyed
                </span>
              </div>
              <span className={`pill ${r.finished ? "" : "pill-ok"}`}>
                {r.finished ? "Done" : "Running"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Connected radars</h2>
        {radars.length === 0 && <p className="muted">None.</p>}
        <ul className="list">
          {radars.map((r) => (
            <li key={r.radarId} className="row">
              <span>{r.radarId}</span>
              <span className="muted small">{(r.rangeM / 1000).toFixed(0)} km range</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="log-section">
        <h2>Event log</h2>
        <ul className="log">
          {log.map((e, i) => (
            <li key={`${e.at}-${i}`} className={`log-${e.kind}`}>
              <time>{time(e.at)}</time> {e.text}
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="stat">
      <span className="stat-value" style={color ? { color } : undefined}>
        {value}
      </span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function countKinds(kinds: string[]): Record<"drone" | "friendly" | "bird", number> {
  const c = { drone: 0, friendly: 0, bird: 0 };
  for (const k of kinds) if (k in c) c[k as keyof typeof c]++;
  return c;
}
