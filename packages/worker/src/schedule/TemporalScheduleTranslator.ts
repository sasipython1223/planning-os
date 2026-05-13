/**
 * @module TemporalScheduleTranslator
 *
 * Phase D4 — Translates temporal kernel output into NormalizedScheduleFacts.
 *
 * The temporal kernel returns absolute working-minute offsets from the
 * MinuteAnchor epoch (which equals project start in D2). This translator
 * converts those offsets into epoch-ms calendar dates and passes through
 * working-minute floats, so downstream consumers deal only with
 * engine-neutral facts.
 *
 * Phase D4: shadow path only. The resulting facts feed into the
 * ScheduleComparator for D3 shadow validation. They never enter
 * projection, persistence, or UI.
 *
 * Conversion: dayOffset = floor(absoluteMinute / 1440), then
 * dateMs = startMs + dayOffset × MS_PER_DAY. This holds because the
 * anchor epoch equals project start and data_date_minute = 0 (both
 * true in D2). If the anchor policy changes, update this translator.
 */

import type { IScheduleTranslator, TranslationContext } from "./IScheduleTranslator.js";
import type { NormalizedScheduleFacts, ScheduleFact } from "./NormalizedScheduleFact.js";
import { MS_PER_DAY } from "./NormalizedScheduleFact.js";
import { parseProjectStartMs } from "./SlotScheduleTranslator.js";

// ─── Temporal response types (mirror WASM boundary) ─────────────────

/**
 * Per-task result from the temporal kernel WASM boundary.
 * Field names match the camelCase serde rename in cpm-wasm/src/lib.rs.
 */
export type TemporalTaskResultBoundary = {
  readonly taskId: string;
  readonly earlyStartMinute: number;
  readonly earlyFinishMinute: number;
  readonly lateStartMinute: number;
  readonly lateFinishMinute: number;
  readonly totalFloatMinutes: number;
  readonly freeFloatMinutes: number;
  readonly isCritical: boolean;
};

/**
 * Success response from the temporal kernel WASM boundary.
 */
export type TemporalScheduleResponseBoundary = {
  readonly scheduleVersion: number;
  readonly results: readonly TemporalTaskResultBoundary[];
};

/**
 * Translate a temporal-engine response into normalized schedule facts.
 *
 * Coordinate conversions:
 *   - Absolute-minute start → epoch-ms: startMs + floor(minute / 1440) × MS_PER_DAY
 *   - Absolute-minute finish → epoch-ms: startMs + ceil(minute / 1440) × MS_PER_DAY
 *   - Float: passthrough (already in working minutes)
 *   - freeFloat: passthrough (temporal kernel produces it)
 *
 * D4 limitation — day-level bucketing: the floor() intentionally
 * discards the intra-day minute remainder so that both engines
 * produce facts at the same day-aligned precision. This is NOT the
 * final temporal-native projection model. D5+ may preserve sub-day
 * offsets once the downstream pipeline supports them.
 *
 * Anchor assumptions (must hold for correct conversion):
 *   1. The temporal kernel's anchor epoch equals project start.
 *   2. data_date_minute = 0 (scheduling starts at project start).
 * If either assumption is violated, the day-offset calculation
 * will silently produce incorrect dates. See module docstring.
 */
export class TemporalScheduleTranslator implements IScheduleTranslator {
  translate(rawResult: unknown, context: TranslationContext): NormalizedScheduleFacts | null {
    const response = rawResult as TemporalScheduleResponseBoundary;
    if (!response.results) return null;

    const startMs = parseProjectStartMs(context.projectStartDate);
    // Temporal kernel coordinates are absolute wall-clock minutes from anchor.
    // Date bucketing must therefore use 1440-minute calendar days, not
    // business minutes-per-day (e.g. 480).
    const WALL_MINUTES_PER_DAY = 1440;
    const startDayBucket = (minute: number): number =>
      Math.floor(minute / WALL_MINUTES_PER_DAY);
    const finishDayBucket = (minute: number): number =>
      Math.ceil(minute / WALL_MINUTES_PER_DAY);
    const facts: Record<string, ScheduleFact> = {};

    for (const r of response.results) {
      facts[r.taskId] = {
        taskId: r.taskId,
        earlyStartDate: startMs + startDayBucket(r.earlyStartMinute) * MS_PER_DAY,
        earlyFinishDate: startMs + finishDayBucket(r.earlyFinishMinute) * MS_PER_DAY,
        lateStartDate: startMs + startDayBucket(r.lateStartMinute) * MS_PER_DAY,
        lateFinishDate: startMs + finishDayBucket(r.lateFinishMinute) * MS_PER_DAY,
        totalFloatMinutes: r.totalFloatMinutes,
        freeFloatMinutes: r.freeFloatMinutes,
        isCritical: r.isCritical,
      };
    }

    return facts;
  }
}
