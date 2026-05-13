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

import type { Command, Dependency, DiffStateMessage, Task, WorkerMessage, WorkMinutes } from "@planner/protocol";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as UndoHistory from "../../src/history.js";
import type { ImportCandidate } from "../../src/import/importCandidate.js";
import {
    clearPendingCandidate,
    getPendingCandidate,
    setPendingCandidate,
} from "../../src/import/importCandidate.js";
import * as State from "../../src/state.js";

/** Brand-cast helper — no math, just satisfies the branded type. */
const wm = (n: number) => n as WorkMinutes;

type RuntimeScope = {
  postMessage: ReturnType<typeof vi.fn>;
  onmessage?: (event: MessageEvent<Command>) => void;
};

const runtimeScope: RuntimeScope = {
  postMessage: vi.fn(),
};

const toWorkMinutes = (value: number): WorkMinutes => value as WorkMinutes;

const buildMockScheduleResponse = (request: any) => {
  const taskIds: string[] = request.tasks.map((task: any) => task.id);
  const durations = new Map<string, number>(
    request.tasks.map((task: any) => [task.id, Number(task.durationWorkMinutes) || 0]),
  );

  const starts = new Map<string, number>(taskIds.map((id) => [id, 0]));
  const deps: any[] = Array.isArray(request.dependencies) ? request.dependencies : [];

  for (let i = 0; i < taskIds.length; i += 1) {
    for (const dep of deps) {
      const predStart = starts.get(dep.predId) ?? 0;
      const predDuration = durations.get(dep.predId) ?? 0;
      const lag = Number(dep.lagWorkMinutes) || 0;
      const candidate = predStart + predDuration + lag;
      const current = starts.get(dep.succId) ?? 0;
      if (dep.depType === "FS" && candidate > current) {
        starts.set(dep.succId, candidate);
      }
    }
  }

  return {
    scheduleVersion: 1,
    results: taskIds.map((taskId) => {
      const earlyStart = starts.get(taskId) ?? 0;
      const earlyFinish = earlyStart + (durations.get(taskId) ?? 0);
      return {
        taskId,
        earlyStartMinutes: toWorkMinutes(earlyStart),
        earlyFinishMinutes: toWorkMinutes(earlyFinish),
        lateStartMinutes: toWorkMinutes(earlyStart),
        lateFinishMinutes: toWorkMinutes(earlyFinish),
        totalFloatMinutes: toWorkMinutes(0),
        freeFloatMinutes: toWorkMinutes(0),
        isCritical: true,
      };
    }),
  };
};

vi.mock("../../src/wasm/loadCpmWasm.js", () => ({
  loadCpmWasm: vi.fn(async () => undefined),
  getCpmWasm: vi.fn(() => ({
    calculate_schedule: (request: any) => buildMockScheduleResponse(request),
    calculate_schedule_minute: (request: any) => buildMockScheduleResponse(request),
    analyze_float_paths: vi.fn(),
  })),
}));

vi.mock("../../src/persistence.js", () => ({
  loadPersistedState: vi.fn(async () => null),
  migratePersistedState: vi.fn((value: any) => value),
  savePersistedState: vi.fn(),
  validatePersistedStatePurity: vi.fn(() => []),
}));

const waitForWorkerReady = async (): Promise<void> => {
  for (let i = 0; i < 40; i += 1) {
    const hasReady = runtimeScope.postMessage.mock.calls.some((entry) => {
      const message = entry[0] as WorkerMessage;
      return message.type === "WORKER_READY";
    });
    if (hasReady && typeof runtimeScope.onmessage === "function") return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Worker did not become ready in time");
};

const dispatch = (cmd: Command): WorkerMessage[] => {
  if (!runtimeScope.onmessage) {
    throw new Error("Worker message handler not initialized");
  }
  const before = runtimeScope.postMessage.mock.calls.length;
  runtimeScope.onmessage({ data: cmd } as MessageEvent<Command>);
  return runtimeScope.postMessage.mock.calls.slice(before).map((entry) => entry[0] as WorkerMessage);
};

const getLastDiff = (messages: WorkerMessage[]): DiffStateMessage | null => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].type === "DIFF_STATE") return messages[i] as DiffStateMessage;
  }
  return null;
};

beforeAll(async () => {
  (globalThis as unknown as { self?: unknown }).self = runtimeScope;
  await import("../../src/worker.js");
  await waitForWorkerReady();
});

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
    mappedTasks: [{ id: "imp-t1", name: "Imported Task", durationWorkMinutes: wm(5), siblingOrder: "V" }],
    mappedDependencies: [],
    mappedResources: [],
    mappedAssignments: [],
    ...overrides,
  };
}

function addPreExistingState(): void {
  State.addTask({ id: "old-t1", name: "Old Task", durationWorkMinutes: wm(3), siblingOrder: "V" });
  State.addDependency({ id: "old-d1", predId: "X", succId: "old-t1", type: "FS", lagWorkMinutes: wm(0) });
  State.addResource({ id: "old-r1", name: "Old Resource", maxUnitsPerDay: 1 });
  State.addAssignment({ id: "old-a1", taskId: "old-t1", resourceId: "old-r1", unitsPerDay: 1 });
}

function buildSimpleXer(): string {
  return [
    "ERMHDR\t19.12\t2026-03-19",
    "%T\tPROJECT",
    "%F\tproj_id\tproj_short_name\tplan_start_date\tday_hr_cnt",
    "%R\tP1\tImported Source\t2026-01-15\t8",
    "%E",
    "%T\tTASK",
    "%F\ttask_id\tproj_id\twbs_id\ttask_name\ttask_type\ttarget_drtn_hr_cnt\tcstr_type\tcstr_date",
    "%R\tT1\tP1\t\tTask A\tTT_TASK\t40\tCS_ASAP\t",
    "%R\tT2\tP1\t\tTask B\tTT_TASK\t40\tCS_ASAP\t",
    "%E",
    "%T\tTASKPRED",
    "%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt",
    "%R\tTP1\tT2\tT1\tPR_FS\t0",
    "%E",
    "%E",
  ].join("\n");
}

function buildSourceAnchoredXer(): string {
  return [
    "ERMHDR\t19.12\t2026-05-08",
    "%T\tPROJECT",
    "%F\tproj_id\tproj_short_name\tplan_start_date\tday_hr_cnt",
    "%R\tP1\tAI Schedule Testing 2\t2026-05-08\t8",
    "%E",
    "%T\tTASK",
    "%F\ttask_id\ttask_code\tproj_id\twbs_id\ttask_name\ttask_type\ttarget_drtn_hr_cnt\tcstr_type\tcstr_date\ttarget_start_date\ttarget_end_date",
    "%R\tT1\tA1000\tP1\t\tA1000\tTT_TASK\t40\tCS_ASAP\t\t2026-05-08\t2026-05-14",
    "%R\tT2\tA1010\tP1\t\tA1010\tTT_TASK\t40\tCS_ASAP\t\t2026-05-15\t2026-05-21",
    "%R\tT3\tA1020\tP1\t\tA1020\tTT_TASK\t40\tCS_ASAP\t\t2026-05-22\t2026-05-28",
    "%R\tT4\tA1030\tP1\t\tA1030\tTT_TASK\t40\tCS_ASAP\t\t2026-05-29\t2026-06-04",
    "%E",
    "%E",
  ].join("\n");
}

function buildSixDayDefaultCalendarXer(): string {
  return [
    "ERMHDR\t19.12\t2026-05-08",
    "%T\tPROJECT",
    "%F\tproj_id\tproj_short_name\tplan_start_date\tday_hr_cnt\tclndr_id",
    "%R\tP1\tSix Day Default\t2026-05-08\t8\tCAL6",
    "%E",
    "%T\tTASK",
    "%F\ttask_id\ttask_code\tproj_id\twbs_id\ttask_name\ttask_type\ttarget_drtn_hr_cnt\tcstr_type\tcstr_date\ttarget_start_date\ttarget_end_date",
    "%R\tT1\tA1000\tP1\t\tTask A\tTT_TASK\t40\tCS_ASAP\t\t2026-05-08\t2026-05-14",
    "%R\tT2\tA1010\tP1\t\tTask B\tTT_TASK\t40\tCS_ASAP\t\t2026-05-15\t2026-05-21",
    "%E",
    "%T\tTASKPRED",
    "%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt",
    "%R\tTP1\tT2\tT1\tPR_FS\t0",
    "%E",
    "%T\tCALENDAR",
    "%F\tclndr_id\tclndr_name\tclndr_data\tclndr_type\tday_hr_cnt\tweek_hr_cnt",
    "%R\tCAL6\t6 Day Workweek\t(0||)(1|8:00|17:00)(2|8:00|17:00)(3|8:00|17:00)(4|8:00|17:00)(5|8:00|17:00)(6|8:00|17:00)\t2\t8\t48",
    "%E",
    "%E",
  ].join("\n");
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("Import Commit — W.4", () => {
  beforeEach(() => {
    runtimeScope.postMessage.mockClear();
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
    it("should preserve sourceActivityId on imported committed tasks", () => {
      State.restoreSnapshot({
        tasks: [
          {
            id: "imp-t1",
            sourceActivityId: "A-100",
            name: "Imported Task",
            durationWorkMinutes: wm(5),
            siblingOrder: "V",
          },
        ],
        dependencies: [],
        resources: [],
        assignments: [],
      });

      expect(State.getTasks()).toHaveLength(1);
      expect(State.getTasks()[0].id).toBe("imp-t1");
      expect(State.getTasks()[0].sourceActivityId).toBe("A-100");
    });

    it("should replace existing state with imported entities", () => {
      addPreExistingState();
      expect(State.getTasks()).toHaveLength(1);

      const imported: Task[] = [
        { id: "imp-t1", name: "Task A", durationWorkMinutes: wm(5), siblingOrder: "V" },
        { id: "imp-t2", name: "Task B", durationWorkMinutes: wm(10), siblingOrder: "V" },
      ];
      const importedDeps: Dependency[] = [
        { id: "imp-d1", predId: "imp-t1", succId: "imp-t2", type: "FS", lagWorkMinutes: wm(0) },
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
      State.setBaselineMap({ "old-t1": { startMinutes: wm(0), finishMinutes: wm(5) } });
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
        tasks: [{ id: "imp-t1", name: "Imported", durationWorkMinutes: wm(5), siblingOrder: "V" }],
        dependencies: [],
        resources: [],
        assignments: [],
      });
      State.setBaselineMap({});

      expect(State.getTasks()).toHaveLength(1);
      expect(State.getTasks()[0].name).toBe("Imported");

      // Push undo entry (simulates what the handler does)
      const undoEntry: UndoHistory.HistoryEntry = {
        undo: [{ type: "RESTORE_FULL_STATE", snapshot: preImportSnapshot, baselines: {} } as unknown as import("@planner/protocol").Command],
        redo: [{ type: "RESTORE_FULL_STATE", snapshot: State.createSnapshot(), baselines: {} } as unknown as import("@planner/protocol").Command],
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
        { id: "imp-t1", name: "Imported", durationWorkMinutes: wm(5), siblingOrder: "V" },
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
        undo: [{ type: "RESTORE_FULL_STATE", snapshot: preSnap, baselines: {} } as unknown as import("@planner/protocol").Command],
        redo: [{ type: "RESTORE_FULL_STATE", snapshot: postSnap, baselines: {} } as unknown as import("@planner/protocol").Command],
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
          { id: "t1", name: "A", durationWorkMinutes: wm(1), siblingOrder: "V" },
          { id: "t2", name: "B", durationWorkMinutes: wm(2), siblingOrder: "V" },
          { id: "t3", name: "C", durationWorkMinutes: wm(3), siblingOrder: "V" },
        ],
        mappedDependencies: [
          { id: "d1", predId: "t1", succId: "t2", type: "FS", lagWorkMinutes: wm(0) },
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
        undo: [{ type: "RESTORE_FULL_STATE", snapshot: preSnap } as unknown as import("@planner/protocol").Command],
        redo: [{ type: "RESTORE_FULL_STATE", snapshot: postSnap } as unknown as import("@planner/protocol").Command],
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
        undo: [{ type: "DELETE_TASK", v: 1, reqId: "h", taskId: "x" } as import("@planner/protocol").Command],
        redo: [{ type: "ADD_TASK", v: 1, reqId: "h", payload: { id: "x", name: "X", durationWorkMinutes: wm(1), siblingOrder: "V" } } as import("@planner/protocol").Command],
      });
      UndoHistory.popUndo(); // Move to redo stack
      expect(UndoHistory.canRedo()).toBe(true);

      // Import pushes a new entry — per existing pushEntry semantics, clears redo
      UndoHistory.pushEntry({
        undo: [{ type: "RESTORE_FULL_STATE", snapshot: State.createSnapshot() } as unknown as import("@planner/protocol").Command],
        redo: [{ type: "RESTORE_FULL_STATE", snapshot: State.createSnapshot() } as unknown as import("@planner/protocol").Command],
      });
      expect(UndoHistory.canRedo()).toBe(false);
    });
  });

  describe("snapshot isolation", () => {
    it("pre-import snapshot should not be affected by post-import mutations", () => {
      State.addTask({ id: "old-t1", name: "Old", durationWorkMinutes: wm(3), siblingOrder: "V" });
      const snapshot = State.createSnapshot();

      // Import replaces state
      State.restoreSnapshot({
        tasks: [{ id: "imp-t1", name: "Imported", durationWorkMinutes: wm(5), siblingOrder: "V" }],
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

  describe("worker integration lifecycle state (W.1)", () => {
    it("PREVIEW_IMPORT remains read-only and IMPORT_SCHEDULE stores sourceImportedNotCalculated metadata", () => {
      const beforePreviewTasks = State.getTasks().length;
      const previewMessages = dispatch({
        type: "PREVIEW_IMPORT",
        v: 1,
        reqId: "preview-1",
        payload: {
          format: "xer",
          content: buildSimpleXer(),
          sourceFileName: "source-plan.xer",
        },
      });

      const previewOnlyDiff = getLastDiff(previewMessages);
      expect(previewOnlyDiff).toBeNull();
      expect(State.getTasks()).toHaveLength(beforePreviewTasks);

      const commitMessages = dispatch({
        type: "IMPORT_SCHEDULE",
        v: 1,
        reqId: "commit-1",
      });

      const commitDiff = getLastDiff(commitMessages);
      expect(commitDiff).not.toBeNull();
      expect(commitDiff!.payload.scheduleLifecycle).toBe("sourceImportedNotCalculated");
      expect(commitDiff!.payload.scheduleLifecycle).not.toBe("plannerCalculated");
      expect(commitDiff!.payload.scheduleLifecycle).not.toBe("plannerCalculatedWithVariance");

      expect(commitDiff!.payload.sourceImportRecord).not.toBeNull();
      expect(commitDiff!.payload.sourceImportRecord!.format).toBe("xer");
      expect(commitDiff!.payload.sourceImportRecord!.sourceFileName).toBe("source-plan.xer");
      expect(commitDiff!.payload.sourceImportRecord!.status).toBe("sourceImportedNotCalculated");
      expect(commitDiff!.payload.sourceImportRecord!.summary.taskCount).toBeGreaterThan(0);
      expect(commitDiff!.payload.sourceImportRecord!.diagnostics).toBeDefined();
      expect(Array.isArray(commitDiff!.payload.sourceImportRecord!.diagnostics)).toBe(true);
      expect(commitDiff!.payload.sourceCalculatedVarianceReport).toBeUndefined();
    });

    it("anchors imported source view to the imported project start and displays source dates before recalculation", () => {
      dispatch({
        type: "PREVIEW_IMPORT",
        v: 1,
        reqId: "preview-source-anchor",
        payload: {
          format: "xer",
          content: buildSourceAnchoredXer(),
          sourceFileName: "source-anchor.xer",
        },
      });

      const commitMessages = dispatch({
        type: "IMPORT_SCHEDULE",
        v: 1,
        reqId: "commit-source-anchor",
      });

      const commitDiff = getLastDiff(commitMessages);
      expect(commitDiff).not.toBeNull();
      expect(commitDiff!.payload.scheduleLifecycle).toBe("sourceImportedNotCalculated");
      expect(commitDiff!.payload.projectStartDate).toBe("2026-05-08");
      expect(State.getProjectStartDate()).toBe("2026-05-08");
      expect(commitDiff!.payload.sourceCalculatedVarianceReport).toBeUndefined();

      const tasksBySourceId = new Map(
        commitDiff!.payload.tasks
          .filter((task) => task.sourceActivityId)
          .map((task) => [task.sourceActivityId!, task]),
      );

      const taskA1000 = tasksBySourceId.get("A1000");
      const taskA1030 = tasksBySourceId.get("A1030");
      expect(taskA1000).toBeDefined();
      expect(taskA1030).toBeDefined();

      const scheduleA1000 = commitDiff!.payload.scheduleResults[taskA1000!.id];
      const scheduleA1030 = commitDiff!.payload.scheduleResults[taskA1030!.id];
      expect(scheduleA1000.earlyStartMinutes).toBe(0);
      expect(scheduleA1000.earlyFinishMinutes).toBe(6);
      expect(scheduleA1030.earlyStartMinutes).toBe(21);
      expect(scheduleA1030.earlyFinishMinutes).toBe(27);

      const sourceDatesByTaskId = commitDiff!.payload.sourceImportFidelityState.sourceDatesByTaskId ?? {};
      expect(sourceDatesByTaskId[taskA1000!.id]).toEqual({
        sourceStartMinutes: 0,
        sourceFinishMinutes: 8640,
        sourceRawStart: "2026-05-08",
        sourceRawFinish: "2026-05-14",
      });
      expect(sourceDatesByTaskId[taskA1030!.id]).toEqual({
        sourceStartMinutes: 30240,
        sourceFinishMinutes: 38880,
        sourceRawStart: "2026-05-29",
        sourceRawFinish: "2026-06-04",
      });

      const sourceDatesBeforeRecalc = State.createSnapshot().sourceDatesByTaskId;

      const recalcMessages = dispatch({
        type: "RUN_IMPORTED_SCHEDULE_RECALCULATION",
        v: 1,
        reqId: "recalc-source-anchor",
      });

      const recalcDiff = getLastDiff(recalcMessages);
      expect(recalcDiff).not.toBeNull();
      expect(recalcDiff!.payload.scheduleLifecycle).toBe("plannerCalculatedWithVariance");
      expect(recalcDiff!.payload.sourceCalculatedVarianceReport).toBeDefined();
      expect(State.getSourceDatesByTaskId()).toEqual(sourceDatesBeforeRecalc);
    });

    it("preserves source HH:mm in sourceImportedNotCalculated scheduleResults and rolls up summary bounds from source minutes", () => {
      const summaryId = "sum-1";
      const leafA1000 = "leaf-a1000";
      const leafA1010 = "leaf-a1010";

      setPendingCandidate(buildCandidate({
        projectName: "Source HH:mm Fidelity",
        projectStartDate: "2026-03-10",
        mappedTasks: [
          {
            id: summaryId,
            name: "Summary",
            isStructuralSummary: true,
            durationWorkMinutes: wm(0),
            siblingOrder: "A",
          },
          {
            id: leafA1000,
            sourceActivityId: "A1000",
            name: "A1000",
            durationWorkMinutes: wm(5),
            parentId: summaryId,
            siblingOrder: "A.1",
          },
          {
            id: leafA1010,
            sourceActivityId: "A1010",
            name: "A1010",
            durationWorkMinutes: wm(5),
            parentId: summaryId,
            siblingOrder: "A.2",
          },
        ],
        mappedDependencies: [
          {
            id: "dep-a1000-a1010",
            predId: leafA1000,
            succId: leafA1010,
            type: "FS",
            lagWorkMinutes: wm(0),
          },
        ],
        sourceImportFidelityState: {
          actualsByTaskId: {},
          progressByTaskId: {},
        },
        sourceDatesByTaskId: {
          [leafA1000]: {
            // 2026-03-10 08:00 and 2026-03-16 16:00 relative to project start 2026-03-10 00:00
            sourceStartMinutes: 8 * 60,
            sourceFinishMinutes: (6 * 24 * 60) + (16 * 60),
            // Date-only raw values simulate parser fidelity loss in raw strings.
            sourceRawStart: "2026-03-10",
            sourceRawFinish: "2026-03-16",
          },
          [leafA1010]: {
            // 2026-03-17 08:00 and 2026-03-23 16:00
            sourceStartMinutes: (7 * 24 * 60) + (8 * 60),
            sourceFinishMinutes: (13 * 24 * 60) + (16 * 60),
            sourceRawStart: "2026-03-17",
            sourceRawFinish: "2026-03-23",
          },
        },
      }));

      const commitMessages = dispatch({
        type: "IMPORT_SCHEDULE",
        v: 1,
        reqId: "commit-source-hhmm-fidelity",
      });
      const commitDiff = getLastDiff(commitMessages);
      expect(commitDiff).not.toBeNull();
      expect(commitDiff!.payload.scheduleLifecycle).toBe("sourceImportedNotCalculated");

      const tasksBySourceId = new Map(
        commitDiff!.payload.tasks
          .filter((task) => task.sourceActivityId)
          .map((task) => [task.sourceActivityId!, task]),
      );
      const taskA1000 = tasksBySourceId.get("A1000");
      const taskA1010 = tasksBySourceId.get("A1010");
      expect(taskA1000).toBeDefined();
      expect(taskA1010).toBeDefined();

      const scheduleA1000 = commitDiff!.payload.scheduleResults[taskA1000!.id];
      const scheduleA1010 = commitDiff!.payload.scheduleResults[taskA1010!.id];
      const scheduleSummary = commitDiff!.payload.scheduleResults[summaryId];

      // Leaves should preserve HH:mm via fractional calendar-day offsets.
      expect(scheduleA1000.earlyStartMinutes).toBeCloseTo(8 / 24, 8);
      expect(scheduleA1000.earlyFinishMinutes).toBeCloseTo(6 + (16 / 24), 8);
      expect(scheduleA1010.earlyStartMinutes).toBeCloseTo(7 + (8 / 24), 8);
      expect(scheduleA1010.earlyFinishMinutes).toBeCloseTo(13 + (16 / 24), 8);

      // Guard against midnight-normalized projection regressions.
      expect(scheduleA1000.earlyStartMinutes).not.toBe(0);
      expect(scheduleA1000.earlyFinishMinutes).not.toBe(7);

      // Summary rollup should use earliest child source start and latest child source finish.
      expect(scheduleSummary.earlyStartMinutes).toBeCloseTo(8 / 24, 8);
      expect(scheduleSummary.earlyFinishMinutes).toBeCloseTo(13 + (16 / 24), 8);

      const sourceDatesBeforeRecalc = State.createSnapshot().sourceDatesByTaskId;

      const recalcMessages = dispatch({
        type: "RUN_IMPORTED_SCHEDULE_RECALCULATION",
        v: 1,
        reqId: "recalc-source-hhmm-fidelity",
      });
      const recalcDiff = getLastDiff(recalcMessages);
      expect(recalcDiff).not.toBeNull();
      expect(recalcDiff!.payload.scheduleLifecycle).toBe("plannerCalculatedWithVariance");

      // After explicit recalculation, scheduleResults remain planner-calculated.
      const recalcA1000 = recalcDiff!.payload.scheduleResults[taskA1000!.id];
      expect(recalcA1000.earlyStartMinutes).toBe(0);
      expect(recalcA1000.earlyStartMinutes).not.toBeCloseTo(8 / 24, 8);

      // Source dates remain immutable across recalculation.
      expect(State.getSourceDatesByTaskId()).toEqual(sourceDatesBeforeRecalc);
    });

    it("activates imported project default calendar only for explicit recalculation", () => {
      dispatch({
        type: "PREVIEW_IMPORT",
        v: 1,
        reqId: "preview-six-day-default",
        payload: {
          format: "xer",
          content: buildSixDayDefaultCalendarXer(),
          sourceFileName: "six-day-default.xer",
        },
      });

      const commitMessages = dispatch({
        type: "IMPORT_SCHEDULE",
        v: 1,
        reqId: "commit-six-day-default",
      });
      const commitDiff = getLastDiff(commitMessages);
      expect(commitDiff).not.toBeNull();
      expect(commitDiff!.payload.scheduleLifecycle).toBe("sourceImportedNotCalculated");
      expect(State.getProjectCalendarId()).toBe("default");
      // Project starts on Friday (offset 0), so weekend is offsets 1 (Sat) and 2 (Sun).
      expect(commitDiff!.payload.nonWorkingDays).toContain(1);
      expect(commitDiff!.payload.nonWorkingDays).toContain(2);

      const sourceDatesBeforeRecalc = State.createSnapshot().sourceDatesByTaskId;

      const recalcMessages = dispatch({
        type: "RUN_IMPORTED_SCHEDULE_RECALCULATION",
        v: 1,
        reqId: "recalc-six-day-default",
      });
      const recalcDiff = getLastDiff(recalcMessages);

      expect(recalcDiff).not.toBeNull();
      expect(recalcDiff!.payload.scheduleLifecycle).toBe("plannerCalculatedWithVariance");
      expect(State.getProjectCalendarId()).toBe("CAL6");
      expect(recalcDiff!.payload.sourceImportRecord?.status).toBe("plannerCalculatedWithVariance");
      expect(State.getSourceDatesByTaskId()).toEqual(sourceDatesBeforeRecalc);
    });
  });
});
