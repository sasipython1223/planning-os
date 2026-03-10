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
 */

/**
 * Minimal task input for scheduling calculation.
 */
export type ScheduleTask = {
  readonly id: string;
  readonly duration: number;
  readonly minEarlyStart: number;
  readonly parentId?: string;
  readonly isSummary: boolean;
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
  readonly lag: number;
};

/**
 * Request payload for CPM schedule calculation.
 */
export type ScheduleRequest = {
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
  readonly earlyStart: number;
  readonly earlyFinish: number;
  readonly lateStart: number;
  readonly lateFinish: number;
  readonly totalFloat: number;
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
 * Type guard to check if a schedule result is an error.
 */
export function isScheduleError(result: ScheduleResult): result is ScheduleError {
  return "type" in result && typeof result.type === "string";
}
