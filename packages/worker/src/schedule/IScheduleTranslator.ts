/**
 * @module IScheduleTranslator
 *
 * Phase D4 — Schedule translator interface.
 *
 * Translates raw engine output into NormalizedScheduleFacts so the
 * worker and comparator consume engine-neutral calendar dates and
 * working-minute floats — not raw day-offsets or absolute minutes.
 *
 * Two implementations exist:
 *   - SlotScheduleTranslator (converts slot day-offsets → dates)
 *   - TemporalScheduleTranslator (converts temporal minutes → dates)
 *
 * The worker calls the translator via the engine adapter (inside
 * ISchedulingEngine.execute) and never performs coordinate conversion
 * itself.
 */

import type { NormalizedScheduleFacts } from "./NormalizedScheduleFact.js";

/**
 * Context required by translators to convert engine-specific
 * coordinates into calendar dates and working-minute values.
 *
 * D4: minutesPerDay reflects business-hours granularity (e.g. 480
 * for an 8-hour work day). It is used by the slot translator to
 * convert day-offset floats into working minutes, and by the
 * temporal translator to bucket absolute minutes into calendar days.
 */
export type TranslationContext = {
  /** Project start date as ISO string "YYYY-MM-DD". */
  readonly projectStartDate: string;
  /** Working minutes per day (e.g. 480 for an 8-hour day). */
  readonly minutesPerDay: number;
};

/**
 * Uniform translator interface.
 *
 * Each engine adapter owns a translator instance and calls translate()
 * on successful kernel output. The resulting facts flow into:
 *   - ProjectionAdapter (for the authoritative slot path)
 *   - ScheduleComparator (for D3 shadow comparison)
 */
export interface IScheduleTranslator {
  /**
   * Translate raw engine output into normalized schedule facts.
   *
   * @param rawResult  The engine's native output (ScheduleResponse for
   *                   slot, TemporalScheduleResponseBoundary for temporal).
   * @param context    Project-level translation context.
   * @returns Normalized facts map, or null if translation fails.
   */
  translate(rawResult: unknown, context: TranslationContext): NormalizedScheduleFacts | null;
}
