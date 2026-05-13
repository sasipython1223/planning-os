/**
 * @module temporalRequestBuilder
 *
 * Phases D2–D5 — Build TemporalScheduleRequest from worker state.
 *
 * SHADOW-ONLY: this builder produces payloads for the temporal kernel
 * which runs exclusively in shadow mode (via TemporalEngineAdapter).
 * Temporal results never enter projection, persistence, or UI.
 *
 * Assembles the full payload that the temporal kernel (`run_schedule_temporal`)
 * expects, using MinuteAnchor for date conversion and CalendarCompiler for
 * working-interval generation.
 *
 * Phase D5: coordinate conversion for task durations, constraint dates,
 * and dependency lags is delegated to IEngineCoordinateTranslator.
 * The builder no longer performs identity casts itself. The temporal
 * translator is currently a passthrough but the seam is explicit.
 *
 * The request shape mirrors the Rust `TemporalScheduleRequest`:
 *   { tasks, relations, calendars, project_calendar_id, data_date_minute }
 */

import type { CalendarConfig, Dependency, Task } from "@planner/protocol";
import type { IEngineCoordinateTranslator } from "../schedule/IEngineCoordinateTranslator.js";
import { CalendarCompilerCache } from "./calendarCompiler.js";
import { createMinuteAnchor } from "./minuteAnchor.js";

// ─── Temporal payload types (mirror Rust models) ────────────────────

/**
 * Task input for the temporal kernel.
 * Mirrors `TemporalTaskInput` in cpm-kernel/src/models.rs.
 */
export type TemporalTaskInput = {
  readonly id: string;
  readonly duration_minutes: number;
  readonly calendar_id: string;
  readonly parent_id: string | null;
  readonly is_summary: boolean;
  readonly constraint_type: string;
  readonly constraint_date_minutes: number | null;
};

/**
 * Dependency input for the temporal kernel.
 * Mirrors `TemporalRelationInput` in cpm-kernel/src/models.rs.
 */
export type TemporalRelationInput = {
  readonly pred_id: string;
  readonly succ_id: string;
  readonly dep_type: string;
  readonly lag_minutes: number;
  readonly lag_calendar_id: string;
};

/**
 * Compiled calendar for the temporal kernel.
 * Mirrors `TemporalCalendar` in cpm-kernel/src/models.rs.
 */
export type TemporalCalendar = {
  readonly id: string;
  readonly intervals: ReadonlyArray<readonly [number, number]>;
};

/**
 * Full request payload for the temporal kernel.
 * Mirrors `TemporalScheduleRequest` in cpm-kernel/src/models.rs.
 */
export type TemporalScheduleRequest = {
  readonly tasks: readonly TemporalTaskInput[];
  readonly relations: readonly TemporalRelationInput[];
  readonly calendars: readonly TemporalCalendar[];
  readonly project_calendar_id: string;
  readonly data_date_minute: number;
};

// ─── Builder ────────────────────────────────────────────────────────

/** Shared compiler cache — survives across scheduling passes.
 * D2: cache is keyed by config+anchor; stale entries become unreachable
 * on config or start-date change. See CalendarCompilerCache docstring.
 */
const compilerCache = new CalendarCompilerCache();

/** Reset the compiler cache (tests only). */
export const _resetCompilerCache = (): void => {
  compilerCache.clear();
};

/**
 * State reader interface — subset of State getters the builder needs.
 * Decoupled from the global State module for testability.
 */
export type TemporalStateReader = {
  readonly getTasks: () => readonly Task[];
  readonly getDependencies: () => readonly Dependency[];
  readonly getProjectStartDate: () => string;
  readonly getProjectCalendar: () => CalendarConfig;
  readonly findTask: (id: string) => Task | undefined;
  readonly getCalendars: () => Record<string, CalendarConfig>;
};

/**
 * Build a TemporalScheduleRequest from current worker state.
 *
 * Steps:
 *   1. Create MinuteAnchor from project start date.
 *   2. Compile project calendar into working intervals.
 *   3. Map tasks to TemporalTaskInput — coordinate conversion via translator.
 *   4. Map dependencies to TemporalRelationInput — lag conversion via translator.
 *   5. Assemble full request with data_date_minute = 0 (project start).
 *
 * Phase D5: the translator parameter formalizes the conversion seam.
 * For the temporal path, it is currently an identity passthrough
 * (TemporalCoordinateTranslator). The builder never performs raw
 * `as number` casts on canonical WorkMinutes — that is the translator's
 * responsibility.
 *
 * @param state      State reader providing tasks, deps, calendar config.
 * @param translator Coordinate translator for canonical → engine values.
 * @returns The assembled TemporalScheduleRequest (never null).
 */
export function buildTemporalRequest(
  state: TemporalStateReader,
  translator: IEngineCoordinateTranslator,
): TemporalScheduleRequest {
  const anchor = createMinuteAnchor(state.getProjectStartDate());
  const projectCalendar = state.getProjectCalendar();

  // ── Compile calendars ─────────────────────────────────────────────
  const compiledCalendars: TemporalCalendar[] = [];

  // Always include project calendar
  const projectIntervals = compilerCache.getOrCompile(projectCalendar, anchor);
  compiledCalendars.push({
    id: projectCalendar.id as string,
    intervals: projectIntervals,
  });

  // Phase D2: only the project calendar is computational. Additional
  // calendars are compiled as preparatory scaffolding for D3 multi-calendar
  // validation. The temporal kernel in D1 ignores all calendars except
  // project_calendar_id. Do NOT treat these as production-ready.
  const additionalCalendars = state.getCalendars();
  for (const [id, config] of Object.entries(additionalCalendars)) {
    if (id === (projectCalendar.id as string)) continue; // already added
    const intervals = compilerCache.getOrCompile(config, anchor);
    compiledCalendars.push({ id, intervals });
  }

  // ── Derive summary set ────────────────────────────────────────────
  const tasks = state.getTasks();
  const summaryIds = new Set<string>();
  for (const t of tasks) {
    if (t.parentId) summaryIds.add(t.parentId);
  }

  // ── Map tasks ─────────────────────────────────────────────────────
  const temporalTasks: TemporalTaskInput[] = tasks.map((task) => {
    // D5: constraint date conversion delegated to translator.
    // The temporal translator currently passes WorkMinutes through as-is.
    const constraintDateMinutes: number | null =
      task.constraintDateMinutes != null
        ? translator.convertConstraintDate(task.constraintDateMinutes, task.constraintType)
        : null;

    // Phase D2: calendar_id = project calendar for all tasks.
    // Phase C stored assignedCalendarId on tasks, but it is metadata only —
    // no per-task calendar scheduling occurs until Phase D3+.
    const calendarId = (projectCalendar.id as string);

    return {
      id: task.id,
      duration_minutes: translator.convertDuration(task.durationWorkMinutes),
      calendar_id: calendarId,
      parent_id: task.parentId ?? null,
      is_summary: summaryIds.has(task.id),
      constraint_type: task.constraintType ?? "ASAP",
      constraint_date_minutes: constraintDateMinutes,
    };
  });

  // ── Map dependencies ──────────────────────────────────────────────
  const dependencies = state.getDependencies();
  const temporalRelations: TemporalRelationInput[] = dependencies.map((dep) => ({
    pred_id: dep.predId,
    succ_id: dep.succId,
    dep_type: dep.type,
    lag_minutes: translator.convertLag(dep.lagWorkMinutes),
    lag_calendar_id: projectCalendar.id as string,
  }));

  // ── Assemble request ──────────────────────────────────────────────
  return {
    tasks: temporalTasks,
    relations: temporalRelations,
    calendars: compiledCalendars,
    project_calendar_id: projectCalendar.id as string,
    data_date_minute: 0, // project start = minute 0
  };
}
