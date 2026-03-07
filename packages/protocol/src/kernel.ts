/**
 * CPM Kernel Scheduling Contract
 *
 * Type-only definitions for the Worker ↔ CPM Kernel interface.
 * No runtime code, no WASM integration, no UI logic.
 *
 * Design:
 * - Input uses string task IDs (matches runtime Task.id)
 * - Output returns early start/finish times
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
};

/**
 * Finish-to-Start dependency between two tasks.
 */
export type ScheduleDependency = {
  readonly predId: string;
  readonly succId: string;
};

/**
 * Request payload for CPM schedule calculation.
 */
export type ScheduleRequest = {
  readonly tasks: readonly ScheduleTask[];
  readonly dependencies: readonly ScheduleDependency[];
};

/**
 * Scheduled times for one task.
 */
export type ScheduleTaskResult = {
  readonly taskId: string;
  readonly earlyStart: number;
  readonly earlyFinish: number;
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
