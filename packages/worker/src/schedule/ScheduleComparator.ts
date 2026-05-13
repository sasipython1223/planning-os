/**
 * @module ScheduleComparator
 *
 * Phases D3–D4 — Compare slot and temporal normalized schedule facts.
 *
 * Performs field-by-field comparison of two NormalizedScheduleFacts maps
 * and returns a diagnostic mismatch list. Does not throw, does not mutate
 * state, does not affect the production scheduling path.
 *
 * Phase D4: comparison now operates on NormalizedScheduleFacts (calendar
 * dates as epoch-ms + working-minute floats), not raw WorkMinutes. This
 * lets both engines compare at the projection boundary — the same dates
 * and durations the downstream pipeline would consume.
 *
 * Phase D3/D4: comparison output is logged via console.warn only. It does
 * not flow into projection, persistence, UI, or ScheduleResultMap.
 *
 * Known asymmetry: the slot kernel does NOT produce freeFloat (always 0).
 * To avoid broad false positives, comparator checks freeFloatMinutes only
 * for the zero-total-float cohort where both engines agree totalFloat is 0.
 */

import type { NormalizedScheduleFacts, ScheduleFact } from "./NormalizedScheduleFact.js";

/**
 * A single field-level mismatch between slot and temporal facts.
 */
export type ScheduleMismatch = {
  readonly taskId: string;
  readonly field: string;
  readonly slotValue: number | boolean;
  readonly temporalValue: number | boolean;
  /**
   * True when mismatch is expected in W5B-B1 due to per-task calendar
   * behavior on temporal shadow while slot remains project-calendar based.
   */
  readonly expectedDueToPerTaskCalendar?: boolean;
};

export type DivergenceClassification = "expected_w5b_b1" | "unexplained";

export type ShadowComparisonReadinessReport = {
  readonly tasksCompared: number;
  readonly tasksWithStartVariance: number;
  readonly tasksWithFinishVariance: number;
  readonly tasksWithFloatVariance: number;
  readonly maxStartVarianceMs: number;
  readonly maxFinishVarianceMs: number;
  readonly taskCalendarDifferencesExpected: boolean;
  readonly divergencesDueToPerTaskCalendar: boolean;
  readonly expectedDivergenceTaskIds: readonly string[];
  readonly unexplainedDivergenceTaskIds: readonly string[];
  readonly hasUnexplainedDivergences: boolean;
  readonly singleCalendarParity: boolean;
};

export type CompareSchedulesOptions = {
  /**
   * Task IDs whose assigned calendar differs from project calendar and may
   * therefore diverge on temporal shadow in W5B-B1.
   */
  readonly expectedTaskCalendarDivergenceTaskIds?: ReadonlySet<string>;
};

/**
 * Full comparison result.
 */
export type ComparisonResult = {
  readonly mismatches: readonly ScheduleMismatch[];
  /** Task IDs present in slot but missing in temporal. */
  readonly missingInTemporal: readonly string[];
  /** Task IDs present in temporal but missing in slot. */
  readonly missingInSlot: readonly string[];
  /** W5B-B1.1 readiness summary for shadow comparison diagnostics. */
  readonly readinessReport: ShadowComparisonReadinessReport;
};

/**
 * Date fields to compare (day-aligned epoch-ms values).
 *
 * D4: both translators produce UTC-midnight epoch-ms for integer
 * calendar-day offsets, so strict equality (≡) is appropriate.
 * If D5+ introduces sub-day temporal precision, an epsilon tolerance
 * or explicit rounding-before-compare strategy will be needed.
 */
const DATE_FIELDS: ReadonlyArray<keyof ScheduleFact & string> = [
  "earlyStartDate",
  "earlyFinishDate",
  "lateStartDate",
  "lateFinishDate",
];

/**
 * Float fields to compare (working-minute values).
 */
const FLOAT_FIELDS: ReadonlyArray<keyof ScheduleFact & string> = [
  "totalFloatMinutes",
];

const START_VARIANCE_FIELDS = new Set<string>(["earlyStartDate", "lateStartDate"]);
const FINISH_VARIANCE_FIELDS = new Set<string>(["earlyFinishDate", "lateFinishDate"]);
const FLOAT_VARIANCE_FIELDS = new Set<string>(["totalFloatMinutes", "freeFloatMinutes"]);

const buildMismatch = (
  taskId: string,
  field: string,
  slotValue: number | boolean,
  temporalValue: number | boolean,
  expectedDueToPerTaskCalendar: boolean,
): ScheduleMismatch => ({
  taskId,
  field,
  slotValue,
  temporalValue,
  ...(expectedDueToPerTaskCalendar ? { expectedDueToPerTaskCalendar: true } : {}),
});

const shouldCompareFreeFloat = (slotFact: ScheduleFact, temporalFact: ScheduleFact): boolean =>
  slotFact.totalFloatMinutes === 0 && temporalFact.totalFloatMinutes === 0;

/**
 * Compare two normalized schedule facts maps field-by-field.
 *
 * @param slot     Facts from the slot (authoritative) engine.
 * @param temporal Facts from the temporal (shadow) engine.
 * @returns ComparisonResult with mismatches and missing-task diagnostics.
 */
export function compareSchedules(
  slot: NormalizedScheduleFacts,
  temporal: NormalizedScheduleFacts,
  options: CompareSchedulesOptions = {},
): ComparisonResult {
  const mismatches: ScheduleMismatch[] = [];
  const missingInTemporal: string[] = [];
  const missingInSlot: string[] = [];
  const expectedTaskIds = options.expectedTaskCalendarDivergenceTaskIds ?? new Set<string>();
  const startVarianceTasks = new Set<string>();
  const finishVarianceTasks = new Set<string>();
  const floatVarianceTasks = new Set<string>();
  let maxStartVarianceMs = 0;
  let maxFinishVarianceMs = 0;

  const slotIds = new Set(Object.keys(slot));
  const temporalIds = new Set(Object.keys(temporal));
  const tasksCompared = [...slotIds].filter((taskId) => temporalIds.has(taskId)).length;

  // Check every slot task against temporal
  for (const taskId of slotIds) {
    if (!temporalIds.has(taskId)) {
      missingInTemporal.push(taskId);
      continue;
    }

    const s = slot[taskId];
    const t = temporal[taskId];

    // Compare date fields (epoch-ms)
    for (const field of DATE_FIELDS) {
      const sv = s[field] as number;
      const tv = t[field] as number;
      if (sv !== tv) {
        const expectedDueToPerTaskCalendar = expectedTaskIds.has(taskId);
        mismatches.push(buildMismatch(taskId, field, sv, tv, expectedDueToPerTaskCalendar));
        if (START_VARIANCE_FIELDS.has(field)) {
          startVarianceTasks.add(taskId);
          maxStartVarianceMs = Math.max(maxStartVarianceMs, Math.abs(sv - tv));
        }
        if (FINISH_VARIANCE_FIELDS.has(field)) {
          finishVarianceTasks.add(taskId);
          maxFinishVarianceMs = Math.max(maxFinishVarianceMs, Math.abs(sv - tv));
        }
      }
    }

    // Compare float fields (working minutes)
    for (const field of FLOAT_FIELDS) {
      const sv = s[field] as number;
      const tv = t[field] as number;
      if (sv !== tv) {
        const expectedDueToPerTaskCalendar = expectedTaskIds.has(taskId);
        mismatches.push(buildMismatch(taskId, field, sv, tv, expectedDueToPerTaskCalendar));
        if (FLOAT_VARIANCE_FIELDS.has(field)) {
          floatVarianceTasks.add(taskId);
        }
      }
    }

    // Compare isCritical
    if (s.isCritical !== t.isCritical) {
      mismatches.push(buildMismatch(taskId, "isCritical", s.isCritical, t.isCritical, false));
    }

    if (shouldCompareFreeFloat(s, t) && s.freeFloatMinutes !== t.freeFloatMinutes) {
      const expectedDueToPerTaskCalendar = expectedTaskIds.has(taskId);
      mismatches.push(buildMismatch(taskId, "freeFloatMinutes", s.freeFloatMinutes, t.freeFloatMinutes, expectedDueToPerTaskCalendar));
      floatVarianceTasks.add(taskId);
    }
  }

  // Check for tasks in temporal but not in slot
  for (const taskId of temporalIds) {
    if (!slotIds.has(taskId)) {
      missingInSlot.push(taskId);
    }
  }

  const mismatchTaskIds = new Set(mismatches.map((m) => m.taskId));
  const expectedDivergenceTaskIds = [...mismatchTaskIds].filter((taskId) => expectedTaskIds.has(taskId));
  const unexplainedDivergenceTaskIds = [
    ...new Set([
      ...[...mismatchTaskIds].filter((taskId) => !expectedTaskIds.has(taskId)),
      ...missingInTemporal,
      ...missingInSlot,
    ]),
  ];

  const hasUnexplainedDivergences = unexplainedDivergenceTaskIds.length > 0;
  const divergencesDueToPerTaskCalendar =
    mismatches.length > 0
    && expectedDivergenceTaskIds.length > 0
    && !hasUnexplainedDivergences;

  const readinessReport: ShadowComparisonReadinessReport = {
    tasksCompared,
    tasksWithStartVariance: startVarianceTasks.size,
    tasksWithFinishVariance: finishVarianceTasks.size,
    tasksWithFloatVariance: floatVarianceTasks.size,
    maxStartVarianceMs,
    maxFinishVarianceMs,
    taskCalendarDifferencesExpected: expectedTaskIds.size > 0,
    divergencesDueToPerTaskCalendar,
    expectedDivergenceTaskIds,
    unexplainedDivergenceTaskIds,
    hasUnexplainedDivergences,
    singleCalendarParity: expectedTaskIds.size === 0,
  };

  return { mismatches, missingInTemporal, missingInSlot, readinessReport };
}
