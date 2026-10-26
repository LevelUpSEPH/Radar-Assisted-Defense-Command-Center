// Kill confirmation (DESIGN.md §5). The Command Center says a weapon's shot has
// arrived at the object behind one of our tracks. A computed shot always hits,
// so the radar tells its hardware (the world) the object was hit, then looks
// at its next sweep and reports whether the object is gone.

export interface KillCheckReply {
  checkId: string;
  destroyed: boolean;
}

interface Pending {
  checkId: string;
  truthId: string;
}

export class KillChecks {
  private pending: Pending[] = [];

  /**
   * Starts a check. Returns the object to report as hit, or null when the
   * track is unknown (already dropped): then the answer is "destroyed" at once.
   */
  start(
    checkId: string,
    truthId: string | null,
  ): { targetHit: string | null; immediate: KillCheckReply | null } {
    if (!truthId) return { targetHit: null, immediate: { checkId, destroyed: true } };
    this.pending.push({ checkId, truthId });
    return { targetHit: truthId, immediate: null };
  }

  /** After a sweep: answers every pending check from what that sweep saw. */
  afterSweep(seenTruthIds: ReadonlySet<string>): KillCheckReply[] {
    const replies = this.pending.map((p) => ({
      checkId: p.checkId,
      destroyed: !seenTruthIds.has(p.truthId),
    }));
    this.pending = [];
    return replies;
  }
}
