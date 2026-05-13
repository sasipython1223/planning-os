import type { Command, DiffStateMessage, WorkerMessage, WorkMinutes } from "@planner/protocol";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as UndoHistory from "../src/history.js";
import * as State from "../src/state.js";

type RuntimeScope = {
  postMessage: ReturnType<typeof vi.fn>;
  onmessage?: (event: MessageEvent<Command>) => void;
};

const runtimeScope: RuntimeScope = {
  postMessage: vi.fn(),
};

let scheduleVersionCounter = 1;

const toWorkMinutes = (value: number): WorkMinutes => value as WorkMinutes;

const buildMockScheduleResponse = (request: any) => {
  const taskIds: string[] = request.tasks.map((task: any) => task.id);
  const durations = new Map<string, number>(
    request.tasks.map((task: any) => [task.id, Number(task.durationWorkMinutes) || 0]),
  );

  const starts = new Map<string, number>(taskIds.map((id) => [id, 0]));
  const deps: any[] = Array.isArray(request.dependencies) ? request.dependencies : [];

  // Simple longest-path relaxation for the FS links used in this test.
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
    scheduleVersion: scheduleVersionCounter++,
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

vi.mock("../src/wasm/loadCpmWasm.js", () => ({
  loadCpmWasm: vi.fn(async () => undefined),
  getCpmWasm: vi.fn(() => ({
    calculate_schedule: (request: any) => buildMockScheduleResponse(request),
    calculate_schedule_minute: (request: any) => buildMockScheduleResponse(request),
    analyze_float_paths: vi.fn(),
  })),
}));

vi.mock("../src/persistence.js", () => ({
  loadPersistedState: vi.fn(async () => null),
  migratePersistedState: vi.fn((value: any) => value),
  savePersistedState: vi.fn(),
  validatePersistedStatePurity: vi.fn(() => []),
}));

const asDiffState = (message: WorkerMessage): DiffStateMessage | null =>
  message.type === "DIFF_STATE" ? (message as DiffStateMessage) : null;

const dispatchAndGetDiffState = (cmd: Command): DiffStateMessage => {
  if (!runtimeScope.onmessage) {
    throw new Error("Worker message handler not initialized");
  }
  const before = runtimeScope.postMessage.mock.calls.length;
  runtimeScope.onmessage({ data: cmd } as MessageEvent<Command>);
  const after = runtimeScope.postMessage.mock.calls.slice(before).map((entry) => entry[0] as WorkerMessage);
  const lastDiff = [...after].reverse().map(asDiffState).find((msg): msg is DiffStateMessage => msg !== null);
  if (!lastDiff) {
    throw new Error(`No DIFF_STATE emitted for command ${cmd.type}`);
  }
  return lastDiff;
};

const findDependency = (diff: DiffStateMessage, predId: string, succId: string) =>
  diff.payload.dependencies.find((dep) => dep.predId === predId && dep.succId === succId);

const getTaskStart = (diff: DiffStateMessage, taskId: string): number => {
  const result = diff.payload.scheduleResults[taskId];
  if (!result) throw new Error(`Missing schedule result for ${taskId}`);
  return Number(result.earlyStartMinutes);
};

const expectSchedulePayloadPresent = (diff: DiffStateMessage, taskIds: string[]): void => {
  expect(Object.keys(diff.payload.scheduleResults).length).toBeGreaterThan(0);
  for (const taskId of taskIds) {
    expect(diff.payload.scheduleResults[taskId]).toBeDefined();
  }
};

const addTask = (id: string, duration: number, reqId: string): DiffStateMessage =>
  dispatchAndGetDiffState({
    type: "ADD_TASK",
    v: 1,
    reqId,
    payload: {
      id,
      name: id,
      durationWorkMinutes: toWorkMinutes(duration),
      siblingOrder: id,
    },
  });

const addDependency = (dependencyId: string, predId: string, succId: string, reqId: string): DiffStateMessage =>
  dispatchAndGetDiffState({
    type: "ADD_DEPENDENCY",
    v: 1,
    reqId,
    payload: {
      id: dependencyId,
      predId,
      succId,
      type: "FS",
      lagWorkMinutes: toWorkMinutes(0),
    },
  });

const waitForWorkerReady = async (): Promise<void> => {
  for (let i = 0; i < 40; i += 1) {
    const hasReady = runtimeScope.postMessage.mock.calls.some((entry) => {
      const message = entry[0] as WorkerMessage;
      return message.type === "WORKER_READY";
    });
    if (hasReady && typeof runtimeScope.onmessage === "function") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Worker did not become ready in time");
};

describe("TD-REL.5A-QA-Fix2 — worker delete/undo/redo DIFF_STATE integration", () => {
  beforeAll(async () => {
    (globalThis as unknown as { self?: unknown }).self = runtimeScope;
    await import("../src/worker.js");
    await waitForWorkerReady();
  });

  beforeEach(() => {
    runtimeScope.postMessage.mockClear();
    State.clearState();
    UndoHistory.clearHistory();
    scheduleVersionCounter = 1;
  });

  it("DELETE_DEPENDENCY A->B then UNDO/REDO updates DIFF_STATE dependencies, schedule, and undo/redo flags", () => {
    addTask("A", 5, "t-a");
    addTask("B", 5, "t-b");
    addTask("C", 5, "t-c");
    addTask("D", 5, "t-d");
    addTask("E", 5, "t-e");

    addDependency("dAB", "A", "B", "d-ab");
    addDependency("dBC", "B", "C", "d-bc");
    const initial = addDependency("dDE", "D", "E", "d-de");

    expect(findDependency(initial, "A", "B")).toBeDefined();
    expect(findDependency(initial, "D", "E")).toBeDefined();
    expectSchedulePayloadPresent(initial, ["A", "B", "C", "D", "E"]);

    const afterDelete = dispatchAndGetDiffState({ type: "DELETE_DEPENDENCY", v: 1, reqId: "del-ab", dependencyId: "dAB" });

    expect(findDependency(afterDelete, "A", "B")).toBeUndefined();
    expect(findDependency(afterDelete, "D", "E")).toBeDefined();
    expectSchedulePayloadPresent(afterDelete, ["A", "B", "C", "D", "E"]);
    expect(afterDelete.payload.canUndo).toBe(true);

    const afterUndo = dispatchAndGetDiffState({ type: "UNDO", v: 1, reqId: "undo-del-ab" });

    expect(findDependency(afterUndo, "A", "B")).toBeDefined();
    expect(findDependency(afterUndo, "D", "E")).toBeDefined();
    expectSchedulePayloadPresent(afterUndo, ["A", "B", "C", "D", "E"]);
    expect(afterUndo.payload.canRedo).toBe(true);

    const afterRedo = dispatchAndGetDiffState({ type: "REDO", v: 1, reqId: "redo-del-ab" });

    expect(findDependency(afterRedo, "A", "B")).toBeUndefined();
    expect(findDependency(afterRedo, "D", "E")).toBeDefined();
    expectSchedulePayloadPresent(afterRedo, ["A", "B", "C", "D", "E"]);
  });

  it("DELETE_DEPENDENCY B->C then UNDO/REDO replays direction-variant deletion through DIFF_STATE", () => {
    addTask("A", 5, "t2-a");
    addTask("B", 5, "t2-b");
    addTask("C", 5, "t2-c");
    addTask("D", 5, "t2-d");
    addTask("E", 5, "t2-e");

    addDependency("dAB", "A", "B", "t2-d-ab");
    addDependency("dBC", "B", "C", "t2-d-bc");
    const initial = addDependency("dDE", "D", "E", "t2-d-de");

    expectSchedulePayloadPresent(initial, ["A", "B", "C", "D", "E"]);

    const afterDelete = dispatchAndGetDiffState({ type: "DELETE_DEPENDENCY", v: 1, reqId: "del-bc", dependencyId: "dBC" });

    expect(findDependency(afterDelete, "B", "C")).toBeUndefined();
    expect(findDependency(afterDelete, "D", "E")).toBeDefined();
    expectSchedulePayloadPresent(afterDelete, ["A", "B", "C", "D", "E"]);

    const afterUndo = dispatchAndGetDiffState({ type: "UNDO", v: 1, reqId: "undo-del-bc" });

    expect(findDependency(afterUndo, "B", "C")).toBeDefined();
    expect(findDependency(afterUndo, "D", "E")).toBeDefined();
    expectSchedulePayloadPresent(afterUndo, ["A", "B", "C", "D", "E"]);
    expect(afterUndo.payload.canRedo).toBe(true);

    const afterRedo = dispatchAndGetDiffState({ type: "REDO", v: 1, reqId: "redo-del-bc" });

    expect(findDependency(afterRedo, "B", "C")).toBeUndefined();
    expect(findDependency(afterRedo, "D", "E")).toBeDefined();
    expectSchedulePayloadPresent(afterRedo, ["A", "B", "C", "D", "E"]);
  });
});
