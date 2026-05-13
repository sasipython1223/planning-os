/**
 * @module calendarRegistry
 *
 * Track A Step 2 — CalendarRegistry runtime layer.
 *
 * Compiles raw BaseCalendarDefinition objects (canonical state)
 * into CompiledCalendar runtime objects optimized for fast lookup.
 * The registry is a derived runtime cache — never persisted.
 *
 * Step 2 scope: compilation + lookup only.
 * Not yet wired into resolver, translator, scheduling pipeline, or UI.
 *
 * Invariants:
 *   - Worker canonical state (BaseCalendarDefinition) is source of truth.
 *   - CompiledCalendar is derived — rebuilt from definitions on demand.
 *   - Registry must never be persisted in canonical state.
 *   - STANDARD_CALENDAR is always available at DEFAULT_CALENDAR_ID.
 */

import type {
    BaseCalendarDefinition,
    CalendarId,
    DayOfWeek,
    TimeInterval,
} from "@planner/protocol";
import { DEFAULT_CALENDAR_ID } from "@planner/protocol";
import { STANDARD_CALENDAR } from "./calendarTypes.js";

// ─── CompiledCalendar ───────────────────────────────────────────────

/**
 * A normalized, sorted time interval for a single day.
 * Identical shape to TimeInterval but guaranteed:
 *   - startMinute < endMinute
 *   - sorted ascending by startMinute within each day's array
 *   - no overlapping intervals (merged during compilation)
 */
export type NormalizedInterval = {
  readonly startMinute: number;
  readonly endMinute: number;
};

/**
 * Compiled daily work pattern — 7 entries (indexed 0–6, Sunday–Saturday).
 * Each entry is a sorted, non-overlapping array of NormalizedInterval.
 * Empty array = non-working day.
 */
export type CompiledWeeklyPattern = readonly (readonly NormalizedInterval[])[];

/**
 * Compiled calendar — derived runtime object.
 * Optimized for fast date/day lookup by future WorkingTimeEngine.
 *
 * Never persisted. Rebuilt from BaseCalendarDefinition on demand.
 */
export type CompiledCalendar = {
  readonly id: CalendarId;
  readonly name: string;
  /** 7-element array indexed by DayOfWeek (0=Sun..6=Sat). */
  readonly weeklyPattern: CompiledWeeklyPattern;
  /** Date-keyed exception lookup (ISO "YYYY-MM-DD" → intervals). */
  readonly exceptionsByDate: ReadonlyMap<string, readonly NormalizedInterval[]>;
  /** Total working minutes in one standard week (sum of all weekly intervals). */
  readonly weeklyMinutes: number;
  /** Working minutes per day for each weekday (7-element array). */
  readonly dailyMinutes: readonly number[];
};

// ─── Compilation ────────────────────────────────────────────────────

/**
 * Normalize and sort intervals: filter invalid, sort by start, merge overlaps.
 * Defensive — silently drops malformed intervals (startMinute >= endMinute,
 * out of 0–1440 range).
 */
export function normalizeIntervals(
  raw: readonly TimeInterval[],
): NormalizedInterval[] {
  // Filter invalid
  const valid = raw.filter(
    (iv) =>
      iv.startMinute >= 0 &&
      iv.endMinute <= 1440 &&
      iv.startMinute < iv.endMinute,
  );

  if (valid.length === 0) return [];

  // Sort by startMinute
  const sorted = [...valid].sort((a, b) => a.startMinute - b.startMinute);

  // Merge overlapping/adjacent intervals
  const merged: NormalizedInterval[] = [
    { startMinute: sorted[0].startMinute, endMinute: sorted[0].endMinute },
  ];

  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = sorted[i];
    if (curr.startMinute <= prev.endMinute) {
      // Overlap or adjacent — extend
      merged[merged.length - 1] = {
        startMinute: prev.startMinute,
        endMinute: Math.max(prev.endMinute, curr.endMinute),
      };
    } else {
      merged.push({
        startMinute: curr.startMinute,
        endMinute: curr.endMinute,
      });
    }
  }

  return merged;
}

/** Sum working minutes from a normalized interval array. */
function sumMinutes(intervals: readonly NormalizedInterval[]): number {
  let total = 0;
  for (const iv of intervals) {
    total += iv.endMinute - iv.startMinute;
  }
  return total;
}

/**
 * Compile a BaseCalendarDefinition into a CompiledCalendar.
 *
 * Compilation rules:
 *   1. weeklyPattern: for each DayOfWeek (0–6), normalize intervals.
 *      Missing days → empty array (non-working).
 *   2. exceptions: keyed by ISO date string, intervals normalized.
 *      Duplicate dates: last-wins (overwrite).
 *   3. weeklyMinutes: sum of all 7 daily totals.
 *   4. dailyMinutes: per-day totals from weekly pattern.
 */
export function compileCalendar(
  def: BaseCalendarDefinition,
): CompiledCalendar {
  // Build weekly pattern — 7 slots
  const weekly: (readonly NormalizedInterval[])[] = [];
  for (let dow = 0; dow < 7; dow++) {
    const raw = def.weeklyPattern[dow as DayOfWeek];
    weekly.push(raw ? normalizeIntervals(raw) : []);
  }

  // Build daily minutes
  const dailyMinutes = weekly.map((intervals) => sumMinutes(intervals));
  const weeklyMinutes = dailyMinutes.reduce((a, b) => a + b, 0);

  // Build exception map
  const exceptionsByDate = new Map<string, readonly NormalizedInterval[]>();
  for (const exc of def.exceptions) {
    exceptionsByDate.set(exc.date, normalizeIntervals(exc.workIntervals));
  }

  return {
    id: def.id,
    name: def.name,
    weeklyPattern: weekly,
    exceptionsByDate,
    weeklyMinutes,
    dailyMinutes,
  };
}

// ─── CalendarRegistry ───────────────────────────────────────────────

/**
 * Worker-only runtime cache of compiled calendars.
 * Derived from canonical BaseCalendarDefinition state.
 * Never persisted — rebuilt from definitions on demand.
 *
 * Track A Step 2: compilation + lookup only.
 * Not yet wired into resolver, scheduling pipeline, or UI.
 */
export class CalendarRegistry {
  private cache = new Map<string, CompiledCalendar>();

  /**
   * Rebuild the entire registry from a set of raw definitions.
   * Replaces previous cache contents.
   * STANDARD_CALENDAR is always included (cannot be removed).
   */
  rebuild(definitions: Readonly<Record<string, BaseCalendarDefinition>>): void {
    this.cache.clear();
    // Ensure standard calendar is always present
    const defs = { [DEFAULT_CALENDAR_ID as string]: STANDARD_CALENDAR, ...definitions };
    for (const [id, def] of Object.entries(defs)) {
      this.cache.set(id, compileCalendar(def));
    }
  }

  /**
   * Get a compiled calendar by ID.
   * Returns undefined if the ID is not in the registry.
   */
  get(id: CalendarId): CompiledCalendar | undefined {
    return this.cache.get(id as string);
  }

  /**
   * Get the default/standard compiled calendar.
   * Always available — rebuild() guarantees STANDARD_CALENDAR presence.
   */
  getDefault(): CompiledCalendar {
    return this.cache.get(DEFAULT_CALENDAR_ID as string)!;
  }

  /** Check whether a compiled calendar exists for the given ID. */
  has(id: CalendarId): boolean {
    return this.cache.has(id as string);
  }

  /** Number of compiled calendars in the registry. */
  get size(): number {
    return this.cache.size;
  }

  /** All compiled calendar IDs currently in the registry. */
  ids(): string[] {
    return [...this.cache.keys()];
  }
}
