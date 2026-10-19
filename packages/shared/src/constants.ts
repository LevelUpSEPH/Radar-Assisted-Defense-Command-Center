// System-wide tuning values (DESIGN.md). Starting points — adjust freely.

/** Manual registration: max distance between expected and reported position. */
export const MANUAL_MATCH_TOLERANCE_M = 2_000;

/** Track fusion: a radar track joins a system track within this distance... */
export const FUSION_GATE_M = 1_000;
/** ...and within this heading difference. */
export const FUSION_HEADING_GATE_DEG = 30;

export const HEARTBEAT_INTERVAL_MS = 2_000;
export const HEARTBEAT_TIMEOUT_MS = 6_000;

/** A radar drops a track after this many scans without seeing it. */
export const RADAR_TRACK_DROP_SCANS = 3;

/** How often the Command Center re-plans weapon assignments. */
export const PLANNING_INTERVAL_MS = 1_000;

/** Earliest-intercept search: time step and how far ahead to look. */
export const INTERCEPT_STEP_S = 0.5;
export const INTERCEPT_HORIZON_S = 600;

/** Kill check: ask radars this long after the shell's arrival time... */
export const KILL_CHECK_DELAY_MS = 1_000;
/** ...and give up waiting for their answers after this long. */
export const KILL_CHECK_TIMEOUT_MS = 3_000;

/** World Simulator tick rate. */
export const WORLD_TICK_MS = 100;

export const DEFAULT_PORTS = {
  /** Radars only. */
  worldSim: 7000,
  worldSimUi: 7001,
  commandCenter: 7100,
  commandCenterUi: 7101,
} as const;
