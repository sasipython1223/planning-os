import type { BaseCalendarDefinition, CalendarId, Command, PlannerCalendar, WorkerMessage, WorkMinutes } from "@planner/protocol";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as State from "../src/state.js";

type RuntimeScope = {
  postMessage: ReturnType<typeof vi.fn>;
  onmessage?: (event: MessageEvent<Command>) => void;
};

const runtimeScope: RuntimeScope = {
  postMessage: vi.fn(),
};

const toWorkMinutes = (n: number): WorkMinutes => n as WorkMinutes;

vi.mock("../src/wasm/loadCpmWasm.js", () => ({
  loadCpmWasm: vi.fn(async () => undefined),
  getCpmWasm: vi.fn(() => ({
    calculate_schedule: (request: any) => ({
      scheduleVersion: 1,
      results: request.tasks.map((task: any) => ({
        taskId: task.id,
        earlyStartMinutes: toWorkMinutes(0),
        earlyFinishMinutes: toWorkMinutes(Number(task.durationWorkMinutes) || 0),
        lateStartMinutes: toWorkMinutes(0),
        lateFinishMinutes: toWorkMinutes(Number(task.durationWorkMinutes) || 0),
        totalFloatMinutes: toWorkMinutes(0),
        freeFloatMinutes: toWorkMinutes(0),
        isCritical: true,
      })),
    }),
    calculate_schedule_minute: (request: any) => ({
      scheduleVersion: 1,
      results: request.tasks.map((task: any) => ({
        taskId: task.id,
        earlyStartMinutes: toWorkMinutes(0),
        earlyFinishMinutes: toWorkMinutes(Number(task.durationWorkMinutes) || 0),
        lateStartMinutes: toWorkMinutes(0),
        lateFinishMinutes: toWorkMinutes(Number(task.durationWorkMinutes) || 0),
        totalFloatMinutes: toWorkMinutes(0),
        freeFloatMinutes: toWorkMinutes(0),
        isCritical: true,
      })),
    }),
    analyze_float_paths: vi.fn(),
  })),
}));

vi.mock("../src/persistence.js", () => ({
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
    if (hasReady && typeof runtimeScope.onmessage === "function") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Worker did not become ready in time");
};

const dispatch = (cmd: Command): WorkerMessage[] => {
  if (!runtimeScope.onmessage) throw new Error("Worker message handler not initialized");
  const before = runtimeScope.postMessage.mock.calls.length;
  runtimeScope.onmessage({ data: cmd } as MessageEvent<Command>);
  return runtimeScope.postMessage.mock.calls.slice(before).map((entry) => entry[0] as WorkerMessage);
};

const importedDef: BaseCalendarDefinition = {
  id: "imp-cal" as CalendarId,
  name: "Imported",
  sourceCalendarType: "project",
  weeklyPattern: {
    0: [],
    1: [{ startMinute: 480, endMinute: 960 }],
    2: [{ startMinute: 480, endMinute: 960 }],
    3: [{ startMinute: 480, endMinute: 960 }],
    4: [{ startMinute: 480, endMinute: 960 }],
    5: [{ startMinute: 480, endMinute: 960 }],
    6: [],
  },
  exceptions: [],
};

describe("C1A/C1B calendar customization foundation", () => {
  beforeAll(async () => {
    (globalThis as unknown as { self?: unknown }).self = runtimeScope;
    await import("../src/worker.js");
    await waitForWorkerReady();
  });

  beforeEach(() => {
    runtimeScope.postMessage.mockClear();
    State.clearState();
    State.setSourceImportRecord({
      format: "xer",
      summary: {
        taskCount: 0,
        dependencyCount: 0,
        resourceCount: 0,
        assignmentCount: 0,
        calendarInfo: "1 calendar",
      },
      diagnostics: [],
      status: "sourceImportedNotCalculated",
      sourceProjectSettings: {
        sourceProjectId: "P-100",
        defaultCalendarId: "imp-cal",
        defaultCalendarName: "Imported",
      },
      calendarDefinitions: { ["imp-cal" as CalendarId]: importedDef },
      resolvedCalendarDefinitions: { ["imp-cal" as CalendarId]: importedDef },
      importedAt: new Date().toISOString(),
    });
  });

  it("imported calendars are read-only in worker upsert command", () => {
    const calendar: PlannerCalendar = {
      calendarId: "imp-cal" as CalendarId,
      name: "Imported",
      type: "Project",
      source: "imported-readonly",
      isDefaultProjectCalendar: false,
      hoursPerDay: 8,
      hoursPerWeek: 40,
      hoursPerMonth: 160,
      hoursPerYear: 2080,
      weeklyHours: { 0: 0, 1: 8, 2: 8, 3: 8, 4: 8, 5: 8, 6: 0 },
      weeklyWorkPeriods: importedDef.weeklyPattern,
      exceptions: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const out = dispatch({ type: "UPSERT_PLANNER_CALENDAR", v: 1, reqId: "u1", payload: calendar });
    const nack = out.find((m) => m.type === "NACK");
    expect(nack).toBeDefined();
    if (nack?.type === "NACK") {
      expect(nack.error).toContain("read-only");
    }
  });

  it("cloning imported calendar creates editable planner calendar", () => {
    const out = dispatch({ type: "CLONE_IMPORTED_CALENDAR", v: 1, reqId: "clone", sourceCalendarId: "imp-cal" as CalendarId });
    const diff = out.find((m) => m.type === "DIFF_STATE");
    expect(diff).toBeDefined();
    if (diff?.type === "DIFF_STATE") {
      const clones = Object.values(diff.payload.plannerCalendars ?? {}).filter((c) => c.source === "cloned-from-import");
      expect(clones.length).toBeGreaterThan(0);
      expect(clones[0].name).toContain("Clone");
    }
  });

  it("editing a cloned calendar does not mutate imported source metadata", () => {
    const sourceBefore = State.getSourceImportRecord();
    const sourceDefBefore = sourceBefore?.resolvedCalendarDefinitions?.["imp-cal" as CalendarId];
    expect(sourceDefBefore?.name).toBe("Imported");

    const cloneOut = dispatch({ type: "CLONE_IMPORTED_CALENDAR", v: 1, reqId: "clone2", sourceCalendarId: "imp-cal" as CalendarId });
    const cloneDiff = cloneOut.find((m) => m.type === "DIFF_STATE");
    expect(cloneDiff).toBeDefined();
    if (cloneDiff?.type !== "DIFF_STATE") return;

    const cloned = Object.values(cloneDiff.payload.plannerCalendars ?? {}).find((c) => c.source === "cloned-from-import");
    expect(cloned).toBeDefined();
    if (!cloned) return;

    const editedClone: PlannerCalendar = {
      ...cloned,
      name: "Edited Clone",
      hoursPerDay: 9,
      weeklyHours: { ...cloned.weeklyHours, 1: 9, 2: 9, 3: 9, 4: 9, 5: 9 },
    };
    dispatch({ type: "UPSERT_PLANNER_CALENDAR", v: 1, reqId: "editClone", payload: editedClone });

    const sourceAfter = State.getSourceImportRecord();
    const sourceDefAfter = sourceAfter?.resolvedCalendarDefinitions?.["imp-cal" as CalendarId];
    expect(sourceDefAfter).toEqual(sourceDefBefore);
    expect(sourceAfter?.sourceProjectSettings?.defaultCalendarId).toBe("imp-cal");
  });

  it("set project default updates default calendar and assignment storage remains inactive", () => {
    State.addTask({ id: "T1", name: "Task", siblingOrder: "A", durationWorkMinutes: toWorkMinutes(480) });

    const custom: PlannerCalendar = {
      calendarId: "native-cal" as CalendarId,
      name: "Native",
      type: "Project",
      source: "planner-editable",
      isDefaultProjectCalendar: false,
      hoursPerDay: 8,
      hoursPerWeek: 40,
      hoursPerMonth: 160,
      hoursPerYear: 2080,
      weeklyHours: { 0: 0, 1: 8, 2: 8, 3: 8, 4: 8, 5: 8, 6: 0 },
      weeklyWorkPeriods: importedDef.weeklyPattern,
      exceptions: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    dispatch({ type: "UPSERT_PLANNER_CALENDAR", v: 1, reqId: "u2", payload: custom });
    dispatch({ type: "SET_PROJECT_DEFAULT_CALENDAR", v: 1, reqId: "def", calendarId: "native-cal" as CalendarId });
    const out = dispatch({ type: "ASSIGN_CALENDAR_TO_ACTIVITIES", v: 1, reqId: "assign", calendarId: "native-cal" as CalendarId, taskIds: ["T1"] });

    const diff = out.find((m) => m.type === "DIFF_STATE");
    expect(diff).toBeDefined();
    if (diff?.type === "DIFF_STATE") {
      const t1 = diff.payload.tasks.find((t) => t.id === "T1");
      expect(t1?.assignedCalendarId).toBe("native-cal");
      const visible = diff.payload.visibleRows.find((t) => t.id === "T1");
      expect(String(visible?.computationalCalendarId ?? "default")).toBe("default");
      expect(diff.payload.plannerCalendars?.["native-cal"]?.isDefaultProjectCalendar).toBe(true);
      expect(diff.payload.sourceImportRecord?.sourceProjectSettings?.defaultCalendarId).toBe("imp-cal");
    }
  });
});
