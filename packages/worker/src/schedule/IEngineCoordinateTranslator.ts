/**
 * @module IEngineCoordinateTranslator
 *
 * Phase D5 — Input coordinate translator interface.
 *
 * Defines the seam between canonical state (WorkMinutes) and
 * engine-specific primitives (day-slots for slot kernel, working
 * minutes for temporal kernel).
 *
 * Two implementations exist:
 *   - SlotCoordinateTranslator  (WorkMinutes → day-slots, with NWD snapping)
 *   - TemporalCoordinateTranslator (WorkMinutes → number, identity passthrough)
 *
 * Engine adapters own translator instances. The worker passes canonical
 * state only — it never performs coordinate conversion.
 *
 * D5 scope: input translation only. Output translation (engine results →
 * NormalizedScheduleFacts) is handled by IScheduleTranslator (Phase D4).
 */

import type { ConstraintType, WorkMinutes } from "@planner/protocol";
import type { CompiledCalendar } from "../calendarRegistry.js";

/**
 * Context for constructing a coordinate translator.
 *
 * Extracted from SchedulingStateSnapshot by the engine adapter.
 * The worker builds the snapshot but never constructs a translator.
 *
 * D5: minutesPerDay is business-hours granularity (e.g. 480 for an
 * 8-hour day). nwdSet is used by the slot translator for constraint
 * snapping. The temporal translator currently ignores both.
 */
export type InputTranslationContext = {
  /** Project start date as ISO string "YYYY-MM-DD". */
  readonly projectStartDate: string;
  /** Working minutes per day (e.g. 480). */
  readonly minutesPerDay: number;
  /** Non-working day offsets for constraint snapping. */
  readonly nwdSet: ReadonlySet<number>;
  /**
   * Optional compiled project calendar for calendar-aware authored-date
   * translation. When absent, translators must fall back safely.
   */
  readonly projectCalendar?: CompiledCalendar;
};

/**
 * Translate canonical WorkMinutes values into engine-specific primitives.
 *
 * Each engine adapter constructs its own translator per scheduling run
 * and delegates all coordinate conversion to it. The worker never calls
 * these methods directly.
 *
 * D5: canonical state stores WorkMinutes (480 = 1 working day).
 * If canonical state later moves to ISO dates or day-based durations,
 * these method signatures will evolve accordingly.
 */
export interface IEngineCoordinateTranslator {
  /** Convert a duration in WorkMinutes to engine-native units. */
  convertDuration(wm: WorkMinutes): number;

  /**
   * Convert a constraint date in WorkMinutes to engine-native units.
   *
   * For the slot translator this includes NWD snapping (forward for
   * start-oriented constraints, backward for finish-oriented).
   * The temporal translator passes through as-is.
   */
  convertConstraintDate(
    wm: WorkMinutes,
    constraintType?: ConstraintType,
  ): number;

  /** Convert a lag in WorkMinutes to engine-native units. */
  convertLag(wm: WorkMinutes): number;

  /** Convert a minimum early-start offset in WorkMinutes to engine-native units. */
  convertMinEarlyStart(wm: WorkMinutes): number;
}
