/**
 * @module calendarResolution
 *
 * Track A Step 3 — Calendar Resolution Policy.
 *
 * Pure functions that determine the effective calendar for an entity.
 * Reads canonical assignment state (Step 1) and optional CalendarRegistry
 * lookup (Step 2). Does not mutate state, does not own calendar math.
 *
 * Step 3 scope: policy resolution only.
 * Not yet wired into scheduling pipeline, translator, or UI.
 *
 * Resolution policy:
 *   1. taskCalendarIds[taskId] — explicit task assignment wins.
 *   2. projectCalendarId — project-level default.
 *   3. DEFAULT_CALENDAR_ID — defensive fallback (should not normally fire).
 *
 * Compiled-calendar resolution adds one additional safety rule:
 *   - If the resolved ID is missing from the registry, fall back to
 *     registry.getDefault() rather than crashing.
 */

import type { CalendarAssignmentState, CalendarId } from "@planner/protocol";
import { DEFAULT_CALENDAR_ID } from "@planner/protocol";
import type { CalendarRegistry, CompiledCalendar } from "./calendarRegistry.js";

// ─── ID Resolution ──────────────────────────────────────────────────

/**
 * Resolve the effective calendar ID for a task.
 *
 * Resolution order:
 *   1. taskCalendarIds[taskId] if present → use assigned calendar.
 *   2. projectCalendarId → project-level default.
 *   3. DEFAULT_CALENDAR_ID → defensive fallback.
 *
 * @param taskId           The task to resolve a calendar for.
 * @param assignmentState  Canonical calendar assignment snapshot (Step 1 state).
 * @returns The resolved CalendarId.
 */
export function resolveCalendarIdForTask(
  taskId: string,
  assignmentState: CalendarAssignmentState,
): CalendarId {
  // 1. Explicit task assignment
  const assigned = assignmentState.taskCalendarIds[taskId];
  if (assigned) return assigned;

  // 2. Project calendar
  if (assignmentState.projectCalendarId) return assignmentState.projectCalendarId;

  // 3. Defensive fallback (projectCalendarId is typed non-optional,
  //    but guard defensively at system boundary)
  return DEFAULT_CALENDAR_ID;
}

// ─── Compiled Calendar Resolution ───────────────────────────────────

/**
 * Resolve the effective compiled calendar for a task.
 *
 * Combines ID resolution with registry lookup. If the resolved ID is
 * missing from the registry (e.g. stale assignment after calendar deletion),
 * falls back to registry.getDefault() rather than crashing.
 *
 * @param taskId           The task to resolve a calendar for.
 * @param assignmentState  Canonical calendar assignment snapshot (Step 1 state).
 * @param registry         Compiled calendar registry (Step 2).
 * @returns The resolved CompiledCalendar — always a valid object.
 */
export function resolveCompiledCalendarForTask(
  taskId: string,
  assignmentState: CalendarAssignmentState,
  registry: CalendarRegistry,
): CompiledCalendar {
  const id = resolveCalendarIdForTask(taskId, assignmentState);
  return registry.get(id) ?? registry.getDefault();
}
