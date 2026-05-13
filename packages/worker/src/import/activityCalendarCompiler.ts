/**
 * @module activityCalendarCompiler
 *
 * Phase W5B-Metadata — Activity-level Calendar Compilation and Preservation
 *
 * Maps task assignments to compiled calendar objects for metadata tracking
 * during recalculation.
 *
 * W5B-B1 status:
 * - Calendars are compiled/preserved and fed to temporal shadow payloads.
 * - Slot-authoritative scheduling remains project-calendar only.
 * - Temporal shadow runs per-task calendar behavior only for diagnostics/parity.
 *
 * W5B-Metadata scope: compile task-assigned calendars, track mappings,
 * emit diagnostics. Scheduling still uses project calendar nwdSet only.
 *
 * Invariants:
 *   - Activated only during RUN_IMPORTED_SCHEDULE_RECALCULATION.
 *   - Tasks without assignedCalendarId default to project calendar.
 *   - resolvedCalendarDefinitions (post-W3C inheritance) checked first.
 *   - Falls back to calendarDefinitions if resolved version unavailable.
 *   - Compilation failures emit diagnostics; fallback to project calendar.
 *   - Never mutates canonical state — returns mapping only.
 *   - Authoritative slot scheduling ignores activity calendar compilation output.
 */

import type {
    BaseCalendarDefinition,
    CalendarId,
    Task,
} from "@planner/protocol";
import { compileCalendar, type CompiledCalendar } from "../calendarRegistry.js";


export type ActivityCalendarMapping = {
  readonly taskId: string;
  readonly assignedCalendarId?: CalendarId;
  readonly compiledCalendar: CompiledCalendar;
  readonly isDefault: boolean;
  readonly diagnostic?: string;
};

export type ActivityCalendarCompilationResult = {
  readonly mappings: readonly ActivityCalendarMapping[];
  readonly diagnostics: Record<string, string>;
};

/**
 * Compile task-assigned calendars into runtime calendar objects.
 * NOTE: Calendars are compiled and preserved for metadata tracking and
 * temporal shadow execution. Slot-authoritative scheduling still uses
 * project calendar nwdSet. Authority flip is deferred to W5B-B2.
 *
 * For each task:
 * 1. If task has assignedCalendarId, resolve it in resolvedDefinitions first
 * 2. Fall back to calendarDefinitions if not found in resolved
 * 3. Compile to CompiledCalendar
 * 4. If compilation fails, use project calendar + emit diagnostic
 * 5. If task has no assignedCalendarId, use project calendar
 *
 * Returns mapping of taskId → CompiledCalendar + diagnostics.
 * INVARIANT: Slot-authoritative engine does not use these mappings yet.
 */
export function compileActivityCalendars(
  tasks: readonly Task[],
  projectCalendarId: CalendarId,
  projectCalendar: CompiledCalendar,
  resolvedDefinitions: Readonly<Record<string, BaseCalendarDefinition>>,
  rawDefinitions: Readonly<Record<string, BaseCalendarDefinition>>,
): ActivityCalendarCompilationResult {
  const mappings: ActivityCalendarMapping[] = [];
  const diagnostics: Record<string, string> = {};

  for (const task of tasks) {
    const assignedId = task.assignedCalendarId;

    if (!assignedId) {
      // No assignment — use project calendar
      mappings.push({
        taskId: task.id,
        compiledCalendar: projectCalendar,
        isDefault: true,
      });
      continue;
    }

    const calendarKey = String(assignedId);
    const resolvedDef =
      resolvedDefinitions[calendarKey as CalendarId] ??
      rawDefinitions[calendarKey as CalendarId];

    if (!resolvedDef) {
      // Calendar not found — fallback to project, emit diagnostic
      diagnostics[task.id] = `Task calendar ${assignedId} not found; falling back to project calendar`;
      mappings.push({
        taskId: task.id,
        assignedCalendarId: assignedId,
        compiledCalendar: projectCalendar,
        isDefault: true,
        diagnostic: diagnostics[task.id],
      });
      continue;
    }

    try {
      const compiled = compileCalendar(resolvedDef);
      if (compiled.weeklyMinutes <= 0) {
        diagnostics[task.id] = `Task calendar ${assignedId} has no working time; falling back to project calendar`;
        mappings.push({
          taskId: task.id,
          assignedCalendarId: assignedId,
          compiledCalendar: projectCalendar,
          isDefault: true,
          diagnostic: diagnostics[task.id],
        });
        continue;
      }

      mappings.push({
        taskId: task.id,
        assignedCalendarId: assignedId,
        compiledCalendar: compiled,
        isDefault: false,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      diagnostics[task.id] = `Task calendar ${assignedId} compilation failed: ${errorMsg}; falling back to project calendar`;
      mappings.push({
        taskId: task.id,
        assignedCalendarId: assignedId,
        compiledCalendar: projectCalendar,
        isDefault: true,
        diagnostic: diagnostics[task.id],
      });
    }
  }

  return { mappings, diagnostics };
}

/**
 * Build a Map<taskId, CompiledCalendar> for fast lookup.
 */
export function buildActivityCalendarMap(
  result: ActivityCalendarCompilationResult,
): Map<string, CompiledCalendar> {
  const map = new Map<string, CompiledCalendar>();
  for (const mapping of result.mappings) {
    map.set(mapping.taskId, mapping.compiledCalendar);
  }
  return map;
}

/**
 * Identify which tasks have assigned calendars (for diagnostics).
 */
export function getTasksWithAssignedCalendars(
  result: ActivityCalendarCompilationResult,
): Set<string> {
  const set = new Set<string>();
  for (const mapping of result.mappings) {
    if (mapping.assignedCalendarId && !mapping.isDefault) {
      set.add(mapping.taskId);
    }
  }
  return set;
}
