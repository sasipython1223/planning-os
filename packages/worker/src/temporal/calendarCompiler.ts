/**
 * @module calendarCompiler
 *
 * Phase D2 — Compile CalendarConfig into working-time intervals.
 *
 * The temporal kernel expects calendars as sorted, non-overlapping
 * half-open working intervals `[start_minute, end_minute)` expressed
 * in absolute-minute space (offset from the MinuteAnchor epoch).
 *
 * This module converts the declarative CalendarConfig (week pattern +
 * holidays) into that concrete interval representation.
 *
 * Phase D2: build-only — the compiled intervals are assembled into
 * the TemporalScheduleRequest payload but never sent to the kernel.
 */

import type { CalendarConfig } from "@planner/protocol";
import type { MinuteAnchor } from "./minuteAnchor.js";
import { dayOffsetToMinute } from "./minuteAnchor.js";

/** A single half-open working interval [startMinute, endMinute). */
export type WorkingInterval = readonly [start: number, end: number];

/**
 * Compile a CalendarConfig into absolute-minute working intervals.
 *
 * For each calendar day in the horizon that is a working day:
 *   - Compute the day's midnight minute (dayOffset × 1440 from anchor).
 *   - Emit `[midnight, midnight + minutesPerDay)` as a working interval.
 *
 * Working intervals start at day-midnight; their width equals the
 * calendar's `minutesPerDay` (typically 480 = 8h). Non-working days
 * (weekends per workingWeekPattern, holidays) are simply omitted.
 *
 * @param config    Calendar configuration to compile.
 * @param anchor    Minute-epoch anchor (from project start date).
 * @param horizon   Number of calendar days to scan (default 3650 ≈ 10 years).
 * @returns Sorted array of half-open [start, end) working intervals.
 */
export function compileCalendar(
  config: CalendarConfig,
  anchor: MinuteAnchor,
  horizon: number = 3650,
): WorkingInterval[] {
  const intervals: WorkingInterval[] = [];
  const minutesPerDay = config.minutesPerDay as number;

  // Pre-index holidays into a Set of day-offsets for O(1) lookup.
  const holidayOffsets = new Set<number>();
  if (config.holidays.length > 0) {
    const anchorDate = new Date(anchor.epochMs);
    const anchorTime = anchorDate.getTime();
    const msPerDay = 86_400_000;
    for (const holiday of config.holidays) {
      const hMs = Date.UTC(
        Number(holiday.slice(0, 4)),
        Number(holiday.slice(5, 7)) - 1,
        Number(holiday.slice(8, 10)),
      );
      const offset = Math.round((hMs - anchorTime) / msPerDay);
      if (offset >= 0 && offset < horizon) {
        holidayOffsets.add(offset);
      }
    }
  }

  // Build a Date anchored at the epoch for weekday checking.
  const anchorDate = new Date(anchor.epochMs);

  for (let d = 0; d < horizon; d++) {
    // Skip holidays
    if (holidayOffsets.has(d)) continue;

    // Skip weekend days if MON_FRI pattern
    if (config.workingWeekPattern === "MON_FRI") {
      const date = new Date(anchorDate);
      date.setUTCDate(anchorDate.getUTCDate() + d);
      const dow = date.getUTCDay(); // 0=Sun, 6=Sat
      if (dow === 0 || dow === 6) continue;
    }

    // Working day — emit interval
    const dayStart = dayOffsetToMinute(d);
    intervals.push([dayStart, dayStart + minutesPerDay]);
  }

  return intervals;
}

// ─── Compiler Cache ─────────────────────────────────────────────────

/**
 * Cache for compiled calendars, keyed by calendar config fields + anchor epoch.
 * Avoids recompiling on every schedule pass when neither the calendar config
 * nor the project start date has changed.
 *
 * D2: the cache lives for the lifetime of the worker. It is keyed by all
 * fields that affect interval output (id, minutesPerDay, weekPattern,
 * holidays, anchor epoch). A calendar config edit produces a different key,
 * so stale entries are never returned — they simply become unreachable and
 * are reclaimed on the next `clear()` call.
 *
 * D3 consideration: if memory pressure from orphaned entries becomes a
 * concern, add an LRU eviction policy or clear the cache on config change.
 */
export class CalendarCompilerCache {
  private readonly cache = new Map<string, WorkingInterval[]>();

  /**
   * Get or compile a calendar's working intervals.
   *
   * @param config   Calendar configuration.
   * @param anchor   Minute-epoch anchor.
   * @param horizon  Calendar day horizon.
   * @returns Cached or freshly compiled intervals.
   */
  getOrCompile(
    config: CalendarConfig,
    anchor: MinuteAnchor,
    horizon: number = 3650,
  ): WorkingInterval[] {
    const key = this.cacheKey(config, anchor);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const intervals = compileCalendar(config, anchor, horizon);
    this.cache.set(key, intervals);
    return intervals;
  }

  /** Invalidate all cached entries. */
  clear(): void {
    this.cache.clear();
  }

  /** Number of cached entries (for testing). */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Build a stable cache key from CalendarConfig + anchor.
   * Includes all fields that affect compiled interval output:
   * id, minutesPerDay, workingWeekPattern, holidays, and anchor epoch.
   * Changing the project start date (anchor) produces different absolute
   * minute offsets, so the anchor must be part of the key.
   */
  private cacheKey(config: CalendarConfig, anchor: MinuteAnchor): string {
    return `${config.id}:${config.minutesPerDay}:${config.workingWeekPattern}:${anchor.epochMs}:${config.holidays.join(",")}`;
  }
}
