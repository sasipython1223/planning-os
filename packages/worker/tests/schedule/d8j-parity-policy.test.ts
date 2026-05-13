import { describe, expect, it } from "vitest";
import {
    classifyKnownDivergenceById,
    classifyMismatch,
    KNOWN_DIVERGENCE_ALLOWLIST,
    summarizeMismatchCategories,
} from "../../src/schedule/ParityPolicy.js";
import type { ScheduleMismatch } from "../../src/schedule/ScheduleComparator.js";

function mismatch(field: string): ScheduleMismatch {
  return {
    taskId: "T1",
    field,
    slotValue: 1,
    temporalValue: 2,
  };
}

describe("D8j parity policy", () => {
  it("keeps core fields strict as true regression", () => {
    expect(classifyMismatch(mismatch("earlyStartDate"))).toBe("true_regression");
    expect(classifyMismatch(mismatch("lateFinishDate"))).toBe("true_regression");
    expect(classifyMismatch(mismatch("totalFloatMinutes"))).toBe("true_regression");
    expect(classifyMismatch(mismatch("isCritical"))).toBe("true_regression");
  });

  it("classifies freeFloat mismatch as comparator/tolerance-policy gap", () => {
    expect(classifyMismatch(mismatch("freeFloatMinutes"))).toBe(
      "comparator_tolerance_policy_gap",
    );
  });

  it("classifies expected per-task-calendar start/finish/float divergence as known slot-minute divergence", () => {
    expect(
      classifyMismatch({
        ...mismatch("earlyStartDate"),
        expectedDueToPerTaskCalendar: true,
      }),
    ).toBe("known_slot_minute_divergence");

    expect(
      classifyMismatch({
        ...mismatch("totalFloatMinutes"),
        expectedDueToPerTaskCalendar: true,
      }),
    ).toBe("known_slot_minute_divergence");
  });

  it("summarizes mismatch categories deterministically", () => {
    const summary = summarizeMismatchCategories([
      mismatch("earlyFinishDate"),
      mismatch("totalFloatMinutes"),
      mismatch("freeFloatMinutes"),
    ]);

    expect(summary).toEqual({
      true_regression: 2,
      expected_precision_improvement: 0,
      known_slot_minute_divergence: 0,
      comparator_tolerance_policy_gap: 1,
    });
  });

  it("contains explicit known divergence allowlist entries from D8i audit", () => {
    const ids = KNOWN_DIVERGENCE_ALLOWLIST.map((item) => item.id);
    expect(ids).toContain("holiday_constraint_minute_coordinate");
    expect(ids).toContain("half_day_constraint_end_of_day_detail");
    expect(ids).toContain("non_uniform_working_pattern_scalar_bridge");
  });

  it("maps known divergence ids to explicit categories", () => {
    expect(classifyKnownDivergenceById("holiday_constraint_minute_coordinate")).toBe(
      "expected_precision_improvement",
    );
    expect(
      classifyKnownDivergenceById("non_uniform_working_pattern_scalar_bridge"),
    ).toBe("known_slot_minute_divergence");
    expect(classifyKnownDivergenceById("unknown-id")).toBeNull();
  });
});
