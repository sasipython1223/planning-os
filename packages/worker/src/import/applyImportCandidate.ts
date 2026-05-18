/**
 * @module applyImportCandidate
 *
 * Extracted helpers for the IMPORT_SCHEDULE commit/rollback path.
 *
 * Separates the state-mutation side effects from the scheduling call so
 * both the apply and rollback steps can be tested without the WASM kernel.
 *
 * Used by the IMPORT_SCHEDULE handler in worker.ts.
 */

import type { BaselineMap } from "protocol";
import type { ScheduleError } from "protocol/kernel";
import * as State from "../state.js";
import type { ImportCandidate } from "./importCandidate.js";

// ─── Pre-commit Capture ─────────────────────────────────────────────

/**
 * Snapshot of the canonical state captured before an import commit.
 * Returned by applyImportCandidateToState and consumed by rollbackImportCandidateState.
 */
export type ImportPreCommitCapture = {
  readonly preImportSnapshot: State.StateSnapshot;
  readonly preImportBaselines: BaselineMap;
  readonly preImportStartDate: string;
};

// ─── Apply ──────────────────────────────────────────────────────────

/**
 * Apply an import candidate to canonical state.
 *
 * Captures the pre-import state for potential rollback, then atomically
 * replaces canonical state with the candidate's mapped entities and applies
 * the candidate's projectStartDate so the scheduling calendar aligns with
 * the imported programme.
 *
 * @returns Pre-import capture; pass to rollbackImportCandidateState on failure.
 */
export function applyImportCandidateToState(
  candidate: Pick<
    ImportCandidate,
    | "mappedTasks"
    | "mappedDependencies"
    | "mappedResources"
    | "mappedAssignments"
    | "projectStartDate"
  >,
): ImportPreCommitCapture {
  const preImportSnapshot = State.createSnapshot();
  const preImportBaselines = { ...State.getBaselineMap() };
  const preImportStartDate = State.getProjectStartDate();

  State.restoreSnapshot({
    tasks: [...(candidate.mappedTasks ?? [])],
    dependencies: [...(candidate.mappedDependencies ?? [])],
    resources: [...(candidate.mappedResources ?? [])],
    assignments: [...(candidate.mappedAssignments ?? [])],
  });
  State.setBaselineMap({}); // Imported project starts with no baseline

  // Apply the imported project start date so the kernel calendar aligns
  if (candidate.projectStartDate) {
    State.setProjectStartDate(candidate.projectStartDate);
  }

  return { preImportSnapshot, preImportBaselines, preImportStartDate };
}

// ─── Rollback ───────────────────────────────────────────────────────

/**
 * Roll back an import commit to the pre-import state.
 *
 * Restores tasks, deps, resources, assignments, baselines, and
 * projectStartDate to the values captured before the import was applied.
 */
export function rollbackImportCandidateState(
  capture: ImportPreCommitCapture,
): void {
  State.restoreSnapshot(capture.preImportSnapshot);
  State.setBaselineMap(capture.preImportBaselines);
  State.setProjectStartDate(capture.preImportStartDate);
}

// ─── Error Reason ───────────────────────────────────────────────────

/**
 * Build the NACK error reason for a failed import commit.
 *
 * Includes the concrete ScheduleError type and message when available,
 * so the caller can distinguish SelfDependency, CycleDetected, etc.
 */
export function buildImportRollbackError(
  scheduleError: ScheduleError | null,
): string {
  const base = "Scheduling failed after import — rolled back";
  return scheduleError
    ? `${base} (${scheduleError.type}: ${scheduleError.message})`
    : base;
}
