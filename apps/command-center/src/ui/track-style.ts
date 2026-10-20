// How tracks look. Color means friend or foe only, following the usual map
// convention: friend blue, enemy red, unknown yellow. Drone likelihood is shown
// as a number and a word, in neutral colors, so it never competes with that.

import type { Iff } from "@tdts/shared";

export const IFF_STYLE: Record<Iff, { label: string; color: string }> = {
  FRIENDLY: { label: "Friend", color: "#60a5fa" },
  ENEMY: { label: "Enemy", color: "#ef4444" },
  UNKNOWN: { label: "Unknown", color: "#facc15" },
};

/** Legend order. */
export const IFF_ORDER: readonly Iff[] = ["ENEMY", "UNKNOWN", "FRIENDLY"];

/** Neutral color for likelihood bars. */
export const LIKELIHOOD_COLOR = "#cbd5e1";

export function likelihoodLabel(likelihood: number): string {
  if (likelihood >= 0.7) return "Likely drone";
  if (likelihood >= 0.4) return "Unsure";
  return "Unlikely";
}
