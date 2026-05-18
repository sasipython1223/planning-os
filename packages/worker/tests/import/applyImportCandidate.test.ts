/**
 * Import Commit Handler Path Tests — W.4 (applyImportCandidate helpers)
 *
 * Tests the extracted helper functions used by the IMPORT_SCHEDULE handler:
 *   - applyImportCandidateToState: applies candidate data + projectStartDate to State
 *   - rollbackImportCandidateState: restores pre-import state including projectStartDate
 *   - buildImportRollbackError: formats the NACK error reason from ScheduleError
 *
 * These helpers are the exact functions called by the IMPORT_SCHEDULE handler in
 * worker.ts, so testing them proves the handler-level behaviour without needing
 * to exercise dispatchCommand() (which is not exported and requires WASM).
 *
 * Covers:
 *   1. On successful commit: candidate.projectStartDate is applied to canonical state
 *   2. On rollback: previous projectStartDate is restored (alongside tasks/deps/baselines)
 *   3. NACK error reason includes concrete ScheduleError type + message when present
 *   4. NACK error reason falls back to base message when no ScheduleError
 */

import type { Dependency, Task } from "protocol";
import type { ScheduleError } from "protocol/kernel";
import { beforeEach, describe, expect, it } from "vitest";
import * as UndoHistory from "../../src/history.js";
import {
    applyImportCandidateToState,
    buildImportRollbackError,
    rollbackImportCandidateState,
} from "../../src/import/applyImportCandidate.js";
import type { ImportCandidate } from "../../src/import/importCandidate.js";
import * as State from "../../src/state.js";

// ─── Helpers ────────────────────────────────────────────────────────

function buildCandidate(overrides: Partial<ImportCandidate> = {}): ImportCandidate {
  return {
    format: "xer",
    projectName: "Imported Project",
    projectStartDate: "2024-01-01",
    summary: { taskCount: 2, dependencyCount: 1, resourceCount: 0, assignmentCount: 0, calendarInfo: "No calendar data" },
    diagnostics: [],
    diagnosticsSummary: { errors: 0, warnings: 0, infos: 0 },
    canCommit: true,
    rawData: { projects: [], wbs: [], tasks: [], taskPreds: [], resources: [], taskRsrcs: [], calendars: [] },
    mappedTasks: [
      { id: "imp-t1", name: "Task A", duration: 5, depth: 0, isSummary: false },
      { id: "imp-t2", name: "Task B", duration: 3, depth: 0, isSummary: false },
    ],
    mappedDependencies: [
      { id: "imp-d1", predId: "imp-t1", succId: "imp-t2", type: "FS", lag: 0 },
    ],
    mappedResources: [],
    mappedAssignments: [],
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("Import Commit Handler Path — applyImportCandidateToState", () => {
  beforeEach(() => {
    State.clearState();
    UndoHistory.clearHistory();
  });

  it("applies candidate tasks and deps to canonical state", () => {
    // Pre-import: 1 old task
    State.addTask({ id: "old-t1", name: "Old", duration: 3, depth: 0, isSummary: false });
    expect(State.getTasks()).toHaveLength(1);

    const candidate = buildCandidate();
    applyImportCandidateToState(candidate);

    // Post-apply: old state replaced by candidate data
    expect(State.getTasks()).toHaveLength(2);
    expect(State.getTasks()[0].id).toBe("imp-t1");
    expect(State.getDependencies()).toHaveLength(1);
  });

  it("applies candidate.projectStartDate to canonical state", () => {
    // Pre-import start date differs from candidate's
    State.setProjectStartDate("2026-01-01");

    const candidate = buildCandidate({ projectStartDate: "2023-06-01" });
    applyImportCandidateToState(candidate);

    // Handler-path behaviour: projectStartDate updated to match candidate's XER start
    expect(State.getProjectStartDate()).toBe("2023-06-01");
  });

  it("clears baselines on import commit", () => {
    State.setBaselineMap({ "old-t1": { start: 0, finish: 5 } });
    expect(Object.keys(State.getBaselineMap())).toHaveLength(1);

    applyImportCandidateToState(buildCandidate());

    // Imported project starts with no baseline
    expect(Object.keys(State.getBaselineMap())).toHaveLength(0);
  });

  it("returns capture with correct pre-import projectStartDate", () => {
    State.setProjectStartDate("2025-03-15");

    const capture = applyImportCandidateToState(buildCandidate({ projectStartDate: "2020-01-01" }));

    // Capture holds the pre-import date for rollback
    expect(capture.preImportStartDate).toBe("2025-03-15");
  });

  it("returns capture with correct pre-import snapshot", () => {
    State.addTask({ id: "pre-t1", name: "Pre", duration: 2, depth: 0, isSummary: false });

    const capture = applyImportCandidateToState(buildCandidate());

    // Snapshot captured before state was replaced
    expect(capture.preImportSnapshot.tasks).toHaveLength(1);
    expect(capture.preImportSnapshot.tasks[0].id).toBe("pre-t1");
  });
});

describe("Import Commit Handler Path — rollbackImportCandidateState", () => {
  beforeEach(() => {
    State.clearState();
    UndoHistory.clearHistory();
  });

  it("restores pre-import projectStartDate on rollback", () => {
    // Arrange: pre-import date set, candidate has different date
    State.setProjectStartDate("2026-01-01");
    const candidate = buildCandidate({ projectStartDate: "2019-01-01" });

    // Act: apply then rollback (simulating scheduling failure in IMPORT_SCHEDULE handler)
    const capture = applyImportCandidateToState(candidate);
    expect(State.getProjectStartDate()).toBe("2019-01-01"); // Applied
    rollbackImportCandidateState(capture);

    // Assert: rollback restored original projectStartDate
    expect(State.getProjectStartDate()).toBe("2026-01-01");
  });

  it("restores pre-import tasks on rollback", () => {
    State.addTask({ id: "old-t1", name: "Old", duration: 3, depth: 0, isSummary: false });

    const capture = applyImportCandidateToState(buildCandidate());
    expect(State.getTasks()).toHaveLength(2); // Candidate applied

    rollbackImportCandidateState(capture);
    expect(State.getTasks()).toHaveLength(1);
    expect(State.getTasks()[0].id).toBe("old-t1");
  });

  it("restores pre-import dependencies on rollback", () => {
    State.addTask({ id: "A", name: "A", duration: 1, depth: 0, isSummary: false });
    State.addTask({ id: "B", name: "B", duration: 1, depth: 0, isSummary: false });
    State.addDependency({ id: "pre-d1", predId: "A", succId: "B", type: "FS", lag: 0 });

    const capture = applyImportCandidateToState(buildCandidate());
    // Candidate has imp-d1
    expect(State.getDependencies()[0].id).toBe("imp-d1");

    rollbackImportCandidateState(capture);
    // Pre-import dep restored
    expect(State.getDependencies()).toHaveLength(1);
    expect(State.getDependencies()[0].id).toBe("pre-d1");
  });

  it("restores pre-import baselines on rollback", () => {
    State.setBaselineMap({ "old-t1": { start: 0, finish: 5 } });

    const capture = applyImportCandidateToState(buildCandidate());
    expect(Object.keys(State.getBaselineMap())).toHaveLength(0); // Cleared on import

    rollbackImportCandidateState(capture);
    expect(State.getBaselineMap()).toHaveProperty("old-t1");
  });

  it("full round-trip: apply → rollback → state identical to pre-import", () => {
    // Set up pre-import state
    State.setProjectStartDate("2025-07-01");
    State.setBaselineMap({ "pre-t1": { start: 5, finish: 10 } });
    State.addTask({ id: "pre-t1", name: "Pre Task", duration: 5, depth: 0, isSummary: false });
    State.addTask({ id: "pre-t2", name: "Pre Task 2", duration: 3, depth: 0, isSummary: false });
    State.addDependency({ id: "pre-d1", predId: "pre-t1", succId: "pre-t2", type: "SS", lag: 2 });

    // Apply import candidate (simulating IMPORT_SCHEDULE handler before scheduling)
    const candidate = buildCandidate({ projectStartDate: "2010-01-01" });
    const capture = applyImportCandidateToState(candidate);

    // Verify imported state is active
    expect(State.getProjectStartDate()).toBe("2010-01-01");
    expect(State.getTasks()).toHaveLength(2);
    expect(State.getTasks()[0].id).toBe("imp-t1");

    // Rollback (simulating scheduling failure)
    rollbackImportCandidateState(capture);

    // Verify complete restoration
    expect(State.getProjectStartDate()).toBe("2025-07-01");
    expect(State.getTasks()).toHaveLength(2);
    expect(State.getTasks()[0].id).toBe("pre-t1");
    expect(State.getDependencies()).toHaveLength(1);
    expect(State.getDependencies()[0].id).toBe("pre-d1");
    expect(State.getDependencies()[0].type).toBe("SS");
    expect(State.getBaselineMap()).toHaveProperty("pre-t1");
  });
});

describe("Import Commit Handler Path — buildImportRollbackError", () => {
  it("includes error type and message when ScheduleError is present", () => {
    const err: ScheduleError = { type: "SelfDependency", taskId: "T1", message: "pred === succ" };
    const reason = buildImportRollbackError(err);
    expect(reason).toContain("Scheduling failed after import — rolled back");
    expect(reason).toContain("SelfDependency");
    expect(reason).toContain("pred === succ");
  });

  it("formats as '(ErrorType: message)' suffix", () => {
    const err: ScheduleError = { type: "CycleDetected", message: "cycle found" };
    const reason = buildImportRollbackError(err);
    expect(reason).toBe("Scheduling failed after import — rolled back (CycleDetected: cycle found)");
  });

  it("returns base message when no ScheduleError (null)", () => {
    const reason = buildImportRollbackError(null);
    expect(reason).toBe("Scheduling failed after import — rolled back");
  });

  it("includes TaskNotFound variant correctly", () => {
    const err: ScheduleError = { type: "TaskNotFound", taskId: "missing-id", message: "task not in list" };
    const reason = buildImportRollbackError(err);
    expect(reason).toContain("TaskNotFound");
    expect(reason).toContain("task not in list");
  });
});
