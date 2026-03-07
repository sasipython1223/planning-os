/**
 * CPM Kernel Schedule Contract
 *
 * Type definitions for the Worker ↔ CPM Kernel interface.
 * This is a design contract only — WASM integration not yet implemented.
 *
 * Design principles:
 * - Input uses string task IDs (matches runtime Task.id)
 * - Output returns early start/finish times
 * - Output order matches input order (stable indexing)
 * - Errors are structured with type discriminators
 * - v1 supports FS dependencies only
 *
 * See: docs/cpm-kernel-contract.md
 */

/**
 * Minimal task input for scheduling calculation.
 * Only ID and duration are needed — name and metadata stay in Worker state.
 */
export type ScheduleTask = {
  id: string;
  duration: number;
};

/**
 * Finish-to-Start dependency between two tasks.
 * v1 supports only FS — type field omitted until SS/FF/SF added.
 */
export type ScheduleDependency = {
  predId: string;
  succId: string;
};

/**
 * Request payload for CPM schedule calculation.
 */
export type ScheduleRequest = {
  tasks: ScheduleTask[];
  dependencies: ScheduleDependency[];
};

/**
 * Scheduled times for one task.
 * earlyFinish = earlyStart + duration (included for convenience).
 */
export type ScheduleTaskResult = {
  taskId: string;
  earlyStart: number;
  earlyFinish: number;
};

/**
 * Successful schedule calculation result.
 * Results array matches input tasks array order.
 */
export type ScheduleResponse = {
  results: ScheduleTaskResult[];
};

/**
 * Schedule calculation error variants.
 */
export type ScheduleErrorType =
  | "DuplicateTaskId"
  | "SelfDependency"
  | "TaskNotFound"
  | "CycleDetected";

/**
 * Structured error from schedule calculation.
 * taskId is present for task-specific errors (DuplicateTaskId, SelfDependency, TaskNotFound).
 */
export type ScheduleError = {
  type: ScheduleErrorType;
  taskId?: string;
  message: string;
};

/**
 * Union type for schedule calculation result.
 */
export type ScheduleResult = ScheduleResponse | ScheduleError;

/**
 * Type guard to check if result is an error.
 */
export function isScheduleError(result: ScheduleResult): result is ScheduleError {
  return "type" in result && typeof result.type === "string";
}
