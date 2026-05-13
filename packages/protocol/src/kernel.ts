/**
 * CPM Kernel Scheduling Contract (Phase P)
 *
 * Type-only definitions for the Worker ↔ CPM Kernel interface.
 * No runtime code, no WASM integration, no UI logic.
 *
 * Design:
 * - Input uses string task IDs (matches runtime Task.id)
 * - Output returns early/late start/finish, total float, criticality
 * - Supports all four PDM dependency types (FS, SS, FF, SF) with lag
 * - Calendar-aware: nonWorkingDays skip list
 * - Readonly arrays for immutability
 * - Discriminated union for errors
 * - scheduleVersion for future compatibility
 *
 * Phase Y: All schedule time quantities are now WorkMinutes-branded.
 */

import type { WorkMinutes } from "./types.js";

/**
 * ABI version for the Worker ↔ WASM engine boundary.
 * Bump this when ScheduleRequest/ScheduleResponse shape changes.
 * Worker stamps this on every request; WASM rejects mismatches.
 * Boundary-only concern — not part of the domain model.
 */
export const ENGINE_ABI_VERSION = 1;
/**
 * D8 minute-authoritative boundary ABI version.
 *
 * This is introduced on the shadow/preparatory path first.
 * Slot-authoritative execution remains on ENGINE_ABI_VERSION until
 * the full authoritative cutover is completed.
 */
export const ENGINE_ABI_VERSION_V2 = 2;

/**
 * Minimal task input for scheduling calculation.
 */
export type ScheduleTask = {
  readonly id: string;
  readonly durationWorkMinutes: WorkMinutes;
  readonly minEarlyStartMinutes: WorkMinutes;
  readonly parentId?: string;
  readonly isSummary: boolean;
  readonly constraintType?: string;
  readonly constraintDateMinutes?: WorkMinutes | null;
};

/**
 * Dependency type for PDM relationships.
 */
export type KernelDependencyType = "FS" | "SS" | "FF" | "SF";

/**
 * Dependency between two tasks with type and lag.
 */
export type ScheduleDependency = {
  readonly predId: string;
  readonly succId: string;
  readonly depType: KernelDependencyType;
  readonly lagWorkMinutes: WorkMinutes;
};

/**
 * Request payload for CPM schedule calculation.
 */
export type ScheduleRequest = {
  /** ABI version — must match WASM engine's expected version. */
  readonly abiVersion: number;
  readonly tasks: readonly ScheduleTask[];
  readonly dependencies: readonly ScheduleDependency[];
  /** Integer day-offsets that are non-working (e.g. weekends). Kernel skips these. */
  readonly nonWorkingDays: readonly number[];
};

/**
 * Scheduled times for one task.
 */
export type ScheduleTaskResult = {
  readonly taskId: string;
  readonly earlyStartMinutes: WorkMinutes;
  readonly earlyFinishMinutes: WorkMinutes;
  readonly lateStartMinutes: WorkMinutes;
  readonly lateFinishMinutes: WorkMinutes;
  readonly totalFloatMinutes: WorkMinutes;
  readonly isCritical: boolean;
};

/**
 * Successful schedule calculation result.
 */
export type ScheduleResponse = {
  readonly scheduleVersion: number;
  readonly results: readonly ScheduleTaskResult[];
};

/**
 * Duplicate task ID error.
 */
export type DuplicateTaskIdError = {
  readonly type: "DuplicateTaskId";
  readonly taskId: string;
  readonly message: string;
};

/**
 * Self-dependency error (task depends on itself).
 */
export type SelfDependencyError = {
  readonly type: "SelfDependency";
  readonly taskId: string;
  readonly message: string;
};

/**
 * Task not found error (dependency references non-existent task).
 */
export type TaskNotFoundError = {
  readonly type: "TaskNotFound";
  readonly taskId: string;
  readonly message: string;
};

/**
 * Cycle detected error (circular dependency graph).
 */
export type CycleDetectedError = {
  readonly type: "CycleDetected";
  readonly message: string;
};

/**
 * Discriminated union of all schedule errors.
 */
export type ScheduleError =
  | DuplicateTaskIdError
  | SelfDependencyError
  | TaskNotFoundError
  | CycleDetectedError;

/**
 * Union of successful response or error.
 */
export type ScheduleResult = ScheduleResponse | ScheduleError;

/**
 * D8 minute-authoritative calendar boundary.
 *
 * Intervals are absolute-minute half-open ranges [start, end).
 */
export type MinuteCalendarBoundary = {
  readonly id: string;
  readonly intervals: readonly (readonly [number, number])[];
};

/**
 * D8 minute-authoritative task boundary.
 */
export type MinuteScheduleTask = {
  readonly id: string;
  readonly durationMinutes: number;
  readonly minEarlyStartMinutes: number;
  readonly parentId?: string;
  readonly isSummary: boolean;
  readonly calendarId: string;
  readonly constraintType?: string;
  readonly constraintDateMinute?: number | null;
};

/**
 * D8 minute-authoritative dependency boundary.
 */
export type MinuteScheduleDependency = {
  readonly predId: string;
  readonly succId: string;
  readonly depType: KernelDependencyType;
  readonly lagMinutes: number;
  readonly lagCalendarId: string;
};

/**
 * D8 minute-authoritative request boundary.
 */
export type MinuteScheduleRequest = {
  readonly abiVersion: number;
  readonly tasks: readonly MinuteScheduleTask[];
  readonly dependencies: readonly MinuteScheduleDependency[];
  readonly calendars: readonly MinuteCalendarBoundary[];
  readonly projectCalendarId: string;
  readonly dataDateMinute: number;
};

/**
 * D8 minute-authoritative per-task result boundary.
 */
export type MinuteScheduleTaskResult = {
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
 * D8 minute-authoritative response boundary.
 */
export type MinuteScheduleResponse = {
  readonly scheduleVersion: number;
  readonly results: readonly MinuteScheduleTaskResult[];
};

/**
 * AI-FPA.2B: Float Path Analysis MVP-v1 mode.
 */
export type FloatPathMvpMode = "total_float";

/**
 * AI-FPA.2B: Relationship types used by float path reporting.
 */
export type FloatPathMvpRelationshipType = "FS" | "SS" | "FF" | "SF";

/**
 * AI-FPA.2B: Non-fatal warning codes for float path analysis responses.
 */
export type FloatPathMvpWarningCode =
  | "TARGET_NOT_FOUND"
  | "TARGET_UNSCHEDULED"
  | "NO_PATHS_TO_TARGET"
  | "MAX_PATHS_CLAMPED"
  | "SEARCH_CAPPED"
  | "NEAR_CRITICAL_THRESHOLD_CLAMPED";

/**
 * AI-FPA.2B: Warning severity levels.
 */
export type FloatPathMvpWarningSeverity = "info" | "warning";

/**
 * AI-FPA.2B: Request payload for deterministic float path analysis (MVP-v1).
 */
export interface FloatPathMvpRequest {
  analysisVersion: 1;
  scheduleVersion: number;
  targetTaskId: string;
  maxPaths: number;
  nearCriticalThresholdMinutes: number;
  mode: FloatPathMvpMode;
}

/**
 * AI-FPA.2B: Successful float path analysis response (MVP-v1).
 */
export interface FloatPathMvpResponse {
  analysisVersion: 1;
  scheduleVersion: number;
  mode: FloatPathMvpMode;
  target: {
    taskId: string;
    taskName?: string;
    isMilestone?: boolean;
  };
  summary: {
    primaryPathId: string | null;
    returnedPathCount: number;
    requestedPathCount: number;
    nearCriticalPathCount: number;
  };
  paths: FloatPathMvpPath[];
  warnings: FloatPathMvpWarning[];
}

/**
 * AI-FPA.2B: One ranked path in the float path response.
 */
export interface FloatPathMvpPath {
  pathId: string;
  floatPathNumber: number;
  floatPathOrder: number;
  isPrimaryDrivingPath: boolean;
  isNearCritical: boolean;
  pathTotalFloatMinutes: number;
  orderedActivities: FloatPathMvpActivity[];
  orderedRelationships: FloatPathMvpRelationship[];
}

/**
 * AI-FPA.2B: Ordered activity entry within a path.
 */
export interface FloatPathMvpActivity {
  sequence: number;
  taskId: string;
  taskName?: string;
  isDriving: boolean;
  totalFloatMinutes: number;
}

/**
 * AI-FPA.2B: Ordered relationship entry within a path.
 */
export interface FloatPathMvpRelationship {
  sequence: number;
  predTaskId: string;
  succTaskId: string;
  depType: FloatPathMvpRelationshipType;
  lagMinutes: number;
  isDriving: boolean;
}

/**
 * AI-FPA.2B: Warning emitted with a successful response.
 */
export interface FloatPathMvpWarning {
  code: FloatPathMvpWarningCode;
  message: string;
  severity: FloatPathMvpWarningSeverity;
}

/**
 * AI-FPA.2B: Error result for float path analysis request handling.
 */
export interface FloatPathMvpError {
  type:
    | "InvalidRequest"
    | "TargetNotFound"
    | "TargetNotSchedulable"
    | "ComputationFailed";
  message: string;
}

/**
 * Type guard to check if a schedule result is an error.
 */
export function isScheduleError(result: ScheduleResult): result is ScheduleError {
  return "type" in result && typeof result.type === "string";
}
