// Classification (DESIGN.md §5): radars report, the Command Center decides.

import type { Iff } from "@tdts/shared";

/**
 * What the radar reports add up to:
 *   1. FRIENDLY if at least one radar reports it friendly (never shoot a friend
 *      because a different radar wasn't sure);
 *   2. otherwise ENEMY if any radar reports it enemy;
 *   3. otherwise UNKNOWN.
 */
export function classifyFromReports(reports: readonly Iff[]): Iff {
  if (reports.includes("FRIENDLY")) return "FRIENDLY";
  if (reports.includes("ENEMY")) return "ENEMY";
  return "UNKNOWN";
}

/** An operator override always wins; without one, the radar reports decide. */
export function classify(
  reports: readonly Iff[],
  override: Iff | null,
): { classification: Iff; source: "operator" | "radars" } {
  return override
    ? { classification: override, source: "operator" }
    : { classification: classifyFromReports(reports), source: "radars" };
}
