import { describe, expect, it } from "vitest";
import { KillChecks } from "./kill-checks";

describe("KillChecks", () => {
  it("reports the hit, then answers from the next sweep", () => {
    const k = new KillChecks();
    expect(k.start("E-0001", "W1-d1")).toEqual({ targetHit: "W1-d1", immediate: null });
    expect(k.afterSweep(new Set(["W1-b1"]))).toEqual([{ checkId: "E-0001", destroyed: true }]);
    // Answered once only.
    expect(k.afterSweep(new Set())).toEqual([]);
  });

  it("says 'still there' when the next sweep still sees it", () => {
    const k = new KillChecks();
    k.start("E-0002", "W1-d2");
    expect(k.afterSweep(new Set(["W1-d2"]))).toEqual([{ checkId: "E-0002", destroyed: false }]);
  });

  it("answers 'destroyed' at once for a track the radar no longer has", () => {
    const k = new KillChecks();
    expect(k.start("E-0003", null)).toEqual({
      targetHit: null,
      immediate: { checkId: "E-0003", destroyed: true },
    });
    expect(k.afterSweep(new Set())).toEqual([]);
  });
});
