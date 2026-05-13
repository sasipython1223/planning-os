/**
 * @module NormalizedScheduleResult
 * @deprecated Phase D3 only. Superseded by NormalizedScheduleFact.ts in D4.
 *
 * This module is no longer imported by production code. It remains only
 * as a reference for the D3→D4 migration. Safe to remove once all D3
 * references in test fixtures are retired.
 *
 * Migration: use ScheduleFact / NormalizedScheduleFacts from
 * NormalizedScheduleFact.ts instead.
 */

import type { WorkMinutes } from "@planner/protocol";

/**
 * Normalized per-task schedule result — engine-neutral.
 *
 * All fields are working-minute offsets from project start,
 * matching the canonical WorkMinutes coordinate space.
 */
export type NormalizedTaskResult = {
  readonly taskId: string;
  readonly earlyStart: WorkMinutes;
  readonly earlyFinish: WorkMinutes;
  readonly lateStart: WorkMinutes;
  readonly lateFinish: WorkMinutes;
  readonly totalFloat: WorkMinutes;
  readonly freeFloat: WorkMinutes;
  readonly isCritical: boolean;
};

/**
 * Normalized schedule result — a map of task results keyed by task ID.
 * Used by ScheduleComparator to diff slot vs temporal outputs.
 */
export type NormalizedScheduleResult = {
  readonly [taskId: string]: NormalizedTaskResult;
};
