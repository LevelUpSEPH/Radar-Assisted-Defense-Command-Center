import { useState } from "react";
import { KeysPanel } from "./KeysPanel";
import { EngagementsPanel } from "./EngagementsPanel";
import { TracksPanel } from "./TracksPanel";
import { UnitsPanel } from "./UnitsPanel";
import type { CommandSocket } from "./useCommandSocket";

type Tab = "tracks" | "units" | "keys";
const TABS: readonly Tab[] = ["tracks", "units", "keys"];
const TAB_LABEL: Record<Tab, string> = { tracks: "Tracks", units: "Units", keys: "Keys" };
const TAB_STORAGE = "tdts.cc.sidebarTab";

/** The tab this browser last had open (a per-viewer convenience; may be unavailable). */
function rememberedTab(): Tab {
  try {
    const saved = localStorage.getItem(TAB_STORAGE);
    return TABS.includes(saved as Tab) ? (saved as Tab) : "tracks";
  } catch {
    return "tracks";
  }
}

export function Sidebar({ cc }: { cc: CommandSocket }) {
  const { connected, state, error, clearError, send } = cc;
  const [tab, setTab] = useState<Tab>(rememberedTab);
  const choose = (next: Tab) => {
    setTab(next);
    try {
      localStorage.setItem(TAB_STORAGE, next);
    } catch {
      // Storage can be blocked; the tab just won't be remembered.
    }
  };

  const tracks = state?.tracks ?? [];
  const units = state?.units ?? [];
  const keys = state?.keys ?? [];
  const engagements = state?.engagements ?? [];
  const awaiting = engagements.filter((e) => e.state === "AWAITING_APPROVAL").length;

  // What each tab has that needs attention.
  const badges: Record<Tab, { count: number; tone: string; title: string }> = {
    // Shots waiting for the operator come first; otherwise engageable enemies.
    tracks:
      awaiting > 0
        ? { count: awaiting, tone: "badge-warn", title: "shots waiting for approval" }
        : {
            count: tracks.filter((t) => t.engageable).length,
            tone: "badge-enemy",
            title: "engageable enemies",
          },
    units: {
      count: units.filter((u) => u.status === "PENDING").length,
      tone: "badge-warn",
      title: "units waiting for approval",
    },
    keys: {
      count: keys.filter((k) => k.status === "ISSUED").length,
      tone: "badge-muted",
      title: "keys not used yet",
    },
  };

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

      <nav className="tabs" role="tablist" aria-label="Sidebar">
        {TABS.map((t) => {
          const badge = badges[t];
          return (
            <button
              key={t}
              type="button"
              role="tab"
              id={`tab-${t}`}
              aria-selected={tab === t}
              aria-controls={`panel-${t}`}
              className={tab === t ? "on" : ""}
              onClick={() => choose(t)}
            >
              {TAB_LABEL[t]}
              {badge.count > 0 && (
                <span className={`tab-badge ${badge.tone}`} title={`${badge.count} ${badge.title}`}>
                  {badge.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
          <button className="link" onClick={clearError} aria-label="Dismiss error">
            ✕
          </button>
        </div>
      )}

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "tracks" && (
          <>
            <EngagementsPanel
              engagements={engagements}
              fireMode={state?.fireMode ?? "approval"}
              heldTracks={state?.heldTracks ?? []}
              disabled={!connected}
              send={send}
            />
            <TracksPanel
              tracks={tracks}
              engagements={engagements}
              heldTracks={state?.heldTracks ?? []}
              minLikelihoodToEngage={state?.minLikelihoodToEngage ?? 0.6}
              disabled={!connected}
              send={send}
            />
          </>
        )}
        {tab === "units" && <UnitsPanel units={units} disabled={!connected} send={send} />}
        {tab === "keys" && <KeysPanel keys={keys} disabled={!connected} send={send} />}
      </div>
    </aside>
  );
}
