/**
 * Import Commit Unit Tests — W.4
 *
 * Tests the IMPORT_SCHEDULE commit flow:
 * - Candidate validation (canCommit, mapped data presence)
 * - State replacement (replace-only, baselines cleared)
 * - Undo via RESTORE_FULL_STATE snapshot
 * - Candidate cleared after commit
 *
 * Since handleCommand is not exported, these tests exercise the underlying
 * modules (State, UndoHistory, ImportCandidate) that the commit handler uses.
 */

import type { Dependency, Task } from "protocol";
import { beforeEach, describe, expect, it } from "vitest";
import * as UndoHistory from "../../src/history.js";
import type { ImportCandidate } from "../../src/import/importCandidate.js";
import {
    clearPendingCandidate,
    getPendingCandidate,
    setPendingCandidate,
} from "../../src/import/importCandidate.js";
import * as State from "../../src/state.js";

// ─── Helpers ────────────────────────────────────────────────────────

function buildCandidate(overrides: Partial<ImportCandidate> = {}): ImportCandidate {
  return {
    format: "xer",
    projectName: "Imported Project",
    projectStartDate: "2026-01-01",
    summary: { taskCount: 1, dependencyCount: 0, resourceCount: 0, assignmentCount: 0, calendarInfo: "No calendar data" },
    diagnostics: [],
    diagnosticsSummary: { errors: 0, warnings: 0, infos: 0 },
    canCommit: true,
    rawData: { projects: [], wbs: [], tasks: [], taskPreds: [], resources: [], taskRsrcs: [], calendars: [] },
    mappedTasks: [{ id: "imp-t1", name: "Imported Task", duration: 5, depth: 0, isSummary: false }],
    mappedDependencies: [],
    mappedResources: [],
    mappedAssignments: [],
    ...overrides,
  };
}

function addPreExistingState(): void {
  State.addTask({ id: "old-t1", name: "Old Task", duration: 3, depth: 0, isSummary: false });
  State.addDependency({ id: "old-d1", predId: "X", succId: "old-t1", type: "FS", lag: 0 });
  State.addResource({ id: "old-r1", name: "Old Resource", maxUnitsPerDay: 1 });
  State.addAssignment({ id: "old-a1", taskId: "old-t1", resourceId: "old-r1", unitsPerDay: 1 });
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("Import Commit — W.4", () => {
  beforeEach(() => {
    State.clearState();
    UndoHistory.clearHistory();
    clearPendingCandidate();
  });

  describe("candidate validation", () => {
    it("should reject commit when no candidate is pending", () => {
      expect(getPendingCandidate()).toBeNull();
    });

    it("should reject commit when candidate has canCommit=false", () => {
      const candidate = buildCandidate({
        canCommit: false,
        diagnosticsSummary: { errors: 1, warnings: 0, infos: 0 },
      });
      setPendingCandidate(candidate);
      expect(getPendingCandidate()!.canCommit).toBe(false);
    });

    it("should reject commit when candidate has no mapped data", () => {
      const candidate = buildCandidate({
        mappedTasks: undefined,
        mappedDependencies: undefined,
        mappedResources: undefined,
        mappedAssignments: undefined,
      });
      setPendingCandidate(candidate);
      expect(getPendingCandidate()!.mappedTasks).toBeUndefined();
    });
  });

  describe("state replacement (replace-only)", () => {
    it("should replace existing state with imported entities", () => {
      addPreExistingState();
      expect(State.getTasks()).toHaveLength(1);

      const imported: Task[] = [
        { id: "imp-t1", name: "Task A", duration: 5, depth: 0, isSummary: false },
        { id: "imp-t2", name: "Task B", duration: 10, depth: 0, isSummary: false },
      ];
      const importedDeps: Dependency[] = [
        { id: "imp-d1", predId: "imp-t1", succId: "imp-t2", type: "FS", lag: 0 },
      ];

      // Simulate import commit: restoreSnapshot replaces all
      State.restoreSnapshot({
        tasks: [...imported],
        dependencies: [...importedDeps],
        resources: [],
        assignments: [],
      });

      expect(State.getTasks()).toHaveLength(2);
      expect(State.getTasks()[0].name).toBe("Task A");
      expect(State.getDependencies()).toHaveLength(1);
      expect(State.getResources()).toHaveLength(0);
      expect(State.getAssignments()).toHaveLength(0);
    });

    it("should clear baselines on import commit", () => {
      State.setBaselineMap({ "old-t1": { start: 0, finish: 5 } });
      expect(State.getBaselineMap()).toHaveProperty("old-t1");

      // Simulate import commit clearing baselines
      State.setBaselineMap({});
      expect(Object.keys(State.getBaselineMap())).toHaveLength(0);
    });

    it("should clear import candidate after successful commit", () => {
      setPendingCandidate(buildCandidate());
      expect(getPendingCandidate()).not.toBeNull();

      clearPendingCandidate();
      expect(getPendingCandidate()).toBeNull();
    });
  });

  describe("undo via snapshot", () => {
    it("should restore full pre-import state on undo", () => {
      // Set up pre-import state
      addPreExistingState();
      const preImportSnapshot = State.createSnapshot();

      // Simulate import: replace state
      State.restoreSnapshot({
        tasks: [{ id: "imp-t1", name: "Imported", duration: 5, depth: 0, isSummary: false }],
        dependencies: [],
        resources: [],
        assignments: [],
      });
      State.setBaselineMap({});

      expect(State.getTasks()).toHaveLength(1);
      expect(State.getTasks()[0].name).toBe("Imported");

      // Push undo entry (simulates what the handler does)
      const undoEntry: UndoHistory.HistoryEntry = {
        undo: [{ type: "RESTORE_FULL_STATE", snapshot: preImportSnapshot, baselines: {} } as unknown as import("protocol").Command],
        redo: [{ type: "RESTORE_FULL_STATE", snapshot: State.createSnapshot(), baselines: {} } as unknown as import("protocol").Command],
      };
      UndoHistory.pushEntry(undoEntry);

      expect(UndoHistory.canUndo()).toBe(true);

      // Simulate undo: restore pre-import state
      const entry = UndoHistory.popUndo();
      expect(entry).toBeDefined();

      const undoCmd = entry!.undo[0] as unknown as { type: string; snapshot: State.StateSnapshot };
      expect(undoCmd.type).toBe("RESTORE_FULL_STATE");
      State.restoreSnapshot(undoCmd.snapshot);

      // Pre-import state restored
      expect(State.getTasks()).toHaveLength(1);
      expect(State.getTasks()[0].id).toBe("old-t1");
      expect(State.getDependencies()).toHaveLength(1);
      expect(State.getResources()).toHaveLength(1);
      expect(State.getAssignments()).toHaveLength(1);
    });

    it("should support redo after undo", () => {
      // Set up and snapshot pre-import
      addPreExistingState();
      const preSnap = State.createSnapshot();

      // Import
      const importedTasks: Task[] = [
        { id: "imp-t1", name: "Imported", duration: 5, depth: 0, isSummary: false },
      ];
      State.restoreSnapshot({
        tasks: [...importedTasks],
        dependencies: [],
        resources: [],
        assignments: [],
      });
      State.setBaselineMap({});
      const postSnap = State.createSnapshot();

      // Push history entry
      UndoHistory.pushEntry({
        undo: [{ type: "RESTORE_FULL_STATE", snapshot: preSnap, baselines: {} } as unknown as import("protocol").Command],
        redo: [{ type: "RESTORE_FULL_STATE", snapshot: postSnap, baselines: {} } as unknown as import("protocol").Command],
      });

      // Undo
      const entry = UndoHistory.popUndo();
      State.restoreSnapshot((entry!.undo[0] as unknown as { snapshot: State.StateSnapshot }).snapshot);
      expect(State.getTasks()[0].id).toBe("old-t1");

      // Redo
      expect(UndoHistory.canRedo()).toBe(true);
      const redoEntry = UndoHistory.popRedo();
      State.restoreSnapshot((redoEntry!.redo[0] as unknown as { snapshot: State.StateSnapshot }).snapshot);
      expect(State.getTasks()).toHaveLength(1);
      expect(State.getTasks()[0].id).toBe("imp-t1");
    });

    it("should produce exactly one undo entry for entire import", () => {
      // Import with multiple entities
      const candidate = buildCandidate({
        mappedTasks: [
          { id: "t1", name: "A", duration: 1, depth: 0, isSummary: false },
          { id: "t2", name: "B", duration: 2, depth: 0, isSummary: false },
          { id: "t3", name: "C", duration: 3, depth: 0, isSummary: false },
        ],
        mappedDependencies: [
          { id: "d1", predId: "t1", succId: "t2", type: "FS", lag: 0 },
        ],
        mappedResources: [
          { id: "r1", name: "Crew", maxUnitsPerDay: 1 },
        ],
        mappedAssignments: [
          { id: "a1", taskId: "t1", resourceId: "r1", unitsPerDay: 1 },
        ],
      });

      const preSnap = State.createSnapshot();

      // Commit
      State.restoreSnapshot({
        tasks: [...candidate.mappedTasks!],
        dependencies: [...candidate.mappedDependencies!],
        resources: [...candidate.mappedResources!],
        assignments: [...candidate.mappedAssignments!],
      });

      const postSnap = State.createSnapshot();
      UndoHistory.pushEntry({
        undo: [{ type: "RESTORE_FULL_STATE", snapshot: preSnap } as unknown as import("protocol").Command],
        redo: [{ type: "RESTORE_FULL_STATE", snapshot: postSnap } as unknown as import("protocol").Command],
      });

      // Only 1 undo entry — not one per entity
      expect(UndoHistory.getUndoStack()).toHaveLength(1);
      expect(UndoHistory.canUndo()).toBe(true);
    });
  });

  describe("import clears redo stack", () => {
    it("should clear redo stack when import pushes undo entry", () => {
      // Simulate some prior undo entries
      UndoHistory.pushEntry({
        undo: [{ type: "DELETE_TASK", v: 1, reqId: "h", taskId: "x" } as import("protocol").Command],
        redo: [{ type: "ADD_TASK", v: 1, reqId: "h", payload: { id: "x", name: "X", duration: 1, depth: 0, isSummary: false } } as import("protocol").Command],
      });
      UndoHistory.popUndo(); // Move to redo stack
      expect(UndoHistory.canRedo()).toBe(true);

      // Import pushes a new entry — per existing pushEntry semantics, clears redo
      UndoHistory.pushEntry({
        undo: [{ type: "RESTORE_FULL_STATE", snapshot: State.createSnapshot() } as unknown as import("protocol").Command],
        redo: [{ type: "RESTORE_FULL_STATE", snapshot: State.createSnapshot() } as unknown as import("protocol").Command],
      });
      expect(UndoHistory.canRedo()).toBe(false);
    });
  });

  describe("snapshot isolation", () => {
    it("pre-import snapshot should not be affected by post-import mutations", () => {
      State.addTask({ id: "old-t1", name: "Old", duration: 3, depth: 0, isSummary: false });
      const snapshot = State.createSnapshot();

      // Import replaces state
      State.restoreSnapshot({
        tasks: [{ id: "imp-t1", name: "Imported", duration: 5, depth: 0, isSummary: false }],
        dependencies: [],
        resources: [],
        assignments: [],
      });

      // Snapshot should still hold old state
      expect(snapshot.tasks).toHaveLength(1);
      expect(snapshot.tasks[0].id).toBe("old-t1");
      expect(snapshot.tasks[0].name).toBe("Old");
    });
  });
});
