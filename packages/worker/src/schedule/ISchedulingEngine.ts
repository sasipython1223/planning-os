/**
 * @module ISchedulingEngine
 *
 * Phases D3–D4 — Scheduling engine interface for dual-run validation
 * and projection seam.
 *
 * Abstracts the scheduling execution so that the slot kernel and temporal
 * kernel can be invoked through a uniform contract. The ShadowEngineFacade
 * composes two ISchedulingEngine implementations (slot + temporal) and
 * runs the temporal one in shadow mode for comparison.
 *
 * Phase D4: the slot engine is authoritative. The temporal engine runs
 * in shadow only. Engine adapters use IScheduleTranslator to produce
 * NormalizedScheduleFacts (calendar dates + working-minute floats),
 * which feed into the ProjectionAdapter and ScheduleComparator.
 */

import type { AssumptionSet, AuthoredActivity, CalendarConfig, Dependency, Task } from "@planner/protocol";
import type { ScheduleError, ScheduleResponse } from "@planner/protocol/kernel";
import type { CompiledCalendar } from "../calendarRegistry.js";
import type { KernelTemporalAdapter } from "../calendarTypes.js";
import type { SchedulingMode } from "../schedulingMode.js";
import type { NormalizedScheduleFacts } from "./NormalizedScheduleFact.js";

/**
 * State snapshot that engines read from to build their requests.
 * This is a read-only view — engines must NEVER mutate this.
 *
 * Intentionally a superset of TemporalStateReader so both adapters
 * can use the same snapshot without re-reading global state.
 */
export type SchedulingStateSnapshot = {
  readonly tasks: readonly Task[];
  readonly dependencies: readonly Dependency[];
  readonly projectStartDate: string;
  readonly projectCalendar: CalendarConfig;
  readonly findTask: (id: string) => Task | undefined;
  readonly calendars: Record<string, CalendarConfig>;
  readonly nonWorkingDays: readonly number[];
  readonly nwdSet: ReadonlySet<number>;
  readonly schedulingMode: SchedulingMode;
  readonly assumptionSet: AssumptionSet;
  readonly authoredActivities: readonly AuthoredActivity[];
  /** Optional compiled project calendar for calendar-aware input translation. */
  readonly compiledProjectCalendar?: CompiledCalendar;
  /**
   * Kernel temporal adapter — provides minutesPerDay and fromDaySlots
   * for OUTPUT-side conversion (rollup, constraint diagnostics, projection).
   *
   * D5: INPUT-side conversion is handled by IEngineCoordinateTranslator
   * instances created per-run by each adapter. The adapters extract
   * minutesPerDay from this field to build InputTranslationContext.
   */
  readonly temporalAdapter: KernelTemporalAdapter;
};

/**
 * Result from an engine execution.
 *
 * `rawResult` — the engine's native output. Only the SLOT adapter's
 * rawResult is used for error detection. The temporal adapter's
 * rawResult is opaque — never read downstream.
 *
 * `normalized` — NormalizedScheduleFacts produced by the engine's
 * translator (Phase D4). The slot adapter's facts feed into
 * ProjectionAdapter → ScheduleResultMap → existing pipeline.
 * Both adapters' facts feed into ScheduleComparator for shadow diff.
 */
export type EngineResult = {
  readonly rawResult: ScheduleResponse | ScheduleError;
  readonly normalized: NormalizedScheduleFacts | null;
};

/**
 * Uniform scheduling engine interface.
 *
 * Phase D3: two implementations exist:
 *   - SlotEngineAdapter (authoritative, production)
 *   - TemporalEngineAdapter (shadow only, comparison)
 */
export interface ISchedulingEngine {
  /** Execute the engine against the given state snapshot. */
  execute(state: SchedulingStateSnapshot): EngineResult;
}
