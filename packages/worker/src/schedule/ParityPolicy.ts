import type { ScheduleMismatch } from "./ScheduleComparator.js";

export type ParityMismatchCategory =
  | "true_regression"
  | "expected_precision_improvement"
  | "known_slot_minute_divergence"
  | "comparator_tolerance_policy_gap";

export type KnownDivergencePolicy = {
  readonly id: string;
  readonly category: Exclude<
    ParityMismatchCategory,
    "true_regression" | "comparator_tolerance_policy_gap"
  >;
  readonly rationale: string;
};

const CORE_STRICT_FIELDS = new Set<string>([
  "earlyStartDate",
  "earlyFinishDate",
  "lateStartDate",
  "lateFinishDate",
  "totalFloatMinutes",
  "isCritical",
]);

const TASK_CALENDAR_EXPECTED_FIELDS = new Set<string>([
  "earlyStartDate",
  "earlyFinishDate",
  "lateStartDate",
  "lateFinishDate",
  "totalFloatMinutes",
]);

export const KNOWN_DIVERGENCE_ALLOWLIST: readonly KnownDivergencePolicy[] = [
  {
    id: "holiday_constraint_minute_coordinate",
    category: "expected_precision_improvement",
    rationale:
      "Project-calendar holiday snapping preserves date parity while minute coordinate gains precision.",
  },
  {
    id: "half_day_constraint_end_of_day_detail",
    category: "expected_precision_improvement",
    rationale:
      "Half-day calendars carry minute detail that slot day offsets cannot represent.",
  },
  {
    id: "non_uniform_working_pattern_scalar_bridge",
    category: "known_slot_minute_divergence",
    rationale:
      "Scalar day-slot compatibility bridging diverges from minute-native payload semantics.",
  },
];

export const classifyMismatch = (
  mismatch: ScheduleMismatch,
): ParityMismatchCategory => {
  if (
    mismatch.expectedDueToPerTaskCalendar
    && TASK_CALENDAR_EXPECTED_FIELDS.has(mismatch.field)
  ) {
    return "known_slot_minute_divergence";
  }

  if (CORE_STRICT_FIELDS.has(mismatch.field)) {
    return "true_regression";
  }

  if (mismatch.field === "freeFloatMinutes") {
    return "comparator_tolerance_policy_gap";
  }

  // Unknown fields remain strict by default.
  return "true_regression";
};

export const summarizeMismatchCategories = (
  mismatches: readonly ScheduleMismatch[],
): Record<ParityMismatchCategory, number> => {
  const summary: Record<ParityMismatchCategory, number> = {
    true_regression: 0,
    expected_precision_improvement: 0,
    known_slot_minute_divergence: 0,
    comparator_tolerance_policy_gap: 0,
  };

  for (const mismatch of mismatches) {
    summary[classifyMismatch(mismatch)] += 1;
  }

  return summary;
};

export const classifyKnownDivergenceById = (
  id: string,
): KnownDivergencePolicy["category"] | null => {
  const entry = KNOWN_DIVERGENCE_ALLOWLIST.find((item) => item.id === id);
  return entry?.category ?? null;
};
