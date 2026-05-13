/**
 * W5B-B2.12A.7 — Sub-Minute Residue Mechanistic Trace, Step 1 (Comparator).
 *
 * Synthetic, test-only. No production code is exercised end-to-end here.
 * Goal: prove the comparator does not manufacture variance on identical
 *       inputs, that it propagates exact 1-unit shifts as variance = 1,
 *       and that it accepts sub-integer numeric inputs without rounding
 *       (i.e. the comparator itself is NOT the source of the 1–3 minute
 *       residue observed in AI003 live).
 *
 * Forbidden by milestone scope: changing comparator production logic,
 * thresholds, classifications, or the gate. This file only invokes
 * `compareSlotVsTemporalCandidate` with synthetic inputs.
 */

import type {
    ScheduleResultMap,
    TemporalCandidateTaskResult,
    WorkMinutes,
} from "@planner/protocol";
import { describe, expect, it } from "vitest";
import { compareSlotVsTemporalCandidate } from "../../src/schedule/TemporalCandidateComparator.js";

const wm = (value: number): WorkMinutes => value as WorkMinutes;

const slot = (
  overrides?: Partial<ScheduleResultMap[string]>,
): ScheduleResultMap[string] => ({
  earlyStartMinutes: wm(0),
  earlyFinishMinutes: wm(5),
  lateStartMinutes: wm(0),
  lateFinishMinutes: wm(5),
  totalFloatMinutes: wm(0),
  isCritical: true,
  ...overrides,
});

const temporal = (
  taskId: string,
  overrides?: Partial<TemporalCandidateTaskResult>,
): TemporalCandidateTaskResult => ({
  taskId,
  earlyStart: wm(0),
  earlyFinish: wm(5),
  lateStart: wm(0),
  lateFinish: wm(5),
  totalFloat: wm(0),
  freeFloat: wm(0),
  critical: true,
  calendarIdUsed: null,
  ...overrides,
});

const runOne = (s: ScheduleResultMap[string], t: TemporalCandidateTaskResult) =>
  compareSlotVsTemporalCandidate({
    slotResults: { A: s },
    candidateTasks: [t],
    expectedCalendarDivergenceTaskIds: [],
    unsupportedFeatureFlags: [],
  });

describe("W5B-B2.12A.7 Step 1 — Comparator measuring-tape tests", () => {
  it("(1) identical slot and temporal values produce zero variance and `no_difference`", () => {
    const r = runOne(slot(), temporal("A"));
    const row = r.summary.taskComparisons[0]!;
    expect(row.classification).toBe("no_difference");
    expect(row.startVarianceMinutes).toBe(0);
    expect(row.finishVarianceMinutes).toBe(0);
    expect(row.lateStartVarianceMinutes).toBe(0);
    expect(row.lateFinishVarianceMinutes).toBe(0);
    expect(row.totalFloatVarianceMinutes).toBe(0);
    expect(row.criticalVariance).toBe(false);
    expect(r.summary.identicalTaskCount).toBe(1);
    expect(r.summary.unexplainedDivergenceCount).toBe(0);
    expect(r.summary.maxAbsStartVarianceMinutes).toBe(0);
    expect(r.summary.maxAbsFinishVarianceMinutes).toBe(0);
    expect(r.summary.maxAbsTotalFloatVarianceMinutes).toBe(0);
  });

  it("(2a) comparator accepts non-integer sub-minute numeric values (does NOT round at the seam)", () => {
    // The comparator does plain numeric subtraction. If callers pass
    // fractional WorkMinutes (e.g. day-offsets like 1.002), the comparator
    // reports the fractional variance verbatim. This documents that the
    // comparator is NOT a guard against fractional residue introduced
    // upstream.
    const r = runOne(slot(), temporal("A", { earlyStart: wm(0.5) }));
    const row = r.summary.taskComparisons[0]!;
    expect(row.startVarianceMinutes).toBeCloseTo(0.5, 12);
    // The comparator's `isNonZeroVariance` is `value != null && value !== 0`
    // — so 0.5 counts as a non-zero difference and routes to
    // `unexplained_divergence` (no expected/calendar id, no flags).
    expect(row.classification).toBe("unexplained_divergence");
  });

  it("(2b) +59 seconds equivalent (0.983 of a minute) is propagated verbatim — no truncation, no rounding", () => {
    // 59/60 ≈ 0.98333... Numeric subtraction must yield exactly that.
    const fractional = 59 / 60;
    const r = runOne(slot(), temporal("A", { earlyStart: wm(fractional) }));
    const row = r.summary.taskComparisons[0]!;
    expect(row.startVarianceMinutes).toBeCloseTo(fractional, 12);
    expect(row.startVarianceMinutes).not.toBe(0);
    expect(row.startVarianceMinutes).not.toBe(1);
  });

  it("(2c) the live AI003 maxAbsTotalFloatVarianceMinutes = 1.002083... reproduces by plain subtraction", () => {
    // 481/480 = 1.0020833333… — this is the exact value reported live for
    // `maxAbsTotalFloatVarianceMinutes`. It is a 1-unit difference in
    // work-minutes divided by mpd=480 (i.e. the slot side stores totalFloat
    // in DAY-offset units after ProjectionAdapter, while the temporal side
    // stores totalFloat in DAY-offset units via worker.ts:1668 — the seam
    // for the residue is therefore upstream of the comparator).
    const r = runOne(
      slot({ totalFloatMinutes: wm(0) }),
      temporal("A", { totalFloat: wm(481 / 480) }),
    );
    const row = r.summary.taskComparisons[0]!;
    expect(row.totalFloatVarianceMinutes).toBeCloseTo(481 / 480, 12);
    expect(r.summary.maxAbsTotalFloatVarianceMinutes).toBeCloseTo(481 / 480, 12);
  });

  it("(3) start shifted by exactly 1 unit produces sv = +1", () => {
    const r = runOne(slot(), temporal("A", { earlyStart: wm(1) }));
    const row = r.summary.taskComparisons[0]!;
    expect(row.startVarianceMinutes).toBe(1);
    expect(row.classification).toBe("unexplained_divergence");
    expect(r.summary.maxAbsStartVarianceMinutes).toBe(1);
  });

  it("(3b) start shifted by exactly -1 unit produces sv = -1 (sign preserved)", () => {
    const r = runOne(slot({ earlyStartMinutes: wm(1) }), temporal("A", { earlyStart: wm(0) }));
    const row = r.summary.taskComparisons[0]!;
    expect(row.startVarianceMinutes).toBe(-1);
    expect(r.summary.maxAbsStartVarianceMinutes).toBe(1);
  });

  it("(4) finish shifted by exactly 1 unit produces fv = +1, leaving sv = 0", () => {
    const r = runOne(slot(), temporal("A", { earlyFinish: wm(6) }));
    const row = r.summary.taskComparisons[0]!;
    expect(row.startVarianceMinutes).toBe(0);
    expect(row.finishVarianceMinutes).toBe(1);
    expect(r.summary.maxAbsFinishVarianceMinutes).toBe(1);
  });

  it("(5) total float shifted by exactly 1 unit produces tfv = +1", () => {
    const r = runOne(slot(), temporal("A", { totalFloat: wm(1) }));
    const row = r.summary.taskComparisons[0]!;
    expect(row.totalFloatVarianceMinutes).toBe(1);
    expect(r.summary.maxAbsTotalFloatVarianceMinutes).toBe(1);
  });

  it("(5b) total float shifted by 1 unit while start/finish identical still classifies as `unexplained_divergence`", () => {
    // No expected ID, no flags, leaf (caller does not pass summaryTaskIds).
    const r = runOne(slot(), temporal("A", { totalFloat: wm(1) }));
    expect(r.summary.taskComparisons[0]!.classification).toBe("unexplained_divergence");
    expect(r.summary.unexplainedDivergenceCount).toBe(1);
  });

  it("(6) null float on one side is treated as `no difference for that axis`", () => {
    // Slot ScheduleResultMap has no freeFloat field, so freeFloatVariance is null.
    const r = runOne(slot(), temporal("A", { freeFloat: wm(5) }));
    const row = r.summary.taskComparisons[0]!;
    expect(row.freeFloatVarianceMinutes).toBeNull();
    // The other axes match, so the row is classified as `no_difference`.
    expect(row.classification).toBe("no_difference");
  });

  it("(7) critical flag flip alone classifies as `unexplained_divergence` for a leaf", () => {
    const r = runOne(slot({ isCritical: true }), temporal("A", { critical: false }));
    const row = r.summary.taskComparisons[0]!;
    expect(row.criticalVariance).toBe(true);
    expect(row.startVarianceMinutes).toBe(0);
    expect(row.finishVarianceMinutes).toBe(0);
    expect(row.classification).toBe("unexplained_divergence");
  });

  it("(8) all variance fields are exactly zero when slot==temporal across many shapes (smoke matrix)", () => {
    const matrix: ReadonlyArray<{
      sStart: number;
      sFinish: number;
      lFinish: number;
      tf: number;
    }> = [
      { sStart: 0, sFinish: 0, lFinish: 0, tf: 0 },
      { sStart: 0, sFinish: 480, lFinish: 480, tf: 0 },
      { sStart: 480, sFinish: 960, lFinish: 960, tf: 0 },
      { sStart: 1000, sFinish: 1500, lFinish: 1500, tf: 0 },
      { sStart: 0, sFinish: 1, lFinish: 1, tf: 0 }, // day-offset coordinates
      { sStart: 7, sFinish: 8, lFinish: 8, tf: 0 },
    ];
    for (const m of matrix) {
      const r = runOne(
        slot({
          earlyStartMinutes: wm(m.sStart),
          earlyFinishMinutes: wm(m.sFinish),
          lateStartMinutes: wm(m.sStart),
          lateFinishMinutes: wm(m.lFinish),
          totalFloatMinutes: wm(m.tf),
        }),
        temporal("A", {
          earlyStart: wm(m.sStart),
          earlyFinish: wm(m.sFinish),
          lateStart: wm(m.sStart),
          lateFinish: wm(m.lFinish),
          totalFloat: wm(m.tf),
        }),
      );
      expect(r.summary.identicalTaskCount).toBe(1);
      expect(r.summary.maxAbsStartVarianceMinutes).toBe(0);
      expect(r.summary.maxAbsFinishVarianceMinutes).toBe(0);
      expect(r.summary.maxAbsTotalFloatVarianceMinutes).toBe(0);
    }
  });
});

/**
 * Step 1 finding (asserted by tests above):
 *
 *   F1. Comparator math is pure subtraction. It does not round, snap, floor,
 *       or ceil. Identical inputs ⇒ zero variance. 1-unit shifts ⇒ ±1.
 *   F2. The comparator passes fractional inputs through verbatim (Test 2a/2b).
 *       Therefore, the 1.002083333… residue observed live for
 *       `maxAbsTotalFloatVarianceMinutes` CANNOT be manufactured inside the
 *       comparator — it must already exist in either `slotResults` or
 *       `candidateTasks` by the time the comparator is called.
 *   F3. The seam where residue enters is upstream: SlotScheduleTranslator +
 *       ProjectionAdapter (slot side) or TemporalScheduleTranslator + the
 *       worker.ts:1660 conversion (temporal side). Step 2 tests target both.
 */
