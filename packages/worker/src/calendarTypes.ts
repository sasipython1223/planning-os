/**
 * @module calendarTypes
 *
 * Phase B — Calendar Worker Abstractions
 *
 * Defines the seam interfaces and implementations for:
 *   - CalendarResolver: resolves which calendar applies to an entity
 *   - CalendarIndexer: expands calendar rules into non-working day data
 *   - KernelTemporalAdapter: converts WorkMinutes ↔ kernel day-slots
 *
 * Before Phase D, only one computationally active calendar exists:
 * the project calendar.
 *
 * Phase B: single project calendar is computationally active.
 * CalendarIndexer uses CalendarConfig (workingWeekPattern + holidays)
 * to build the non-working-day index for the kernel.
 *
 * Phase C+: task calendar metadata (assignment only, no CPM behavior).
 * Phase D+: per-calendar temporal conversion.
 */

import type { BaseCalendarDefinition, CalendarConfig, CalendarId, Task, TimeInterval, WorkMinutes } from "@planner/protocol";
import { DEFAULT_CALENDAR_ID, MINUTES_PER_DAY } from "@planner/protocol";
import { generateNonWorkingDaysFromConfig } from "./calendar.js";
import { CalendarRegistry, type CompiledCalendar } from "./calendarRegistry.js";
import { getWorkingDayDefinition } from "./workingTimeEngine.js";

// ─── CalendarResolver ───────────────────────────────────────────────

/**
 * Resolves which calendar identity applies to a given entity.
 *
 * Three resolution paths:
 *   - resolveAssignedCalendar: the calendar the user assigned to the task
 *     (falls back to project calendar if unset).
 *   - resolveComputationalCalendar: the calendar actually used for scheduling.
 *     Phase C/W5A: always returns projectCalendarId() (single computational calendar).
 *     Phase W5B: may return the assigned calendar for per-task CPM if recalculation
 *       context is active (isActivityCalendarRecalculation flag).
 *   - resolve() is kept for backward compat and delegates to resolveComputationalCalendar.
 */
export interface CalendarResolver {
  /** Resolve the effective computational calendar for a task or entity. */
  resolve(entityId?: string): CalendarId;

  /** Return the project-level default calendar ID. */
  projectCalendarId(): CalendarId;

  /**
   * Phase C: resolve the user-assigned calendar for a task.
   * Returns task.assignedCalendarId if set, otherwise projectCalendarId().
   */
  resolveAssignedCalendar(taskId: string): CalendarId;

  /**
   * Phase C/W5A: resolve the calendar used for computation (scheduling).
   * Before W5B, this ALWAYS returns projectCalendarId().
   * W5B: Even if isActivityCalendarRecalculation is true, returns projectCalendarId()
   *      because true per-task scheduling is not yet implemented.
   *      Activity calendars are compiled/preserved for future phases.
   * Invariant: always returns a valid CalendarId (never null/undefined).
   */
  resolveComputationalCalendar(taskId: string): CalendarId;

  /**
   * W5B-Metadata: Flag to signal that activity calendar compilation is active.
   * Set to true during RUN_IMPORTED_SCHEDULE_RECALCULATION.
   * W5B-B1: Activity calendars are compiled/preserved and can feed temporal
   * shadow behavior. Authoritative slot computation remains project-calendar only.
   * This resolver remains authoritative-scope only and therefore still returns
   * project calendar for computational resolution.
   * Default: false (preserves Phase C/W5A invariant — project calendar only).
   */
  isActivityCalendarRecalculation?: boolean;
}

/**
 * Default CalendarResolver.
 * Phase C/W5A: resolveAssignedCalendar checks task.assignedCalendarId;
 * resolveComputationalCalendar always returns the project calendar.
 * W5B-B1: Activity calendars are compiled and tracked, and temporal shadow
 * may consume task calendars, but
 * resolveComputationalCalendar still returns project calendar only.
 * Authoritative per-task scheduling remains deferred to W5B-B2.
 */
export class DefaultCalendarResolver implements CalendarResolver {
  isActivityCalendarRecalculation: boolean = false;

  constructor(
    private readonly findTask: (id: string) => Task | undefined = () => undefined,
    private readonly projectId: CalendarId = DEFAULT_CALENDAR_ID,
  ) {}

  resolve(entityId?: string): CalendarId {
    return entityId ? this.resolveComputationalCalendar(entityId) : this.projectCalendarId();
  }

  projectCalendarId(): CalendarId {
    return this.projectId;
  }

  resolveAssignedCalendar(taskId: string): CalendarId {
    const task = this.findTask(taskId);
    return task?.assignedCalendarId ?? this.projectCalendarId();
  }

  resolveComputationalCalendar(taskId: string): CalendarId {
    // W5B: Even if isActivityCalendarRecalculation is true, return project calendar.
    // Activity calendars are compiled/preserved but not yet applied to scheduling.
    // True per-task scheduling comes in future phases (W5B-B+).
    return this.projectCalendarId();
  }
}

// ─── CalendarIndexer ────────────────────────────────────────────────

/**
 * Expands calendar configuration into concrete non-working day-offsets
 * for a given date range.
 *
 * Phase B: builds non-working-day index from CalendarConfig
 * (workingWeekPattern + holidays). One project calendar only.
 * Phase C+: may overlay per-task calendar exceptions.
 */
export interface CalendarIndexer {
  /**
   * Generate non-working day-offsets for the given calendar and range.
   *
   * @param calendarId    which calendar to expand (Phase A: ignored, uses project settings)
   * @param startDate     ISO date string (YYYY-MM-DD) for day-offset origin
   * @param horizon       number of calendar days to scan
   * @returns sorted array of blocked day-offsets
   */
  indexNonWorkingDays(
    calendarId: CalendarId,
    startDate: string,
    horizon: number,
  ): number[];
}

/**
 * Default CalendarIndexer — generates non-working day offsets from CalendarConfig.
 * Phase B: uses workingWeekPattern + holidays from the project calendar.
 */
export class DefaultCalendarIndexer implements CalendarIndexer {
  constructor(
    private readonly config: CalendarConfig,
    private readonly compiledProjectCalendar?: CompiledCalendar,
  ) {}

  private addDays(isoDate: string, days: number): string {
    const d = new Date(`${isoDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  indexNonWorkingDays(
    _calendarId: CalendarId,
    startDate: string,
    horizon: number,
  ): number[] {
    if (this.compiledProjectCalendar) {
      const nonWorking: number[] = [];
      for (let offset = 0; offset < horizon; offset++) {
        const date = this.addDays(startDate, offset);
        if (!getWorkingDayDefinition(this.compiledProjectCalendar, date).isWorking) {
          nonWorking.push(offset);
        }
      }
      return nonWorking;
    }

    return generateNonWorkingDaysFromConfig(this.config, startDate, horizon);
  }
}

// ─── KernelTemporalAdapter ──────────────────────────────────────────

/**
 * Converts between canonical WorkMinutes and kernel day-slot ordinals.
 *
 * The kernel operates at day-slot granularity. This adapter encapsulates
 * the conversion so that callers don't embed MINUTES_PER_DAY math directly.
 *
 * Phase B: uses the global MINUTES_PER_DAY constant (480).
 * Phase D+: may use per-calendar minutesPerDay from CalendarConfig.
 *
 * D5 note: INPUT-side conversion (canonical → kernel day-slots) is now
 * handled by SlotCoordinateTranslator (IEngineCoordinateTranslator).
 * This interface remains active for:
 *   - OUTPUT-side conversion: fromDaySlots (rollup, constraint diagnostics)
 *   - Metadata: minutesPerDay (used to build InputTranslationContext)
 * The toDaySlots method on this interface is legacy for the input path
 * but still used by rollup.ts for summary working-day counting.
 */
export interface KernelTemporalAdapter {
  /** Convert canonical WorkMinutes to kernel day-slot units. */
  toDaySlots(workMinutes: WorkMinutes): WorkMinutes;

  /** Convert kernel day-slot units back to canonical WorkMinutes. */
  fromDaySlots(daySlots: WorkMinutes): WorkMinutes;

  /**
   * The minutes-per-day value used for conversions.
   * Phase B: always MINUTES_PER_DAY (480). Does not vary per-entity or per-calendar.
   * Phase D+: may reflect a calendar-specific working-day length.
   */
  readonly minutesPerDay: WorkMinutes;
}

/**
 * Default KernelTemporalAdapter — uses global MINUTES_PER_DAY (480).
 * Preserves existing behavior: Math.round(wm / 480) for toDaySlots,
 * daySlots * 480 for fromDaySlots.
 */
export class DefaultKernelTemporalAdapter implements KernelTemporalAdapter {
  readonly minutesPerDay: WorkMinutes = MINUTES_PER_DAY;

  toDaySlots(workMinutes: WorkMinutes): WorkMinutes {
    return Math.round(workMinutes / MINUTES_PER_DAY) as WorkMinutes;
  }

  fromDaySlots(daySlots: WorkMinutes): WorkMinutes {
    return (daySlots * MINUTES_PER_DAY) as WorkMinutes;
  }
}

// ─── Default Calendar Config ────────────────────────────────────────

/**
 * The default project calendar configuration.
 * Phase B: computationally active — CalendarIndexer reads this to build
 * the non-working-day index for scheduling.
 */
export const DEFAULT_CALENDAR_CONFIG: CalendarConfig = {
  id: DEFAULT_CALENDAR_ID,
  name: "Standard (Mon–Fri, 8h)",
  minutesPerDay: MINUTES_PER_DAY,
  workingWeekPattern: "MON_FRI",
  holidays: [],
};

// ─── Track A: Standard Calendar Definition ──────────────────────────

/**
 * Standard 8-hour working-day intervals: 08:00–12:00, 13:00–17:00.
 * Minute-of-day values matching MINUTES_PER_DAY = 480 (8h × 60m).
 */
const STANDARD_WORK_INTERVALS: readonly TimeInterval[] = [
  { startMinute: 480, endMinute: 720 },
  { startMinute: 780, endMinute: 1020 },
];

/**
 * Default BaseCalendarDefinition — Mon–Fri, 8h/day, no exceptions.
 * Deterministic fixture matching DEFAULT_CALENDAR_CONFIG behavior.
 *
 * Track A Step 1: stored in Worker canonical state.
 * Not yet read by any resolver, kernel, or scheduling pipeline.
 */
export const STANDARD_CALENDAR: BaseCalendarDefinition = {
  id: DEFAULT_CALENDAR_ID,
  name: "Standard (Mon–Fri, 8h)",
  weeklyPattern: {
    1: STANDARD_WORK_INTERVALS, // Monday
    2: STANDARD_WORK_INTERVALS, // Tuesday
    3: STANDARD_WORK_INTERVALS, // Wednesday
    4: STANDARD_WORK_INTERVALS, // Thursday
    5: STANDARD_WORK_INTERVALS, // Friday
  },
  exceptions: [],
};

// ─── Factory ────────────────────────────────────────────────────────

/**
 * Composite of all calendar abstractions, passed through the scheduling pipeline.
 * Phase B: all fields use default implementations (single project calendar).
 */
export type CalendarServices = {
  readonly resolver: CalendarResolver;
  readonly indexer: CalendarIndexer;
  readonly temporalAdapter: KernelTemporalAdapter;
  /** Track A Step 6b-2: compiled project calendar for output-side translation. */
  readonly compiledProjectCalendar?: CompiledCalendar;
};

/**
 * Create calendar services from a project CalendarConfig.
 * Phase C: CalendarResolver uses findTask to resolve assigned calendars.
 * CalendarIndexer is driven by the config (week pattern + holidays).
 */
export function createCalendarServices(
  config: CalendarConfig,
  projectCalendarId: CalendarId = DEFAULT_CALENDAR_ID,
  findTask?: (id: string) => Task | undefined,
): CalendarServices {
  return {
    resolver: new DefaultCalendarResolver(findTask, projectCalendarId),
    indexer: new DefaultCalendarIndexer(config),
    temporalAdapter: new DefaultKernelTemporalAdapter(),
  };
}

// ─── Track A Step 6: Calendar-Backed Temporal Adapter ───────────────

/**
 * Derive the effective working-minutes-per-day from a compiled calendar.
 *
 * Uses the average of non-zero daily minutes across the weekly pattern.
 * For STANDARD_CALENDAR: Mon–Fri all 480 → returns 480.
 * Falls back to MINUTES_PER_DAY (480) if no working days exist.
 */
export function computeMinutesPerDay(calendar: CompiledCalendar): WorkMinutes {
  const workingDayMinutes = calendar.dailyMinutes.filter((m) => m > 0);
  if (workingDayMinutes.length === 0) return MINUTES_PER_DAY;
  const avg = workingDayMinutes.reduce((a, b) => a + b, 0) / workingDayMinutes.length;
  return Math.round(avg) as WorkMinutes;
}

/**
 * Track A Step 6: KernelTemporalAdapter backed by a CompiledCalendar.
 *
 * Derives minutesPerDay from the compiled project calendar's weekly pattern
 * rather than hardcoding MINUTES_PER_DAY. Preserves the same toDaySlots /
 * fromDaySlots math used by DefaultKernelTemporalAdapter.
 *
 * For STANDARD_CALENDAR this produces identical behavior (480 min/day).
 */
export class CalendarBackedTemporalAdapter implements KernelTemporalAdapter {
  readonly minutesPerDay: WorkMinutes;

  constructor(compiledCalendar: CompiledCalendar) {
    this.minutesPerDay = computeMinutesPerDay(compiledCalendar);
  }

  toDaySlots(workMinutes: WorkMinutes): WorkMinutes {
    return Math.round((workMinutes as number) / (this.minutesPerDay as number)) as WorkMinutes;
  }

  fromDaySlots(daySlots: WorkMinutes): WorkMinutes {
    return ((daySlots as number) * (this.minutesPerDay as number)) as WorkMinutes;
  }
}

/**
 * Track A Step 6: Create calendar services using Track A infrastructure.
 *
 * Builds a CalendarRegistry from canonical calendar definitions, compiles
 * the project calendar, and derives the temporal adapter from it.
 * Resolver and indexer still use Phase B/C infrastructure (CalendarConfig).
 *
 * Resolution:
 *   1. Build CalendarRegistry from calendarDefinitions.
 *   2. Look up projectCalendarId in registry.
 *   3. If found → derive adapter from compiled calendar.
 *   4. If missing → fall back to registry.getDefault() (STANDARD_CALENDAR).
 *
 * @param config              Phase B CalendarConfig (for indexer).
 * @param calendarDefinitions Track A canonical definitions (for registry).
 * @param projectCalendarId   The project's active calendar ID.
 * @param findTask            Task lookup for resolver.
 */
export function createTrackACalendarServices(
  config: CalendarConfig,
  calendarDefinitions: Readonly<Record<string, BaseCalendarDefinition>>,
  projectCalendarId: CalendarId,
  findTask?: (id: string) => Task | undefined,
): CalendarServices {
  const registry = new CalendarRegistry();
  registry.rebuild(calendarDefinitions);

  const compiledProjectCalendar =
    registry.get(projectCalendarId) ?? registry.getDefault();

  return {
    resolver: new DefaultCalendarResolver(findTask, projectCalendarId),
    indexer: new DefaultCalendarIndexer(config, compiledProjectCalendar),
    temporalAdapter: new CalendarBackedTemporalAdapter(compiledProjectCalendar),
    compiledProjectCalendar,
  };
}
