import type { CommandSocket } from "./useCommandSocket";

export function Sidebar({ cc }: { cc: CommandSocket }) {
  const { connected } = cc;

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
    </aside>
  );
}
