/**
 * @module minuteAnchor
 *
 * Phase D2 — Minute-epoch anchor for temporal kernel payloads.
 *
 * The temporal kernel operates in absolute-minute space: all dates
 * (constraint dates, data date, calendar intervals) are expressed as
 * integer offsets from a fixed epoch. This module defines the epoch
 * and provides bidirectional conversion between ISO date strings and
 * absolute minute offsets.
 *
 * Epoch: midnight UTC on the project start date.
 *
 * Phase D2: build-only — the worker builds the temporal payload but
 * does NOT call `run_schedule_temporal` yet.
 */

/**
 * Minutes in one wall-clock (calendar) day. This is the single source of
 * truth for the wall-clock day width used in all date↔minute conversions.
 * Not to be confused with MINUTES_PER_DAY (480) which is working minutes.
 * All temporal modules must use this value (via dayOffsetToMinute) to
 * ensure consistent anchor-relative positioning.
 */
const WALL_MINUTES_PER_DAY = 1440;

/**
 * The minute-epoch anchor: an absolute UTC timestamp from which all
 * temporal minute offsets are measured.
 */
export type MinuteAnchor = {
  /** Epoch as milliseconds-since-Unix-epoch (matches Date.getTime()). */
  readonly epochMs: number;
};

/**
 * Create a MinuteAnchor from the project start date.
 *
 * @param projectStartDate ISO date string (YYYY-MM-DD).
 * @returns MinuteAnchor anchored at midnight UTC of that date.
 */
export function createMinuteAnchor(projectStartDate: string): MinuteAnchor {
  const epochMs = Date.UTC(
    Number(projectStartDate.slice(0, 4)),
    Number(projectStartDate.slice(5, 7)) - 1,
    Number(projectStartDate.slice(8, 10)),
  );
  return { epochMs };
}

/**
 * Convert an ISO date string to an absolute minute offset from the anchor.
 *
 * @param date ISO date string (YYYY-MM-DD).
 * @param anchor The minute-epoch anchor.
 * @returns Integer minute offset (may be negative if date is before anchor).
 */
export function dateToMinute(date: string, anchor: MinuteAnchor): number {
  const ms = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
  return Math.round((ms - anchor.epochMs) / 60_000);
}

/**
 * Convert an absolute minute offset back to an ISO date string.
 *
 * @param minute Absolute minute offset from the anchor.
 * @param anchor The minute-epoch anchor.
 * @returns ISO date string (YYYY-MM-DD).
 */
export function minuteToDate(minute: number, anchor: MinuteAnchor): string {
  const d = new Date(anchor.epochMs + minute * 60_000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Convert a calendar-day offset (from project start) to an absolute minute.
 * Useful for converting existing non-working-day indices.
 *
 * @param dayOffset Integer day offset from the project start date.
 * @returns Absolute minute offset for midnight of that day.
 */
export function dayOffsetToMinute(dayOffset: number): number {
  return dayOffset * WALL_MINUTES_PER_DAY;
}
