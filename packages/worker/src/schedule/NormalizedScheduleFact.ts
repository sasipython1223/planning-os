/**
 * @module NormalizedScheduleFact
 *
 * Phase D4 — Engine-neutral schedule fact type for projection and comparison.
 *
 * Both the slot kernel and temporal kernel produce schedule results in
 * their own coordinate systems (day-offsets for slot, absolute minutes
 * for temporal). A ScheduleTranslator converts either engine's raw
 * output into NormalizedScheduleFacts — a common representation using
 * real calendar dates (epoch-ms at UTC midnight) and working-minute
 * durations.
 *
 * Consumers:
 *   - ProjectionAdapter: converts facts → ScheduleResultMap for the
 *     existing downstream pipeline (rollups, variances, histogram, UI).
 *   - ScheduleComparator: compares slot facts vs temporal facts for
 *     D3 shadow validation.
 *
 * Phase D4: the slot engine remains authoritative. Temporal facts are
 * produced for shadow comparison only and never enter projection,
 * persistence, or UI.
 *
 * This type is separate from VisibleRow and ScheduleResultMap.
 */

/** Milliseconds in one calendar day. */
export const MS_PER_DAY = 86_400_000;

/**
 * Normalized per-task schedule fact — engine-neutral.
 *
 * Date fields are epoch-ms at UTC midnight, representing the calendar
 * date the event falls on. Float fields are working minutes.
 *
 * D4 precision: day-level only. Dates are bucketed to UTC-midnight
 * boundaries; intra-day temporal offsets are discarded by the
 * TemporalScheduleTranslator via floor(). This is a deliberate D4
 * limitation — the final temporal-native projection model (D5+) may
 * introduce sub-day precision.
 *
 * This shape is intentionally independent of any kernel coordinate
 * system. Both translators produce the same shape; the worker and
 * comparator consume facts without knowing which engine produced them.
 */
export type ScheduleFact = {
  readonly taskId: string;
  /** Early start date — epoch-ms (UTC midnight). */
  readonly earlyStartDate: number;
  /** Early finish date — epoch-ms (UTC midnight). */
  readonly earlyFinishDate: number;
  /** Late start date — epoch-ms (UTC midnight). */
  readonly lateStartDate: number;
  /** Late finish date — epoch-ms (UTC midnight). */
  readonly lateFinishDate: number;
  /** Total float in working minutes (e.g. 480 = 1 working day). */
  readonly totalFloatMinutes: number;
  /** Free float in working minutes. Slot kernel always produces 0. */
  readonly freeFloatMinutes: number;
  readonly isCritical: boolean;
};

/**
 * Map of schedule facts keyed by task ID.
 *
 * Produced by IScheduleTranslator.translate().
 * Consumed by ProjectionAdapter and ScheduleComparator.
 */
export type NormalizedScheduleFacts = {
  readonly [taskId: string]: ScheduleFact;
};
