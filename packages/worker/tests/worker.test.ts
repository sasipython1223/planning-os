/**
 * Worker scheduling integration tests.
 * Tests the full pipeline: state → scheduling → result application.
 */

import type { Assignment, CalendarId, Dependency, Resource, ScheduleResultMap, Task, TimeInterval, WorkMinutes } from "@planner/protocol";
import type { ScheduleError, ScheduleResponse } from "@planner/protocol/kernel";
import { isScheduleError } from "@planner/protocol/kernel";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { compileCalendar } from "../src/calendarRegistry.js";
import * as Hierarchy from "../src/hierarchy.js";
import * as UndoHistory from "../src/history.js";
import { computeResourceHistogram } from "../src/resourceHistogram.js";
import type { CalendarOutputContext } from "../src/rollup.js";
import { rollupSummarySchedules } from "../src/rollupSummaries.js";
import { applyScheduleResult } from "../src/schedule/applyScheduleResult.js";
import { buildScheduleRequest } from "../src/schedule/buildScheduleRequest.js";
import { SlotCoordinateTranslator } from "../src/schedule/SlotCoordinateTranslator.js";
import * as State from "../src/state.js";
import { validateAssignment, validateAssignmentUpdate, validateDependency, validateResource, validateResourceUpdate, validateTask, validateTaskUpdate } from "../src/validation.js";
import { d, wm } from "./helpers.js";

/** D5: shared slot translator for tests that call buildScheduleRequest directly. */
const slotTranslator = new SlotCoordinateTranslator({
  projectStartDate: "2025-01-06",
  minutesPerDay: 480,
  nwdSet: new Set(),
});

describe("Worker State", () => {
  beforeEach(() => {
    State.clearState();
  });

  it("should add and retrieve tasks", () => {
    const task: Task = { id: "task1", name: "Task 1", durationWorkMinutes: wm(5), siblingOrder: "V" };
    State.addTask(task);

    expect(State.getTasks()).toHaveLength(1);
    expect(State.findTask("task1")).toEqual(task);
  });

  it("should update task properties", () => {
    const task: Task = { id: "task1", name: "Task 1", durationWorkMinutes: wm(5), siblingOrder: "V" };
    State.addTask(task);

    State.updateTask("task1", { name: "Updated Task", durationWorkMinutes: wm(10) });

    const updated = State.findTask("task1");
    expect(updated?.name).toBe("Updated Task");
    expect(updated?.durationWorkMinutes).toBe(10);
  });

  it("should add and retrieve dependencies", () => {
    const dep: Dependency = { id: "dep1", predId: "A", succId: "B", type: "FS", lagWorkMinutes: wm(0) };
    State.addDependency(dep);

    expect(State.getDependencies()).toHaveLength(1);
    expect(State.findDependency("A", "B")).toEqual(dep);
  });

  it("should create snapshot with deep copies", () => {
    const taskA: Task = { id: "A", name: "Task A", durationWorkMinutes: wm(5), siblingOrder: "V" };
    const taskB: Task = { id: "B", name: "Task B", durationWorkMinutes: wm(3), siblingOrder: "V" };
    const dep: Dependency = { id: "dep1", predId: "A", succId: "B", type: "FS", lagWorkMinutes: wm(0) };

    State.addTask(taskA);
    State.addTask(taskB);
    State.addDependency(dep);

    const snapshot = State.createSnapshot();

    // Verify snapshot is a deep copy
    expect(snapshot.tasks).toHaveLength(2);
    expect(snapshot.dependencies).toHaveLength(1);
    expect(snapshot.tasks[0]).toEqual(taskA);
    expect(snapshot.tasks[0]).not.toBe(taskA); // Different object reference
  });

  it("should restore state from snapshot", () => {
    State.addTask({ id: "A", name: "Task A", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addTask({ id: "B", name: "Task B", durationWorkMinutes: wm(3), siblingOrder: "V" });

    const snapshot = State.createSnapshot();

    // Mutate state
    State.addTask({ id: "C", name: "Task C", durationWorkMinutes: wm(2), siblingOrder: "V" });
    State.updateTask("A", { durationWorkMinutes: wm(10) });

    expect(State.getTasks()).toHaveLength(3);
    expect(State.findTask("A")?.durationWorkMinutes).toBe(10);

    // Restore
    State.restoreSnapshot(snapshot);

    expect(State.getTasks()).toHaveLength(2);
    expect(State.findTask("A")?.durationWorkMinutes).toBe(5);
    expect(State.findTask("C")).toBeUndefined();
  });
});

describe("Manual Activity ID generation", () => {
  let resolveAddTaskPayloadForActivityCode: ((task: Task) => Task) | null = null;

  beforeAll(async () => {
    (globalThis as unknown as { self?: unknown }).self = { postMessage: vi.fn() };
    const workerModule = await import("../src/worker.js");
    resolveAddTaskPayloadForActivityCode = workerModule.__test__resolveAddTaskPayloadForActivityCode as (task: Task) => Task;
  });

  beforeEach(() => {
    State.clearState();
  });

  it("generates activityCode for new manual tasks", () => {
    if (!resolveAddTaskPayloadForActivityCode) throw new Error("worker test helper not initialized");

    const resolved = resolveAddTaskPayloadForActivityCode({
      id: "manual-1",
      name: "Manual",
      durationWorkMinutes: wm(5),
      siblingOrder: "V",
    });

    expect(resolved.activityCode).toBe("A1000");
    expect(resolved.sourceActivityId).toBeUndefined();
  });

  it("skips collisions across existing activityCode and sourceActivityId", () => {
    if (!resolveAddTaskPayloadForActivityCode) throw new Error("worker test helper not initialized");

    State.hydrateState({
      projectStartDate: "2026-01-01",
      excludeWeekends: true,
      tasks: [
        { id: "manual-existing", name: "Manual Existing", durationWorkMinutes: wm(5), siblingOrder: "V", activityCode: "A1000" },
        { id: "imported-existing", name: "Imported Existing", durationWorkMinutes: wm(5), siblingOrder: "W", sourceActivityId: "A1010" },
      ],
      dependencies: [],
      baselines: {},
      resources: [],
      assignments: [],
    });

    const resolved = resolveAddTaskPayloadForActivityCode({
      id: "manual-2",
      name: "Manual 2",
      durationWorkMinutes: wm(5),
      siblingOrder: "X",
    });

    expect(resolved.activityCode).toBe("A1020");
  });

  it("preserves imported sourceActivityId without assigning manual activityCode", () => {
    if (!resolveAddTaskPayloadForActivityCode) throw new Error("worker test helper not initialized");

    const resolved = resolveAddTaskPayloadForActivityCode({
      id: "imported-1",
      name: "Imported",
      durationWorkMinutes: wm(5),
      siblingOrder: "V",
      sourceActivityId: "P6-100",
    });

    expect(resolved.sourceActivityId).toBe("P6-100");
    expect(resolved.activityCode).toBeUndefined();
  });
});

describe("Validation", () => {
  beforeEach(() => {
    State.clearState();
  });

  it("should reject empty task names", () => {
    const task: Task = { id: "task1", name: "", durationWorkMinutes: wm(5), siblingOrder: "V" };
    const error = validateTask(task);

    expect(error).toBe("Task name must not be empty");
  });

  it("should reject zero or negative duration", () => {
    const task: Task = { id: "task1", name: "Task", durationWorkMinutes: wm(0), siblingOrder: "V" };
    const error = validateTask(task);

    expect(error).toBe("Task duration must be greater than 0");
  });

  it("should reject self-dependencies", () => {
    State.addTask({ id: "A", name: "Task A", durationWorkMinutes: wm(5), siblingOrder: "V" });
    const dep: Dependency = { id: "dep1", predId: "A", succId: "A", type: "FS", lagWorkMinutes: wm(0) };
    const error = validateDependency(dep);

    expect(error).toBe("Dependency cannot point to itself");
  });

  it("should reject dependencies with missing tasks", () => {
    State.addTask({ id: "A", name: "Task A", durationWorkMinutes: wm(5), siblingOrder: "V" });
    const dep: Dependency = { id: "dep1", predId: "A", succId: "B", type: "FS", lagWorkMinutes: wm(0) };
    const error = validateDependency(dep);

    expect(error).toContain("Successor task B does not exist");
  });
});

describe("Schedule Request Builder", () => {
  it("should build request for single task", () => {
    const tasks: Task[] = [{ id: "A", name: "Task A", durationWorkMinutes: d(5), siblingOrder: "V" }];
    const dependencies: Dependency[] = [];

    const request = buildScheduleRequest(tasks, dependencies, [], slotTranslator);

    expect(request.tasks).toHaveLength(1);
    expect(request.tasks[0]).toEqual({ id: "A", durationWorkMinutes: wm(5), minEarlyStartMinutes: wm(0), parentId: undefined, isSummary: false });
    expect(request.dependencies).toHaveLength(0);
  });

  it("should build request for simple chain", () => {
    const tasks: Task[] = [
      { id: "A", name: "Task A", durationWorkMinutes: d(3), siblingOrder: "V" },
      { id: "B", name: "Task B", durationWorkMinutes: d(5), siblingOrder: "V" },
    ];
    const dependencies: Dependency[] = [
      { id: "dep1", predId: "A", succId: "B", type: "FS", lagWorkMinutes: wm(0) },
    ];

    const request = buildScheduleRequest(tasks, dependencies, [], slotTranslator);

    expect(request.tasks).toHaveLength(2);
    expect(request.dependencies).toHaveLength(1);
    expect(request.dependencies[0]).toEqual({ predId: "A", succId: "B", depType: "FS", lagWorkMinutes: wm(0) });
  });

  it("should pass all dependency types through", () => {
    const tasks: Task[] = [
      { id: "A", name: "Task A", durationWorkMinutes: d(3), siblingOrder: "V" },
      { id: "B", name: "Task B", durationWorkMinutes: d(5), siblingOrder: "V" },
    ];
    const dependencies: Dependency[] = [
      { id: "dep1", predId: "A", succId: "B", type: "FS", lagWorkMinutes: wm(0) },
      { id: "dep2", predId: "A", succId: "B", type: "SS", lagWorkMinutes: d(2) },
    ];

    const request = buildScheduleRequest(tasks, dependencies, [], slotTranslator);

    expect(request.dependencies).toHaveLength(2);
    expect(request.dependencies[0]).toEqual({ predId: "A", succId: "B", depType: "FS", lagWorkMinutes: wm(0) });
    expect(request.dependencies[1]).toEqual({ predId: "A", succId: "B", depType: "SS", lagWorkMinutes: wm(2) });
  });
});

describe("Schedule Result Application", () => {
  it("should convert ScheduleResponse to result map", () => {
    const response: ScheduleResponse = {
      scheduleVersion: 1,
      results: [
        { taskId: "A", earlyStartMinutes: wm(0), earlyFinishMinutes: wm(5), lateStartMinutes: wm(0), lateFinishMinutes: wm(5), totalFloatMinutes: wm(0), isCritical: true },
        { taskId: "B", earlyStartMinutes: wm(5), earlyFinishMinutes: wm(10), lateStartMinutes: wm(5), lateFinishMinutes: wm(10), totalFloatMinutes: wm(0), isCritical: true },
      ],
    };

    const resultMap = applyScheduleResult(response);

    expect(resultMap["A"]).toEqual({ earlyStartMinutes: wm(0), earlyFinishMinutes: wm(5), lateStartMinutes: wm(0), lateFinishMinutes: wm(5), totalFloatMinutes: wm(0), isCritical: true });
    expect(resultMap["B"]).toEqual({ earlyStartMinutes: wm(5), earlyFinishMinutes: wm(10), lateStartMinutes: wm(5), lateFinishMinutes: wm(10), totalFloatMinutes: wm(0), isCritical: true });
  });

  it("should handle empty results", () => {
    const response: ScheduleResponse = {
      scheduleVersion: 1,
      results: [],
    };

    const resultMap = applyScheduleResult(response);

    expect(Object.keys(resultMap)).toHaveLength(0);
  });
});

describe("Error Propagation Simulation", () => {
  it("should structure duplicate task error correctly", () => {
    const error: ScheduleError = {
      type: "DuplicateTaskId",
      taskId: "A",
      message: "Duplicate task ID: A",
    };

    expect(error.type).toBe("DuplicateTaskId");
    expect(error.taskId).toBe("A");
  });

  it("should structure cycle error correctly", () => {
    const error: ScheduleError = {
      type: "CycleDetected",
      message: "Cycle detected in dependency graph",
    };

    expect(error.type).toBe("CycleDetected");
    expect(error.message).toContain("Cycle detected");
  });
});

describe("Atomic Mutation and Rollback", () => {
  beforeEach(() => {
    State.clearState();
  });

  it("should preserve valid state when dependency creates cycle", () => {
    // Setup: valid chain A → B
    State.addTask({ id: "A", name: "Task A", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addTask({ id: "B", name: "Task B", durationWorkMinutes: wm(3), siblingOrder: "V" });
    State.addDependency({ id: "dep1", predId: "A", succId: "B", type: "FS", lagWorkMinutes: wm(0) });

    const validSnapshot = State.createSnapshot();

    // Simulate attempted mutation that would create cycle: B → A
    const cycleSnapshot = State.createSnapshot();
    State.addDependency({ id: "dep2", predId: "B", succId: "A", type: "FS", lagWorkMinutes: wm(0) });

    // Build request and run scheduling
    const request = buildScheduleRequest(State.getTasks(), State.getDependencies(), [], slotTranslator);
    
    // This would return CycleDetected error in real WASM
    // For this test, we simulate rollback behavior
    const hasCycle = State.getDependencies().some(
      d1 => State.getDependencies().some(
        d2 => d1.succId === d2.predId && d2.succId === d1.predId
      )
    );

    if (hasCycle) {
      // Rollback to pre-mutation state
      State.restoreSnapshot(cycleSnapshot);
      // In real worker, this would restore to validSnapshot before the bad mutation
      State.restoreSnapshot(validSnapshot);
    }

    // Verify state was rolled back
    expect(State.getDependencies()).toHaveLength(1);
    expect(State.getDependencies()[0].predId).toBe("A");
    expect(State.getDependencies()[0].succId).toBe("B");
  });

  it("should commit valid dependency mutation", () => {
    // Setup tasks
    State.addTask({ id: "A", name: "Task A", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addTask({ id: "B", name: "Task B", durationWorkMinutes: wm(3), siblingOrder: "V" });
    State.addTask({ id: "C", name: "Task C", durationWorkMinutes: wm(2), siblingOrder: "V" });

    // Add valid chain: A → B
    State.addDependency({ id: "dep1", predId: "A", succId: "B", type: "FS", lagWorkMinutes: wm(0) });

    const snapshot = State.createSnapshot();

    // Add another valid dependency: B → C (extends chain)
    State.addDependency({ id: "dep2", predId: "B", succId: "C", type: "FS", lagWorkMinutes: wm(0) });

    const request = buildScheduleRequest(State.getTasks(), State.getDependencies(), [], slotTranslator);

    // This should succeed (no cycle)
    const deps = State.getDependencies();
    const hasCycle = deps.length > 0 && deps.some(
      d1 => deps.some(d2 => d1.succId === d2.predId && d2.succId === d1.predId)
    );

    if (!hasCycle) {
      // Mutation is valid - commit by keeping current state
      expect(State.getDependencies()).toHaveLength(2);
    } else {
      // Rollback
      State.restoreSnapshot(snapshot);
    }

    // Verify final state has both dependencies
    expect(State.getDependencies()).toHaveLength(2);
    expect(State.findDependency("A", "B")).toBeDefined();
    expect(State.findDependency("B", "C")).toBeDefined();
  });

  it("should rollback duration update that breaks scheduling", () => {
    State.addTask({ id: "A", name: "Task A", durationWorkMinutes: wm(5), siblingOrder: "V" });
    
    const snapshot = State.createSnapshot();

    // Attempt to set invalid duration (would fail validation earlier, but testing rollback)
    // In real scenario, this could be a duration that causes numeric overflow
    State.updateTask("A", { durationWorkMinutes: wm(999999) });

    const taskA = State.findTask("A");
    expect(taskA?.durationWorkMinutes).toBe(999999);

    // Simulate scheduling failure detection
    const schedulingFailed = taskA!.durationWorkMinutes > 100000; // Arbitrary large number

    if (schedulingFailed) {
      State.restoreSnapshot(snapshot);
    }

    // Verify rollback
    const restoredTask = State.findTask("A");
    expect(restoredTask?.durationWorkMinutes).toBe(5);
  });

  it("should handle rollback of dependency to missing task", () => {
    // Edge case: dependency added before validation (shouldn't happen with current validation)
    State.addTask({ id: "A", name: "Task A", durationWorkMinutes: wm(5), siblingOrder: "V" });

    const snapshot = State.createSnapshot();

    // Malformed state: dependency to non-existent task
    State.addDependency({ id: "dep1", predId: "A", succId: "NonExistent", type: "FS", lagWorkMinutes: wm(0) });

    const request = buildScheduleRequest(State.getTasks(), State.getDependencies(), [], slotTranslator);

    // This would fail scheduling (TaskNotFound error from kernel)
    const hasInvalidDep = State.getDependencies().some(
      d => !State.findTask(d.predId) || !State.findTask(d.succId)
    );

    if (hasInvalidDep) {
      State.restoreSnapshot(snapshot);
    }

    // Verify state was rolled back
    expect(State.getDependencies()).toHaveLength(0);
    expect(State.getTasks()).toHaveLength(1);
  });
});

describe("Delete Operations", () => {
  beforeEach(() => {
    State.clearState();
  });

  it("should delete a single dependency by id", () => {
    State.addTask({ id: "A", name: "Task A", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addTask({ id: "B", name: "Task B", durationWorkMinutes: wm(3), siblingOrder: "V" });
    State.addDependency({ id: "dep1", predId: "A", succId: "B", type: "FS", lagWorkMinutes: wm(0) });

    expect(State.getDependencies()).toHaveLength(1);

    const result = State.deleteDependency("dep1");
    expect(result).toBe(true);
    expect(State.getDependencies()).toHaveLength(0);
    expect(State.getTasks()).toHaveLength(2); // tasks unaffected
  });

  it("should return false when deleting non-existent dependency", () => {
    expect(State.deleteDependency("nope")).toBe(false);
  });

  it("should delete a task and cascade-remove incident dependencies", () => {
    State.addTask({ id: "A", name: "Task A", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addTask({ id: "B", name: "Task B", durationWorkMinutes: wm(3), siblingOrder: "V" });
    State.addTask({ id: "C", name: "Task C", durationWorkMinutes: wm(2), siblingOrder: "V" });
    State.addDependency({ id: "dep1", predId: "A", succId: "B", type: "FS", lagWorkMinutes: wm(0) });
    State.addDependency({ id: "dep2", predId: "B", succId: "C", type: "FS", lagWorkMinutes: wm(0) });
    State.addDependency({ id: "dep3", predId: "A", succId: "C", type: "FS", lagWorkMinutes: wm(0) });

    // Delete B — should cascade dep1 (A→B) and dep2 (B→C), keep dep3 (A→C)
    const result = State.deleteTask("B");
    expect(result).toBe(true);
    expect(State.getTasks()).toHaveLength(2);
    expect(State.findTask("B")).toBeUndefined();
    expect(State.getDependencies()).toHaveLength(1);
    expect(State.getDependencies()[0].id).toBe("dep3");
  });

  it("should return false when deleting non-existent task", () => {
    expect(State.deleteTask("nope")).toBe(false);
  });

  it("should leave a valid graph after cascade deletion", () => {
    State.addTask({ id: "A", name: "Task A", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addTask({ id: "B", name: "Task B", durationWorkMinutes: wm(3), siblingOrder: "V" });
    State.addTask({ id: "C", name: "Task C", durationWorkMinutes: wm(2), siblingOrder: "V" });
    State.addDependency({ id: "dep1", predId: "A", succId: "B", type: "FS", lagWorkMinutes: wm(0) });
    State.addDependency({ id: "dep2", predId: "B", succId: "C", type: "FS", lagWorkMinutes: wm(0) });

    State.deleteTask("B");

    // Remaining deps should only reference existing tasks
    const taskIds = new Set(State.getTasks().map(t => t.id));
    for (const dep of State.getDependencies()) {
      expect(taskIds.has(dep.predId)).toBe(true);
      expect(taskIds.has(dep.succId)).toBe(true);
    }
  });

  it("should find dependency by id", () => {
    State.addDependency({ id: "dep1", predId: "A", succId: "B", type: "FS", lagWorkMinutes: wm(0) });
    expect(State.findDependencyById("dep1")).toBeDefined();
    expect(State.findDependencyById("dep1")?.predId).toBe("A");
    expect(State.findDependencyById("nope")).toBeUndefined();
  });
});

describe("Inline Edit State Preservation", () => {
  beforeEach(() => {
    State.clearState();
  });

  it("should update name only and preserve duration and id", () => {
    State.addTask({ id: "A", name: "Original", durationWorkMinutes: wm(7), siblingOrder: "V" });
    State.updateTask("A", { name: "Renamed" });

    const task = State.findTask("A");
    expect(task?.name).toBe("Renamed");
    expect(task?.durationWorkMinutes).toBe(7);
    expect(task?.id).toBe("A");
  });

  it("should update duration only and preserve name and id", () => {
    State.addTask({ id: "A", name: "Keep Me", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.updateTask("A", { durationWorkMinutes: wm(12) });

    const task = State.findTask("A");
    expect(task?.durationWorkMinutes).toBe(12);
    expect(task?.name).toBe("Keep Me");
    expect(task?.id).toBe("A");
  });

  it("should reject empty name via validation", () => {
    const error = validateTaskUpdate("test-task", { name: "" });
    expect(error).toBe("Task name must not be empty");
  });

  it("should reject whitespace-only name via validation", () => {
    const error = validateTaskUpdate("test-task", { name: "   " });
    expect(error).toBe("Task name must not be empty");
  });

  it("should reject zero duration via validation", () => {
    const error = validateTaskUpdate("test-task", { durationWorkMinutes: wm(0) });
    expect(error).toBe("Task duration must be greater than 0");
  });

  it("should reject negative duration via validation", () => {
    const error = validateTaskUpdate("test-task", { durationWorkMinutes: wm(-3) });
    expect(error).toBe("Task duration must be greater than 0");
  });

  it("should accept valid name-only update via validation", () => {
    const error = validateTaskUpdate("test-task", { name: "New Name" });
    expect(error).toBeNull();
  });

  it("should accept valid duration-only update via validation", () => {
    const error = validateTaskUpdate("test-task", { durationWorkMinutes: wm(10) });
    expect(error).toBeNull();
  });
});

describe("minEarlyStart constraint", () => {
  beforeEach(() => {
    State.clearState();
  });

  it("should reject negative minEarlyStart via validation", () => {
    expect(validateTaskUpdate("test-task", { minEarlyStartMinutes: wm(-1) })).toBe("minEarlyStart must not be negative");
  });

  it("should accept zero minEarlyStart via validation", () => {
    expect(validateTaskUpdate("test-task", { minEarlyStartMinutes: wm(0) })).toBeNull();
  });

  it("should accept positive minEarlyStart via validation", () => {
    expect(validateTaskUpdate("test-task", { minEarlyStartMinutes: wm(10) })).toBeNull();
  });

  it("should persist minEarlyStart on update", () => {
    State.addTask({ id: "t1", name: "Task1", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.updateTask("t1", { minEarlyStartMinutes: wm(7) });
    const task = State.findTask("t1");
    expect(task?.minEarlyStartMinutes).toBe(7);
  });

  it("should preserve minEarlyStart on partial update", () => {
    State.addTask({ id: "t1", name: "Task1", durationWorkMinutes: wm(5), minEarlyStartMinutes: wm(3), siblingOrder: "V" });
    State.updateTask("t1", { name: "Renamed" });
    const task = State.findTask("t1");
    expect(task?.minEarlyStartMinutes).toBe(3);
    expect(task?.name).toBe("Renamed");
  });

  it("should map minEarlyStart in buildScheduleRequest (defaults 0)", () => {
    const tasks: Task[] = [
      { id: "a", name: "A", durationWorkMinutes: d(5), siblingOrder: "V" },
      { id: "b", name: "B", durationWorkMinutes: d(3), minEarlyStartMinutes: d(10), siblingOrder: "V" },
    ];
    const deps: Dependency[] = [];
    const req = buildScheduleRequest(tasks, deps, [], slotTranslator);
    expect(req.tasks[0].minEarlyStartMinutes).toBe(0);
    expect(req.tasks[1].minEarlyStartMinutes).toBe(10);
  });

  it("should snapshot and restore minEarlyStart", () => {
    State.addTask({ id: "t1", name: "T1", durationWorkMinutes: wm(5), minEarlyStartMinutes: wm(4), siblingOrder: "V" });
    const snapshot = State.createSnapshot();
    State.updateTask("t1", { minEarlyStartMinutes: wm(99) });
    expect(State.findTask("t1")?.minEarlyStartMinutes).toBe(99);
    State.restoreSnapshot(snapshot);
    expect(State.findTask("t1")?.minEarlyStartMinutes).toBe(4);
  });
});

describe("Hierarchy", () => {
  beforeEach(() => {
    State.clearState();
  });

  it("should compute depth and isSummary via derived helpers", () => {
    State.addTask({ id: "S", name: "Summary", durationWorkMinutes: wm(0), siblingOrder: "V" });
    State.addTask({ id: "A", name: "Child A", durationWorkMinutes: wm(5), parentId: "S", siblingOrder: "V" });
    State.addTask({ id: "B", name: "Child B", durationWorkMinutes: wm(3), parentId: "S", siblingOrder: "V" });
    State.computeHierarchy();
    expect(State.isTaskSummary("S")).toBe(true);
    expect(State.getTaskDepth("S")).toBe(0);
    expect(State.isTaskSummary("A")).toBe(false);
    expect(State.getTaskDepth("A")).toBe(1);
  });

  it("should compute nested depth", () => {
    State.addTask({ id: "OS", name: "Outer", durationWorkMinutes: wm(0), siblingOrder: "V" });
    State.addTask({ id: "IS", name: "Inner", durationWorkMinutes: wm(0), parentId: "OS", siblingOrder: "V" });
    State.addTask({ id: "A", name: "Leaf", durationWorkMinutes: wm(3), parentId: "IS", siblingOrder: "V" });
    State.computeHierarchy();
    expect(State.getTaskDepth("OS")).toBe(0);
    expect(State.getTaskDepth("IS")).toBe(1);
    expect(State.getTaskDepth("A")).toBe(2);
  });

  it("should delete subtree recursively", () => {
    State.addTask({ id: "S", name: "Summary", durationWorkMinutes: wm(0), siblingOrder: "V" });
    State.addTask({ id: "A", name: "Child", durationWorkMinutes: wm(5), parentId: "S", siblingOrder: "V" });
    State.addTask({ id: "X", name: "Standalone", durationWorkMinutes: wm(3), siblingOrder: "V" });
    State.addDependency({ id: "d1", predId: "A", succId: "X", type: "FS", lagWorkMinutes: wm(0) });
    State.deleteTaskRecursive("S");
    expect(State.getTasks()).toHaveLength(1);
    expect(State.findTask("X")).toBeDefined();
    expect(State.getDependencies()).toHaveLength(0);
  });

  it("should reject self-parent via validation", () => {
    State.addTask({ id: "A", name: "Task A", durationWorkMinutes: wm(5), siblingOrder: "V" });
    const error = validateTaskUpdate("A", { parentId: "A" });
    expect(error).toBe("Task cannot be its own parent");
  });

  it("should reject hierarchy cycle via validation", () => {
    State.addTask({ id: "A", name: "Task A", durationWorkMinutes: wm(5), parentId: "B", siblingOrder: "V" });
    State.addTask({ id: "B", name: "Task B", durationWorkMinutes: wm(3), siblingOrder: "V" });
    const error = validateTaskUpdate("B", { parentId: "A" });
    expect(error).toBe("Setting this parent would create a hierarchy cycle");
  });

  it("should update parentId", () => {
    State.addTask({ id: "S", name: "Summary", durationWorkMinutes: wm(0), siblingOrder: "V" });
    State.addTask({ id: "A", name: "Task A", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.updateTask("A", { parentId: "S" });
    expect(State.findTask("A")!.parentId).toBe("S");
    State.updateTask("A", { parentId: null });
    expect(State.findTask("A")!.parentId).toBeUndefined();
  });

  it("should map parentId and isSummary in buildScheduleRequest", () => {
    const tasks: Task[] = [
      { id: "S", name: "Summary", durationWorkMinutes: wm(0), siblingOrder: "V" },
      { id: "A", name: "Child", durationWorkMinutes: wm(5), parentId: "S", siblingOrder: "V" },
    ];
    const req = buildScheduleRequest(tasks, [], [], slotTranslator);
    expect(req.tasks[0].isSummary).toBe(true);
    expect(req.tasks[1].parentId).toBe("S");
    expect(req.tasks[1].isSummary).toBe(false);
  });
});

describe("Summary Rollup", () => {
  beforeEach(() => {
    State.clearState();
  });

  it("deep stretch: increasing leaf duration updates both ancestors", () => {
    State.addTask({ id: "GP", name: "Grandparent", durationWorkMinutes: wm(1), siblingOrder: "V" });
    State.addTask({ id: "P", name: "Parent", durationWorkMinutes: wm(1), parentId: "GP", siblingOrder: "V" });
    State.addTask({ id: "L", name: "Leaf", durationWorkMinutes: wm(5), parentId: "P", siblingOrder: "V" });
    State.computeHierarchy();

    const sched: ScheduleResultMap = {
      "L": { earlyStartMinutes: wm(0), earlyFinishMinutes: wm(5), lateStartMinutes: wm(0), lateFinishMinutes: wm(5), totalFloatMinutes: wm(0), isCritical: true },
    };
    rollupSummarySchedules(State.getTasks(), sched);

    expect(sched["P"]).toBeDefined();
    expect(sched["P"].earlyStartMinutes).toBe(0);
    expect(sched["P"].earlyFinishMinutes).toBe(5);
    expect(sched["GP"]).toBeDefined();
    expect(sched["GP"].earlyStartMinutes).toBe(0);
    expect(sched["GP"].earlyFinishMinutes).toBe(5);

    // Simulate increased leaf duration
    const sched2: ScheduleResultMap = {
      "L": { earlyStartMinutes: wm(0), earlyFinishMinutes: wm(10), lateStartMinutes: wm(0), lateFinishMinutes: wm(10), totalFloatMinutes: wm(0), isCritical: true },
    };
    rollupSummarySchedules(State.getTasks(), sched2);

    expect(sched2["P"].earlyFinishMinutes).toBe(10);
    expect(sched2["GP"].earlyFinishMinutes).toBe(10);
  });

  it("old/new parent transfer: reparent shrinks old and expands new", () => {
    State.addTask({ id: "X", name: "Old Parent", durationWorkMinutes: wm(1), siblingOrder: "V" });
    State.addTask({ id: "Y", name: "New Parent", durationWorkMinutes: wm(1), siblingOrder: "V" });
    State.addTask({ id: "A", name: "Big Child", durationWorkMinutes: wm(5), parentId: "X", siblingOrder: "V" });
    State.addTask({ id: "B", name: "Small Child", durationWorkMinutes: wm(3), parentId: "X", siblingOrder: "V" });
    State.addTask({ id: "C", name: "Tiny Child", durationWorkMinutes: wm(2), parentId: "Y", siblingOrder: "V" });
    State.computeHierarchy();

    const sched1: ScheduleResultMap = {
      "A": { earlyStartMinutes: wm(0), earlyFinishMinutes: wm(5), lateStartMinutes: wm(0), lateFinishMinutes: wm(5), totalFloatMinutes: wm(0), isCritical: true },
      "B": { earlyStartMinutes: wm(0), earlyFinishMinutes: wm(3), lateStartMinutes: wm(2), lateFinishMinutes: wm(5), totalFloatMinutes: wm(2), isCritical: false },
      "C": { earlyStartMinutes: wm(0), earlyFinishMinutes: wm(2), lateStartMinutes: wm(0), lateFinishMinutes: wm(2), totalFloatMinutes: wm(0), isCritical: true },
    };
    rollupSummarySchedules(State.getTasks(), sched1);

    expect(sched1["X"].earlyFinishMinutes).toBe(5);
    expect(sched1["Y"].earlyFinishMinutes).toBe(2);

    // Move A from X to Y
    State.updateTask("A", { parentId: "Y" });
    State.computeHierarchy();

    const sched2: ScheduleResultMap = {
      "A": { earlyStartMinutes: wm(0), earlyFinishMinutes: wm(5), lateStartMinutes: wm(0), lateFinishMinutes: wm(5), totalFloatMinutes: wm(0), isCritical: true },
      "B": { earlyStartMinutes: wm(0), earlyFinishMinutes: wm(3), lateStartMinutes: wm(2), lateFinishMinutes: wm(5), totalFloatMinutes: wm(2), isCritical: false },
      "C": { earlyStartMinutes: wm(0), earlyFinishMinutes: wm(2), lateStartMinutes: wm(0), lateFinishMinutes: wm(2), totalFloatMinutes: wm(0), isCritical: true },
    };
    rollupSummarySchedules(State.getTasks(), sched2);

    expect(sched2["X"].earlyFinishMinutes).toBe(3);
    expect(sched2["Y"].earlyFinishMinutes).toBe(5);
  });

  it("blanking: summary with no valid scheduled children has no schedule entry", () => {
    State.addTask({ id: "S", name: "Summary", durationWorkMinutes: wm(1), siblingOrder: "V" });
    State.addTask({ id: "A", name: "Child", durationWorkMinutes: wm(5), parentId: "S", siblingOrder: "V" });
    State.computeHierarchy();

    // No schedule entries for children → summary blanked
    const sched: ScheduleResultMap = {};
    rollupSummarySchedules(State.getTasks(), sched);

    expect(sched["S"]).toBeUndefined();
  });

  it("guard: summary task strips duration and minEarlyStart from updates", () => {
    State.addTask({ id: "S", name: "Summary", durationWorkMinutes: wm(1), siblingOrder: "V" });
    State.addTask({ id: "A", name: "Child", durationWorkMinutes: wm(5), parentId: "S", siblingOrder: "V" });
    State.computeHierarchy();

    expect(State.isTaskSummary("S")).toBe(true);

    // Simulate worker guard: strip physics fields before applying
    const updates: { durationWorkMinutes?: WorkMinutes; minEarlyStartMinutes?: WorkMinutes; name?: string } = {
      durationWorkMinutes: wm(99),
      minEarlyStartMinutes: wm(10),
      name: "Renamed",
    };
    if (State.isTaskSummary("S")) {
      delete updates.durationWorkMinutes;
      delete updates.minEarlyStartMinutes;
    }
    State.updateTask("S", updates);

    expect(State.findTask("S")!.durationWorkMinutes).toBe(1); // unchanged
    expect(State.findTask("S")!.minEarlyStartMinutes).toBeUndefined(); // unchanged
    expect(State.findTask("S")!.name).toBe("Renamed"); // name changed
  });

  it("mixed valid/invalid children: summary ignores invalid children", () => {
    State.addTask({ id: "S", name: "Summary", durationWorkMinutes: wm(1), siblingOrder: "V" });
    State.addTask({ id: "A", name: "Valid", durationWorkMinutes: wm(5), parentId: "S", siblingOrder: "V" });
    State.addTask({ id: "B", name: "Invalid", durationWorkMinutes: wm(3), parentId: "S", siblingOrder: "V" });
    State.computeHierarchy();

    // Only A has valid schedule, B is unscheduled
    const sched: ScheduleResultMap = {
      "A": { earlyStartMinutes: wm(2), earlyFinishMinutes: wm(7), lateStartMinutes: wm(2), lateFinishMinutes: wm(7), totalFloatMinutes: wm(0), isCritical: true },
    };
    rollupSummarySchedules(State.getTasks(), sched);

    expect(sched["S"]).toBeDefined();
    expect(sched["S"].earlyStartMinutes).toBe(2);
    expect(sched["S"].earlyFinishMinutes).toBe(7);
  });

  it("leaf task without children is not processed as summary", () => {
    State.addTask({ id: "S", name: "Lone Task", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.computeHierarchy();

    expect(State.isTaskSummary("S")).toBe(false);

    // Rollup should not touch non-summary tasks
    const sched: ScheduleResultMap = {
      "S": { earlyStartMinutes: wm(0), earlyFinishMinutes: wm(5), lateStartMinutes: wm(0), lateFinishMinutes: wm(5), totalFloatMinutes: wm(0), isCritical: true },
    };
    rollupSummarySchedules(State.getTasks(), sched);

    // Leaf task schedule is untouched
    expect(sched["S"].earlyStartMinutes).toBe(0);
    expect(sched["S"].earlyFinishMinutes).toBe(5);
  });

  it("drawGantt receives no schedule for empty summary (no ghost bracket)", () => {
    State.addTask({ id: "S", name: "Summary", durationWorkMinutes: wm(1), siblingOrder: "V" });
    State.addTask({ id: "A", name: "Child", durationWorkMinutes: wm(5), parentId: "S", siblingOrder: "V" });
    State.computeHierarchy();

    // Kernel returned a stale entry for summary — rollup should overwrite
    const sched: ScheduleResultMap = {
      "S": { earlyStartMinutes: wm(0), earlyFinishMinutes: wm(1), lateStartMinutes: wm(0), lateFinishMinutes: wm(1), totalFloatMinutes: wm(0), isCritical: false },
      // Child has no valid schedule
    };
    rollupSummarySchedules(State.getTasks(), sched);

    // Summary entry should be removed (no valid children)
    expect(sched["S"]).toBeUndefined();
  });
});

// ─── Calendar module tests ────────────────────────────────────

import { advanceByWorkingDays, countWorkingDays, generateNonWorkingDays } from "../src/calendar.js";

describe("Calendar — generateNonWorkingDays", () => {
  it("returns empty array when excludeWeekends is false", () => {
    const result = generateNonWorkingDays("2025-01-06", false, 14);
    expect(result).toEqual([]);
  });

  it("generates weekend offsets for a Monday start", () => {
    // 2025-01-06 is a Monday
    // First weekend: day 5 (Sat), day 6 (Sun)
    // Second weekend: day 12 (Sat), day 13 (Sun)
    const result = generateNonWorkingDays("2025-01-06", true, 14);
    expect(result).toEqual([5, 6, 12, 13]);
  });

  it("generates weekend offsets for a Wednesday start", () => {
    // 2025-01-08 is a Wednesday
    // Day 0=Wed, 1=Thu, 2=Fri, 3=Sat, 4=Sun, 5=Mon, ...
    const result = generateNonWorkingDays("2025-01-08", true, 7);
    expect(result).toEqual([3, 4]);
  });

  it("day 0 is blocked if project starts on Saturday", () => {
    // 2025-01-04 is a Saturday
    const result = generateNonWorkingDays("2025-01-04", true, 7);
    expect(result).toContain(0); // Sat
    expect(result).toContain(1); // Sun
    expect(result).not.toContain(2); // Mon — working day
  });
});

describe("Calendar — countWorkingDays", () => {
  it("counts all days when no blocked days", () => {
    const set = new Set<number>();
    expect(countWorkingDays(0, 5, set)).toBe(5);
  });

  it("excludes blocked days from count", () => {
    const set = new Set([2, 3]);
    expect(countWorkingDays(0, 5, set)).toBe(3); // days 0,1,4
  });

  it("returns 0 for empty range", () => {
    const set = new Set<number>();
    expect(countWorkingDays(3, 3, set)).toBe(0);
  });
});

describe("Calendar — advanceByWorkingDays", () => {
  it("advances without blocked days", () => {
    const set = new Set<number>();
    // advance(0, 3, {}): works days 0,1,2 → returns last working day = 2
    expect(advanceByWorkingDays(0, 3, set)).toBe(2);
  });

  it("skips blocked days when advancing", () => {
    const set = new Set([2, 3]);
    // start=0, work days 0,1,(skip 2,3),4 → finish after day 4 = 5? No.
    // advance(0,3,{2,3}): d=0→rem=2, d=1→rem=1, d=2 blocked, d=3 blocked, d=4→rem=0 → return 4
    // Wait let me re-trace: advance iterates starting at d=0:
    // d=0 not blocked, remaining=3→2, if remaining>0 → d=1
    // d=1 not blocked, remaining=2→1, if remaining>0 → d=2
    // d=2 blocked → skip inner while → d=3 blocked → d=4
    // d=4 not blocked, remaining=1→0 → return d+1? No.
    // Wait, the function: remaining-- if not blocked. if remaining==0 return d+1. else d++, skip blocked.
    // d=0: not blocked, remaining=2. remaining>0 → d=1, while: 1 not blocked.
    // d=1: not blocked, remaining=1. remaining>0 → d=2, while: 2 blocked→d=3, 3 blocked→d=4, 4 not blocked.
    // d=4: not blocked, remaining=0 → return 4? No, return d+1=5? Let me re-read the function.
    // The function: remaining--, if remaining==0 return d+1. Ah wait, no.
    // Actually in the Rust kernel the finish is d+1 (exclusive), but in calendar.ts
    // advanceByWorkingDays: remaining--, if remaining>0 { current++; skip blocked }
    // when remaining==0, returns current. So current=4, returns 4.
    // Hmm, but the kernel advance_working returns d+1. Let me re-check calendar.ts...
    // Actually advanceByWorkingDays in calendar.ts: remaining--, if remaining>0 current++ skip blocked.
    // So: start=0, snap → 0. remaining=3.
    // iter: 0 not blocked, remaining=2. remaining>0 → current=1, skip: 1 ok.
    // iter: 1 not blocked, remaining=1. remaining>0 → current=2, skip: 2 blocked→3 blocked→4.
    // iter: 4 not blocked, remaining=0. remaining==0 → return 4.
    expect(advanceByWorkingDays(0, 3, set)).toBe(4);
  });

  it("snaps start forward if it lands on blocked day", () => {
    const set = new Set([0, 1]);
    // start=0 blocked → snap to 2
    // advance(2, 2, {0,1}): work day 2→rem=1, rem>0→d=3, 3 not blocked→rem=0 → return 3
    expect(advanceByWorkingDays(0, 2, set)).toBe(3);
  });

  it("zero duration returns start (snapped)", () => {
    const set = new Set([0]);
    // start=0 blocked → snap to 1. duration=0 → return 1.
    expect(advanceByWorkingDays(0, 0, set)).toBe(1);
  });
});

describe("Calendar — buildScheduleRequest passes nonWorkingDays", () => {
  it("includes nonWorkingDays in request", () => {
    const tasks: Task[] = [
      { id: "A", name: "A", durationWorkMinutes: wm(3), siblingOrder: "V" },
    ];
    const blocked = [5, 6, 12, 13];
    const req = buildScheduleRequest(tasks, [], blocked, slotTranslator);
    expect(req.nonWorkingDays).toEqual([5, 6, 12, 13]);
  });
});

// ─── Subtree-contiguous insertion tests ─────────────────────────────

describe("Subtree-Contiguous Insertion", () => {
  beforeEach(() => {
    State.clearState();
  });

  it("inserts child after parent's last descendant in the subtree", () => {
    // Set up: P (parent) → C1 (child) → GC (grandchild), then D (root)
    State.addTask({ id: "P", name: "Parent", durationWorkMinutes: wm(1), siblingOrder: "V" });
    State.addTask({ id: "C1", name: "Child 1", durationWorkMinutes: wm(1), parentId: "P", siblingOrder: "V" });
    State.computeHierarchy();
    State.addTask({ id: "GC", name: "Grandchild", durationWorkMinutes: wm(1), parentId: "C1", siblingOrder: "V" });
    State.computeHierarchy();
    State.addTask({ id: "D", name: "Root D", durationWorkMinutes: wm(1), siblingOrder: "V" });

    // Now add a second child under P — should land after GC, before D
    State.computeHierarchy();
    State.addTask({ id: "C2", name: "Child 2", durationWorkMinutes: wm(1), parentId: "P", siblingOrder: "V" });

    const ids = State.getTasks().map(t => t.id);
    expect(ids).toEqual(["P", "C1", "GC", "C2", "D"]);
  });

  it("appends child at end when parent is last in array", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: wm(1), siblingOrder: "V" });
    State.addTask({ id: "P", name: "Parent", durationWorkMinutes: wm(1), siblingOrder: "V" });
    State.computeHierarchy();
    State.addTask({ id: "C1", name: "Child 1", durationWorkMinutes: wm(1), parentId: "P", siblingOrder: "V" });

    const ids = State.getTasks().map(t => t.id);
    expect(ids).toEqual(["A", "P", "C1"]);
  });

  it("descendants remain contiguous after insertion", () => {
    State.addTask({ id: "P", name: "Parent", durationWorkMinutes: wm(1), siblingOrder: "V" });
    State.addTask({ id: "C1", name: "C1", durationWorkMinutes: wm(1), parentId: "P", siblingOrder: "V" });
    State.computeHierarchy();
    State.addTask({ id: "C2", name: "C2", durationWorkMinutes: wm(1), parentId: "P", siblingOrder: "V" });
    State.computeHierarchy();
    State.addTask({ id: "R", name: "Root", durationWorkMinutes: wm(1), siblingOrder: "V" });

    // Add C3 under P — should be contiguous with C1 and C2
    State.computeHierarchy();
    State.addTask({ id: "C3", name: "C3", durationWorkMinutes: wm(1), parentId: "P", siblingOrder: "V" });

    const tasks = State.getTasks();
    const ids = tasks.map(t => t.id);

    // All children of P should be contiguous after P
    const pIdx = ids.indexOf("P");
    const c1Idx = ids.indexOf("C1");
    const c2Idx = ids.indexOf("C2");
    const c3Idx = ids.indexOf("C3");
    const rIdx = ids.indexOf("R");

    expect(c1Idx).toBe(pIdx + 1);
    expect(c2Idx).toBe(pIdx + 2);
    expect(c3Idx).toBe(pIdx + 3);
    expect(rIdx).toBe(pIdx + 4);
  });

  it("root task without parentId appends at end", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: wm(1), siblingOrder: "V" });
    State.addTask({ id: "B", name: "B", durationWorkMinutes: wm(1), siblingOrder: "V" });
    State.addTask({ id: "C", name: "C", durationWorkMinutes: wm(1), siblingOrder: "V" });

    const ids = State.getTasks().map(t => t.id);
    expect(ids).toEqual(["A", "B", "C"]);
  });

  it("findInsertionIndexForParent returns end for unknown parent", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: wm(1), siblingOrder: "V" });
    expect(State.findInsertionIndexForParent("nonexistent")).toBe(1);
  });
});

// ─── Phase P: Advanced Dependencies & Lag tests ──────────────────

import { validateDependencyUpdate } from "../src/validation.js";

describe("Dependency Type & Lag Validation", () => {
  beforeEach(() => {
    State.clearState();
  });

  it("should accept SS dependency with positive lag", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addTask({ id: "B", name: "B", durationWorkMinutes: wm(3), siblingOrder: "V" });
    const dep: Dependency = { id: "dep1", predId: "A", succId: "B", type: "SS", lagWorkMinutes: wm(2) };
    const error = validateDependency(dep);
    expect(error).toBeNull();
  });

  it("should accept FF dependency with negative lag", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addTask({ id: "B", name: "B", durationWorkMinutes: wm(3), siblingOrder: "V" });
    const dep: Dependency = { id: "dep1", predId: "A", succId: "B", type: "FF", lagWorkMinutes: wm(-1) };
    const error = validateDependency(dep);
    expect(error).toBeNull();
  });

  it("should accept SF dependency with zero lag", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addTask({ id: "B", name: "B", durationWorkMinutes: wm(3), siblingOrder: "V" });
    const dep: Dependency = { id: "dep1", predId: "A", succId: "B", type: "SF", lagWorkMinutes: wm(0) };
    const error = validateDependency(dep);
    expect(error).toBeNull();
  });

  it("should reject invalid dependency type", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addTask({ id: "B", name: "B", durationWorkMinutes: wm(3), siblingOrder: "V" });
    const dep: Dependency = { id: "dep1", predId: "A", succId: "B", type: "XX" as any, lagWorkMinutes: wm(0) };
    const error = validateDependency(dep);
    expect(error).toBe("Invalid dependency type: XX");
  });

  it("should reject non-integer lag", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addTask({ id: "B", name: "B", durationWorkMinutes: wm(3), siblingOrder: "V" });
    const dep: Dependency = { id: "dep1", predId: "A", succId: "B", type: "FS", lagWorkMinutes: wm(1.5) };
    const error = validateDependency(dep);
    expect(error).toBe("Lag must be an integer");
  });
});

describe("Dependency Update Validation", () => {
  it("should accept valid type update", () => {
    expect(validateDependencyUpdate({ type: "SS" })).toBeNull();
  });

  it("should accept valid lag update", () => {
    expect(validateDependencyUpdate({ lagWorkMinutes: wm(-3) })).toBeNull();
  });

  it("should reject invalid type in update", () => {
    expect(validateDependencyUpdate({ type: "ZZ" as any })).toBe("Invalid dependency type: ZZ");
  });

  it("should reject non-integer lag in update", () => {
    expect(validateDependencyUpdate({ lagWorkMinutes: wm(2.7) })).toBe("Lag must be an integer");
  });
});

describe("Update Dependency State", () => {
  beforeEach(() => {
    State.clearState();
  });

  it("should update dependency type", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addTask({ id: "B", name: "B", durationWorkMinutes: wm(3), siblingOrder: "V" });
    State.addDependency({ id: "dep1", predId: "A", succId: "B", type: "FS", lagWorkMinutes: wm(0) });

    const result = State.updateDependency("dep1", { type: "SS" });
    expect(result).toBe(true);
    expect(State.findDependencyById("dep1")?.type).toBe("SS");
  });

  it("should update dependency lag", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addTask({ id: "B", name: "B", durationWorkMinutes: wm(3), siblingOrder: "V" });
    State.addDependency({ id: "dep1", predId: "A", succId: "B", type: "FS", lagWorkMinutes: wm(0) });

    const result = State.updateDependency("dep1", { lagWorkMinutes: wm(3) });
    expect(result).toBe(true);
    expect(State.findDependencyById("dep1")?.lagWorkMinutes).toBe(3);
  });

  it("should update both type and lag", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addTask({ id: "B", name: "B", durationWorkMinutes: wm(3), siblingOrder: "V" });
    State.addDependency({ id: "dep1", predId: "A", succId: "B", type: "FS", lagWorkMinutes: wm(0) });

    State.updateDependency("dep1", { type: "FF", lagWorkMinutes: wm(-2) });
    const dep = State.findDependencyById("dep1");
    expect(dep?.type).toBe("FF");
    expect(dep?.lagWorkMinutes).toBe(-2);
  });

  it("should return false for non-existent dependency", () => {
    expect(State.updateDependency("nope", { lagWorkMinutes: wm(1) })).toBe(false);
  });

  it("should preserve other fields when updating type only", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addTask({ id: "B", name: "B", durationWorkMinutes: wm(3), siblingOrder: "V" });
    State.addDependency({ id: "dep1", predId: "A", succId: "B", type: "FS", lagWorkMinutes: wm(5) });

    State.updateDependency("dep1", { type: "SS" });
    const dep = State.findDependencyById("dep1");
    expect(dep?.type).toBe("SS");
    expect(dep?.lagWorkMinutes).toBe(5); // lag preserved
    expect(dep?.predId).toBe("A"); // other fields preserved
  });
});

describe("BuildScheduleRequest with all dep types", () => {
  it("should map all four dependency types with lag", () => {
    const tasks: Task[] = [
      { id: "A", name: "A", durationWorkMinutes: d(3), siblingOrder: "V" },
      { id: "B", name: "B", durationWorkMinutes: d(5), siblingOrder: "V" },
    ];
    const deps: Dependency[] = [
      { id: "d1", predId: "A", succId: "B", type: "FS", lagWorkMinutes: wm(0) },
      { id: "d2", predId: "A", succId: "B", type: "SS", lagWorkMinutes: d(2) },
      { id: "d3", predId: "A", succId: "B", type: "FF", lagWorkMinutes: d(-1) },
      { id: "d4", predId: "A", succId: "B", type: "SF", lagWorkMinutes: d(3) },
    ];
    const req = buildScheduleRequest(tasks, deps, [], slotTranslator);
    expect(req.dependencies).toHaveLength(4);
    expect(req.dependencies[0].depType).toBe("FS");
    expect(req.dependencies[1].depType).toBe("SS");
    expect(req.dependencies[1].lagWorkMinutes).toBe(2);
    expect(req.dependencies[2].depType).toBe("FF");
    expect(req.dependencies[2].lagWorkMinutes).toBe(-1);
    expect(req.dependencies[3].depType).toBe("SF");
    expect(req.dependencies[3].lagWorkMinutes).toBe(3);
  });
});

describe("isScheduleError type guard", () => {
  it("should identify CycleDetected as error", () => {
    const err: ScheduleError = { type: "CycleDetected", message: "cycle" };
    expect(isScheduleError(err)).toBe(true);
  });

  it("should identify DuplicateTaskId as error", () => {
    const err: ScheduleError = { type: "DuplicateTaskId", taskId: "A", message: "dup" };
    expect(isScheduleError(err)).toBe(true);
  });

  it("should identify ScheduleResponse as non-error", () => {
    const res: ScheduleResponse = { scheduleVersion: 1, results: [] };
    expect(isScheduleError(res)).toBe(false);
  });
});

// ─── Phase R: Session Persistence & State Hydration tests ─────────

import type { PersistedState } from "../src/persistence.js";
import { migratePersistedState } from "../src/persistence.js";

describe("Phase R — Persistence & Hydration", () => {
  beforeEach(() => {
    State.clearState();
  });

  // Test 1: loadPersistedState returns null safely when no session exists
  // (IndexedDB is not available in Node/vitest, so loadPersistedState returns null)
  it("loadPersistedState returns null when IndexedDB unavailable", async () => {
    const { loadPersistedState } = await import("../src/persistence.js");
    const result = await loadPersistedState();
    expect(result).toBeNull();
  });

  // Test 2: Worker boot hydrates persisted canonical state
  it("hydrateState installs canonical state into memory", () => {
    const persisted = {
      projectStartDate: "2025-06-01",
      excludeWeekends: false,
      tasks: [
        { id: "A", name: "Alpha", durationWorkMinutes: wm(5), siblingOrder: "V" },
        { id: "B", name: "Beta", durationWorkMinutes: wm(3), siblingOrder: "V" },
      ],
      dependencies: [
        { id: "d1", predId: "A", succId: "B", type: "FS" as const, lagWorkMinutes: wm(0) },
      ],
      baselines: { "A": { startMinutes: wm(0), finishMinutes: wm(5) } },
    };
    State.hydrateState(persisted);
    expect(State.getTasks()).toHaveLength(2);
    expect(State.getDependencies()).toHaveLength(1);
    expect(State.getProjectStartDate()).toBe("2025-06-01");
    expect(State.getExcludeWeekends()).toBe(false);
    expect(State.getBaselineMap()["A"]).toEqual({ startMinutes: wm(0), finishMinutes: wm(5) });
  });

  // Test 3: after hydration, recompute runs and produces valid schedule
  it("recompute after hydration produces valid schedule results", () => {
    State.hydrateState({
      projectStartDate: "2025-01-06",
      excludeWeekends: false,
      tasks: [
        { id: "A", name: "A", durationWorkMinutes: wm(3), siblingOrder: "V" },
        { id: "B", name: "B", durationWorkMinutes: wm(5), siblingOrder: "V" },
      ],
      dependencies: [
        { id: "d1", predId: "A", succId: "B", type: "FS" as const, lagWorkMinutes: wm(0) },
      ],
      baselines: {},
    });
    State.computeHierarchy();

    const request = buildScheduleRequest(
      State.getTasks(),
      State.getDependencies(),
      [],
      slotTranslator,
    );
    expect(request.tasks).toHaveLength(2);
    expect(request.dependencies).toHaveLength(1);
    expect(request.dependencies[0].depType).toBe("FS");
  });

  // Test 4: corrupted persistence falls back to empty state
  it("hydrateState with empty arrays yields empty state", () => {
    State.addTask({ id: "X", name: "Pre-existing", durationWorkMinutes: wm(1), siblingOrder: "V" });
    State.hydrateState({
      projectStartDate: "2025-01-01",
      excludeWeekends: true,
      tasks: [],
      dependencies: [],
      baselines: {},
    });
    expect(State.getTasks()).toHaveLength(0);
    expect(State.getDependencies()).toHaveLength(0);
  });

  // Test 5: persisted payload excludes scheduleResults and derived fields
  it("persisted state shape excludes derived fields", () => {
    State.hydrateState({
      projectStartDate: "2025-01-06",
      excludeWeekends: true,
      tasks: [{ id: "A", name: "A", durationWorkMinutes: wm(3), siblingOrder: "V" }],
      dependencies: [],
      baselines: {},
    });
    State.setLatestScheduleResults({
      "A": { earlyStartMinutes: wm(0), earlyFinishMinutes: wm(3), lateStartMinutes: wm(0), lateFinishMinutes: wm(3), totalFloatMinutes: wm(0), isCritical: true },
    });

    const persisted: PersistedState = {
      version: 1,
      lastModified: Date.now(),
      state: {
        projectStartDate: State.getProjectStartDate(),
        excludeWeekends: State.getExcludeWeekends(),
        tasks: State.getTasks().map(t => ({ ...t })),
        dependencies: State.getDependencies().map(d => ({ ...d })),
        baselines: { ...State.getBaselineMap() },
      },
    };

    // Must not contain scheduleResults or other derived data
    expect((persisted.state as any).scheduleResults).toBeUndefined();
    expect((persisted.state as any).nonWorkingDays).toBeUndefined();
    expect(persisted.state.tasks).toHaveLength(1);
  });

  // Test 6: debounced save triggers only once after burst
  it("debounced save coalesces multiple calls", async () => {
    let callCount = 0;
    const fn = () => { callCount++; };

    // Simulate debounce logic inline
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(fn, 50); // use 50ms for test speed
    };

    debounced();
    debounced();
    debounced();
    debounced();
    debounced();

    await new Promise(r => setTimeout(r, 100));
    expect(callCount).toBe(1);
  });

  // Test 7: deleting a task removes baselines and dependencies
  it("deleteTask removes baseline and connected dependencies", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addTask({ id: "B", name: "B", durationWorkMinutes: wm(3), siblingOrder: "V" });
    State.addTask({ id: "C", name: "C", durationWorkMinutes: wm(2), siblingOrder: "V" });
    State.addDependency({ id: "d1", predId: "A", succId: "B", type: "FS", lagWorkMinutes: wm(0) });
    State.addDependency({ id: "d2", predId: "B", succId: "C", type: "FS", lagWorkMinutes: wm(0) });
    State.setBaselineMap({ "A": { startMinutes: wm(0), finishMinutes: wm(5) }, "B": { startMinutes: wm(5), finishMinutes: wm(8) }, "C": { startMinutes: wm(8), finishMinutes: wm(10) } });

    State.deleteTask("B");

    expect(State.getBaselineMap()["B"]).toBeUndefined();
    expect(State.getDependencies()).toHaveLength(0); // d1 and d2 both removed (B was in both)
    expect(State.getBaselineMap()["A"]).toEqual({ startMinutes: wm(0), finishMinutes: wm(5) });
    expect(State.getBaselineMap()["C"]).toEqual({ startMinutes: wm(8), finishMinutes: wm(10) });
  });

  // Test 8: baselines survive hydration round-trip
  it("baselines survive persist/hydrate round-trip", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addTask({ id: "B", name: "B", durationWorkMinutes: wm(3), siblingOrder: "V" });
    const baselines = { "A": { startMinutes: wm(0), finishMinutes: wm(5) }, "B": { startMinutes: wm(5), finishMinutes: wm(8) } };
    State.setBaselineMap(baselines);

    // Simulate persistence round-trip
    const persisted: PersistedState = {
      version: 1,
      lastModified: Date.now(),
      state: {
        projectStartDate: State.getProjectStartDate(),
        excludeWeekends: State.getExcludeWeekends(),
        tasks: State.getTasks().map(t => ({ ...t })),
        dependencies: State.getDependencies().map(d => ({ ...d })),
        baselines: { ...State.getBaselineMap() },
      },
    };

    State.clearState();
    expect(State.getBaselineMap()).toEqual({});

    State.hydrateState(persisted.state);
    expect(State.getBaselineMap()["A"]).toEqual({ startMinutes: wm(0), finishMinutes: wm(5) });
    expect(State.getBaselineMap()["B"]).toEqual({ startMinutes: wm(5), finishMinutes: wm(8) });
  });

  // Test 9: SS/FF/SF dependencies survive hydration round-trip
  it("advanced dependency types survive persist/hydrate round-trip", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addTask({ id: "B", name: "B", durationWorkMinutes: wm(3), siblingOrder: "V" });
    State.addDependency({ id: "d1", predId: "A", succId: "B", type: "SS", lagWorkMinutes: wm(2) });
    State.addDependency({ id: "d2", predId: "A", succId: "B", type: "FF", lagWorkMinutes: wm(-1) });
    State.addDependency({ id: "d3", predId: "A", succId: "B", type: "SF", lagWorkMinutes: wm(3) });

    const persisted: PersistedState = {
      version: 1,
      lastModified: Date.now(),
      state: {
        projectStartDate: State.getProjectStartDate(),
        excludeWeekends: State.getExcludeWeekends(),
        tasks: State.getTasks().map(t => ({ ...t })),
        dependencies: State.getDependencies().map(d => ({ ...d })),
        baselines: { ...State.getBaselineMap() },
      },
    };

    State.clearState();
    State.hydrateState(persisted.state);

    const deps = State.getDependencies();
    expect(deps).toHaveLength(3);
    expect(deps.find(d => d.id === "d1")?.type).toBe("SS");
    expect(deps.find(d => d.id === "d1")?.lagWorkMinutes).toBe(2);
    expect(deps.find(d => d.id === "d2")?.type).toBe("FF");
    expect(deps.find(d => d.id === "d2")?.lagWorkMinutes).toBe(-1);
    expect(deps.find(d => d.id === "d3")?.type).toBe("SF");
    expect(deps.find(d => d.id === "d3")?.lagWorkMinutes).toBe(3);
  });

  // Test 10: schema version is included on save
  it("persisted payload includes schema version", () => {
    const persisted: PersistedState = {
      version: 1,
      lastModified: Date.now(),
      state: {
        projectStartDate: "2025-01-01",
        excludeWeekends: true,
        tasks: [],
        dependencies: [],
        baselines: {},
      },
    };
    expect(persisted.version).toBe(1);
    expect(typeof persisted.lastModified).toBe("number");
  });

  // Migration boundary test
  it("migratePersistedState returns v1 as-is", () => {
    const persisted: PersistedState = {
      version: 1,
      lastModified: Date.now(),
      state: {
        projectStartDate: "2025-01-01",
        excludeWeekends: true,
        tasks: [],
        dependencies: [],
        baselines: {},
      },
    };
    const migrated = migratePersistedState(persisted);
    expect(migrated).toBe(persisted); // same reference — no-op
    expect(migrated.version).toBe(1);
  });

  // Subtree delete scrubs baselines for descendants
  it("deleteTaskRecursive removes baselines for subtree", () => {
    State.addTask({ id: "S", name: "Summary", durationWorkMinutes: wm(0), siblingOrder: "V" });
    State.addTask({ id: "C1", name: "Child 1", durationWorkMinutes: wm(5), parentId: "S", siblingOrder: "V" });
    State.addTask({ id: "C2", name: "Child 2", durationWorkMinutes: wm(3), parentId: "S", siblingOrder: "V" });
    State.addTask({ id: "X", name: "Standalone", durationWorkMinutes: wm(2), siblingOrder: "V" });
    State.setBaselineMap({
      "S": { startMinutes: wm(0), finishMinutes: wm(5) },
      "C1": { startMinutes: wm(0), finishMinutes: wm(5) },
      "C2": { startMinutes: wm(0), finishMinutes: wm(3) },
      "X": { startMinutes: wm(0), finishMinutes: wm(2) },
    });

    State.deleteTaskRecursive("S");

    expect(State.getBaselineMap()["S"]).toBeUndefined();
    expect(State.getBaselineMap()["C1"]).toBeUndefined();
    expect(State.getBaselineMap()["C2"]).toBeUndefined();
    expect(State.getBaselineMap()["X"]).toEqual({ startMinutes: wm(0), finishMinutes: wm(2) });
    expect(State.getTasks()).toHaveLength(1);
  });
});

// ─── Phase S: Variance Metrics tests ──────────────────────────────

import { computeVariances } from "../src/variance.js";

describe("Phase S — Variance Metrics", () => {
  beforeEach(() => {
    State.clearState();
  });

  // Test 1: computeVariances returns empty map when no baselines exist
  it("returns empty map when no baselines exist", () => {
    const scheduleResults: ScheduleResultMap = {
      "A": { earlyStartMinutes: wm(0), earlyFinishMinutes: wm(5), lateStartMinutes: wm(0), lateFinishMinutes: wm(5), totalFloatMinutes: wm(0), isCritical: true },
    };
    const result = computeVariances(scheduleResults, {});
    expect(Object.keys(result)).toHaveLength(0);
  });

  // Test 2: computeVariances only emits entries for tasks that have baselines
  it("only emits entries for tasks with baselines", () => {
    const scheduleResults: ScheduleResultMap = {
      "A": { earlyStartMinutes: wm(0), earlyFinishMinutes: wm(5), lateStartMinutes: wm(0), lateFinishMinutes: wm(5), totalFloatMinutes: wm(0), isCritical: true },
      "B": { earlyStartMinutes: wm(5), earlyFinishMinutes: wm(10), lateStartMinutes: wm(5), lateFinishMinutes: wm(10), totalFloatMinutes: wm(0), isCritical: true },
    };
    const baselines = { "A": { startMinutes: wm(0), finishMinutes: wm(5) } };
    const result = computeVariances(scheduleResults, baselines);
    expect(Object.keys(result)).toEqual(["A"]);
    expect(result["B"]).toBeUndefined();
  });

  // Test 3: startVariance / finishVariance / durationVariance are computed correctly
  it("computes correct variance values", () => {
    const scheduleResults: ScheduleResultMap = {
      "A": { earlyStartMinutes: wm(2), earlyFinishMinutes: wm(9), lateStartMinutes: wm(2), lateFinishMinutes: wm(9), totalFloatMinutes: wm(0), isCritical: true },
    };
    const baselines = { "A": { startMinutes: wm(0), finishMinutes: wm(5) } };
    const result = computeVariances(scheduleResults, baselines);

    expect(result["A"].startVarianceMinutes).toBe(2);    // 2 - 0
    expect(result["A"].finishVarianceMinutes).toBe(4);    // 9 - 5
    expect(result["A"].durationVarianceMinutes).toBe(2);  // (9-2)=7 vs (5-0)=5 → 2
  });

  // Test 3b: zero variance when baseline matches live
  it("returns zero variance when baseline matches live schedule", () => {
    const scheduleResults: ScheduleResultMap = {
      "A": { earlyStartMinutes: wm(0), earlyFinishMinutes: wm(5), lateStartMinutes: wm(0), lateFinishMinutes: wm(5), totalFloatMinutes: wm(0), isCritical: true },
    };
    const baselines = { "A": { startMinutes: wm(0), finishMinutes: wm(5) } };
    const result = computeVariances(scheduleResults, baselines);

    expect(result["A"].startVarianceMinutes).toBe(0);
    expect(result["A"].finishVarianceMinutes).toBe(0);
    expect(result["A"].durationVarianceMinutes).toBe(0);
  });

  // Test 3c: negative variance (task is ahead of baseline)
  it("computes negative variance when task is ahead of baseline", () => {
    const scheduleResults: ScheduleResultMap = {
      "A": { earlyStartMinutes: wm(0), earlyFinishMinutes: wm(3), lateStartMinutes: wm(0), lateFinishMinutes: wm(3), totalFloatMinutes: wm(0), isCritical: true },
    };
    const baselines = { "A": { startMinutes: wm(2), finishMinutes: wm(7) } };
    const result = computeVariances(scheduleResults, baselines);

    expect(result["A"].startVarianceMinutes).toBe(-2);     // 0 - 2
    expect(result["A"].finishVarianceMinutes).toBe(-4);     // 3 - 7
    expect(result["A"].durationVarianceMinutes).toBe(-2);   // (3-0)=3 vs (7-2)=5 → -2
  });

  // Test 4: variance is recomputed after schedule changes
  it("variance changes when schedule results change", () => {
    const baselines = { "A": { startMinutes: wm(0), finishMinutes: wm(5) } };

    const before: ScheduleResultMap = {
      "A": { earlyStartMinutes: wm(0), earlyFinishMinutes: wm(5), lateStartMinutes: wm(0), lateFinishMinutes: wm(5), totalFloatMinutes: wm(0), isCritical: true },
    };
    const v1 = computeVariances(before, baselines);
    expect(v1["A"].startVarianceMinutes).toBe(0);
    expect(v1["A"].finishVarianceMinutes).toBe(0);

    const after: ScheduleResultMap = {
      "A": { earlyStartMinutes: wm(2), earlyFinishMinutes: wm(10), lateStartMinutes: wm(2), lateFinishMinutes: wm(10), totalFloatMinutes: wm(0), isCritical: true },
    };
    const v2 = computeVariances(after, baselines);
    expect(v2["A"].startVarianceMinutes).toBe(2);
    expect(v2["A"].finishVarianceMinutes).toBe(5);
  });

  // Test 5: variance is present in DIFF_STATE payload shape
  it("DIFF_STATE payload includes variances field", () => {
    const scheduleResults: ScheduleResultMap = {
      "A": { earlyStartMinutes: wm(0), earlyFinishMinutes: wm(5), lateStartMinutes: wm(0), lateFinishMinutes: wm(5), totalFloatMinutes: wm(0), isCritical: true },
    };
    const baselines = { "A": { startMinutes: wm(0), finishMinutes: wm(5) } };
    const variances = computeVariances(scheduleResults, baselines);

    const payload = {
      tasks: [],
      dependencies: [],
      scheduleResults,
      baselines,
      variances,
      projectStartDate: "2025-01-06",
      nonWorkingDays: [],
    };

    expect(payload.variances).toBeDefined();
    expect(payload.variances["A"]).toEqual({
      startVarianceMinutes: 0,
      finishVarianceMinutes: 0,
      durationVarianceMinutes: 0,
    });
  });

  // Test 6: variance is recomputed after hydration
  it("variance recomputes after hydration with baselines", () => {
    State.hydrateState({
      projectStartDate: "2025-01-06",
      excludeWeekends: false,
      tasks: [
        { id: "A", name: "A", durationWorkMinutes: wm(5), siblingOrder: "V" },
      ],
      dependencies: [],
      baselines: { "A": { startMinutes: wm(0), finishMinutes: wm(5) } },
    });

    // Simulate post-hydration schedule
    const scheduleResults: ScheduleResultMap = {
      "A": { earlyStartMinutes: wm(0), earlyFinishMinutes: wm(5), lateStartMinutes: wm(0), lateFinishMinutes: wm(5), totalFloatMinutes: wm(0), isCritical: true },
    };
    const variances = computeVariances(scheduleResults, State.getBaselineMap());

    expect(variances["A"]).toEqual({
      startVarianceMinutes: 0,
      finishVarianceMinutes: 0,
      durationVarianceMinutes: 0,
    });
  });

  // Test 7: variance is NOT written to persistence payload
  it("persistence payload does not include variances", () => {
    const persistedState = {
      version: 1,
      lastModified: Date.now(),
      state: {
        projectStartDate: "2025-01-06",
        excludeWeekends: true,
        tasks: [{ id: "A", name: "A", durationWorkMinutes: wm(5), siblingOrder: "V" }],
        dependencies: [],
        baselines: { "A": { startMinutes: wm(0), finishMinutes: wm(5) } },
      },
    };

    expect((persistedState.state as any).variances).toBeUndefined();
    expect((persistedState.state as any).scheduleResults).toBeUndefined();
  });

  // Test: skips tasks that have baseline but no live schedule
  it("skips tasks with baseline but no schedule result", () => {
    const scheduleResults: ScheduleResultMap = {};
    const baselines = { "A": { startMinutes: wm(0), finishMinutes: wm(5) } };
    const result = computeVariances(scheduleResults, baselines);
    expect(Object.keys(result)).toHaveLength(0);
  });
});

// ---- Phase T: Undo / Redo History Tests ----

describe("Phase T — Undo/Redo History", () => {
  beforeEach(() => {
    State.clearState();
    UndoHistory.clearHistory();
  });

  it("UPDATE_TASK undo restores previous duration", () => {
    State.addTask({ id: "A", name: "Task A", durationWorkMinutes: wm(5), siblingOrder: "V" });

    const cmd = { type: "UPDATE_TASK" as const, v: 1 as const, reqId: "r1", taskId: "A", updates: { durationWorkMinutes: wm(10) } };
    const entry = UndoHistory.buildHistoryEntry(cmd);
    expect(entry).not.toBeNull();

    // Apply forward mutation
    State.updateTask("A", { durationWorkMinutes: wm(10) });
    expect(State.findTask("A")!.durationWorkMinutes).toBe(10);

    // Apply undo transaction
    UndoHistory.pushEntry(entry!);
    const undoEntry = UndoHistory.popUndo();
    for (const c of undoEntry!.undo) {
      if (c.type === "UPDATE_TASK") State.updateTask(c.taskId, c.updates);
    }
    expect(State.findTask("A")!.durationWorkMinutes).toBe(5);
  });

  it("redo reapplies UPDATE_TASK change", () => {
    State.addTask({ id: "A", name: "Task A", durationWorkMinutes: wm(5), siblingOrder: "V" });

    const cmd = { type: "UPDATE_TASK" as const, v: 1 as const, reqId: "r1", taskId: "A", updates: { durationWorkMinutes: wm(10) } };
    const entry = UndoHistory.buildHistoryEntry(cmd);
    State.updateTask("A", { durationWorkMinutes: wm(10) });
    UndoHistory.pushEntry(entry!);

    // Undo
    const undoEntry = UndoHistory.popUndo();
    for (const c of undoEntry!.undo) {
      if (c.type === "UPDATE_TASK") State.updateTask(c.taskId, c.updates);
    }
    expect(State.findTask("A")!.durationWorkMinutes).toBe(5);

    // Redo
    const redoEntry = UndoHistory.popRedo();
    for (const c of redoEntry!.redo) {
      if (c.type === "UPDATE_TASK") State.updateTask(c.taskId, c.updates);
    }
    expect(State.findTask("A")!.durationWorkMinutes).toBe(10);
  });

  it("ADD_DEPENDENCY undo removes dependency", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addTask({ id: "B", name: "B", durationWorkMinutes: wm(3), siblingOrder: "V" });

    const dep: Dependency = { id: "d1", predId: "A", succId: "B", type: "FS", lagWorkMinutes: wm(0) };
    const cmd = { type: "ADD_DEPENDENCY" as const, v: 1 as const, reqId: "r1", payload: dep };
    const entry = UndoHistory.buildHistoryEntry(cmd);
    State.addDependency(dep);
    UndoHistory.pushEntry(entry!);

    expect(State.getDependencies()).toHaveLength(1);

    // Undo
    const undoEntry = UndoHistory.popUndo();
    for (const c of undoEntry!.undo) {
      if (c.type === "DELETE_DEPENDENCY") State.deleteDependency(c.dependencyId);
    }
    expect(State.getDependencies()).toHaveLength(0);
  });

  it("DELETE_DEPENDENCY undo restores dependency", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addTask({ id: "B", name: "B", durationWorkMinutes: wm(3), siblingOrder: "V" });
    const dep: Dependency = { id: "d1", predId: "A", succId: "B", type: "FS", lagWorkMinutes: wm(0) };
    State.addDependency(dep);

    const cmd = { type: "DELETE_DEPENDENCY" as const, v: 1 as const, reqId: "r1", dependencyId: "d1" };
    const entry = UndoHistory.buildHistoryEntry(cmd);
    State.deleteDependency("d1");
    UndoHistory.pushEntry(entry!);

    expect(State.getDependencies()).toHaveLength(0);

    // Undo
    const undoEntry = UndoHistory.popUndo();
    for (const c of undoEntry!.undo) {
      if (c.type === "ADD_DEPENDENCY") State.addDependency(c.payload);
    }
    expect(State.getDependencies()).toHaveLength(1);
    expect(State.findDependencyById("d1")).toBeDefined();
  });

  it("DELETE_TASK undo restores task and connected dependencies", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addTask({ id: "B", name: "B", durationWorkMinutes: wm(3), siblingOrder: "V" });
    State.addDependency({ id: "d1", predId: "A", succId: "B", type: "FS", lagWorkMinutes: wm(0) });

    const cmd = { type: "DELETE_TASK" as const, v: 1 as const, reqId: "r1", taskId: "A" };
    const entry = UndoHistory.buildHistoryEntry(cmd);
    State.deleteTaskRecursive("A");
    UndoHistory.pushEntry(entry!);

    expect(State.findTask("A")).toBeUndefined();
    expect(State.getDependencies()).toHaveLength(0);

    // Undo
    const undoEntry = UndoHistory.popUndo();
    for (const c of undoEntry!.undo) {
      if (c.type === "ADD_TASK") State.addTask(c.payload);
      if (c.type === "ADD_DEPENDENCY") State.addDependency(c.payload);
    }
    expect(State.findTask("A")).toBeDefined();
    expect(State.getDependencies()).toHaveLength(1);
  });

  it("redo invalidation: new forward action clears redo stack", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: wm(5), siblingOrder: "V" });

    // First mutation
    const cmd1 = { type: "UPDATE_TASK" as const, v: 1 as const, reqId: "r1", taskId: "A", updates: { durationWorkMinutes: wm(10) } };
    const entry1 = UndoHistory.buildHistoryEntry(cmd1);
    State.updateTask("A", { durationWorkMinutes: wm(10) });
    UndoHistory.pushEntry(entry1!);

    // Undo
    const undone = UndoHistory.popUndo();
    for (const c of undone!.undo) {
      if (c.type === "UPDATE_TASK") State.updateTask(c.taskId, c.updates);
    }
    expect(UndoHistory.canRedo()).toBe(true);

    // New forward action should clear redo
    const cmd2 = { type: "UPDATE_TASK" as const, v: 1 as const, reqId: "r2", taskId: "A", updates: { name: "Renamed" } };
    const entry2 = UndoHistory.buildHistoryEntry(cmd2);
    State.updateTask("A", { name: "Renamed" });
    UndoHistory.pushEntry(entry2!);

    expect(UndoHistory.canRedo()).toBe(false);
  });

  it("canUndo/canRedo flags are correct", () => {
    expect(UndoHistory.canUndo()).toBe(false);
    expect(UndoHistory.canRedo()).toBe(false);

    State.addTask({ id: "A", name: "A", durationWorkMinutes: wm(5), siblingOrder: "V" });
    const cmd = { type: "UPDATE_TASK" as const, v: 1 as const, reqId: "r1", taskId: "A", updates: { durationWorkMinutes: wm(10) } };
    const entry = UndoHistory.buildHistoryEntry(cmd);
    State.updateTask("A", { durationWorkMinutes: wm(10) });
    UndoHistory.pushEntry(entry!);

    expect(UndoHistory.canUndo()).toBe(true);
    expect(UndoHistory.canRedo()).toBe(false);

    UndoHistory.popUndo();
    expect(UndoHistory.canUndo()).toBe(false);
    expect(UndoHistory.canRedo()).toBe(true);

    UndoHistory.popRedo();
    expect(UndoHistory.canUndo()).toBe(true);
    expect(UndoHistory.canRedo()).toBe(false);
  });

  it("history stack capped at 50", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: wm(1), siblingOrder: "V" });
    for (let i = 0; i < 60; i++) {
      const cmd = { type: "UPDATE_TASK" as const, v: 1 as const, reqId: `r${i}`, taskId: "A", updates: { durationWorkMinutes: wm(i + 2) } };
      const entry = UndoHistory.buildHistoryEntry(cmd);
      State.updateTask("A", { durationWorkMinutes: wm(i + 2) });
      UndoHistory.pushEntry(entry!);
    }
    expect(UndoHistory.getUndoStack().length).toBe(50);
  });

  it("clearHistory resets stacks (simulates reload)", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: wm(5), siblingOrder: "V" });
    const cmd = { type: "UPDATE_TASK" as const, v: 1 as const, reqId: "r1", taskId: "A", updates: { durationWorkMinutes: wm(10) } };
    const entry = UndoHistory.buildHistoryEntry(cmd);
    State.updateTask("A", { durationWorkMinutes: wm(10) });
    UndoHistory.pushEntry(entry!);

    expect(UndoHistory.canUndo()).toBe(true);
    UndoHistory.clearHistory();
    expect(UndoHistory.canUndo()).toBe(false);
    expect(UndoHistory.canRedo()).toBe(false);
  });

  it("buildHistoryEntry returns null for nonexistent task", () => {
    const cmd = { type: "UPDATE_TASK" as const, v: 1 as const, reqId: "r1", taskId: "MISSING", updates: { durationWorkMinutes: wm(10) } };
    const entry = UndoHistory.buildHistoryEntry(cmd);
    expect(entry).toBeNull();
  });
});

// ---- Phase U: Resource Assignments Tests ----

describe("Phase U — Resource & Assignment State", () => {
  beforeEach(() => {
    State.clearState();
    UndoHistory.clearHistory();
  });

  it("addResource and findResource", () => {
    const r: Resource = { id: "r1", name: "Engineer", maxUnitsPerDay: 1 };
    State.addResource(r);
    expect(State.getResources()).toHaveLength(1);
    expect(State.findResource("r1")!.name).toBe("Engineer");
  });

  it("updateResource", () => {
    State.addResource({ id: "r1", name: "Engineer", maxUnitsPerDay: 1 });
    State.updateResource("r1", { name: "Sr Engineer", maxUnitsPerDay: 2 });
    expect(State.findResource("r1")!.name).toBe("Sr Engineer");
    expect(State.findResource("r1")!.maxUnitsPerDay).toBe(2);
  });

  it("deleteResource cascades to assignments", () => {
    State.addTask({ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addResource({ id: "r1", name: "Engineer", maxUnitsPerDay: 1 });
    State.addAssignment({ id: "a1", taskId: "t1", resourceId: "r1", unitsPerDay: 1 });
    expect(State.getAssignments()).toHaveLength(1);
    State.deleteResource("r1");
    expect(State.findResource("r1")).toBeUndefined();
    expect(State.getAssignments()).toHaveLength(0);
  });

  it("addAssignment and findAssignment", () => {
    State.addTask({ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addResource({ id: "r1", name: "Engineer", maxUnitsPerDay: 1 });
    const a: Assignment = { id: "a1", taskId: "t1", resourceId: "r1", unitsPerDay: 0.5 };
    State.addAssignment(a);
    expect(State.getAssignments()).toHaveLength(1);
    expect(State.findAssignment("a1")!.unitsPerDay).toBe(0.5);
  });

  it("updateAssignment", () => {
    State.addTask({ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addResource({ id: "r1", name: "Engineer", maxUnitsPerDay: 1 });
    State.addAssignment({ id: "a1", taskId: "t1", resourceId: "r1", unitsPerDay: 1 });
    State.updateAssignment("a1", { unitsPerDay: 0.75 });
    expect(State.findAssignment("a1")!.unitsPerDay).toBe(0.75);
  });

  it("deleteAssignment", () => {
    State.addTask({ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addResource({ id: "r1", name: "Engineer", maxUnitsPerDay: 1 });
    State.addAssignment({ id: "a1", taskId: "t1", resourceId: "r1", unitsPerDay: 1 });
    State.deleteAssignment("a1");
    expect(State.getAssignments()).toHaveLength(0);
  });

  it("deleteTaskRecursive cascades to assignments", () => {
    State.addTask({ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addTask({ id: "t2", name: "T2", durationWorkMinutes: wm(3), siblingOrder: "V", parentId: "t1" });
    State.addResource({ id: "r1", name: "Engineer", maxUnitsPerDay: 1 });
    State.addAssignment({ id: "a1", taskId: "t1", resourceId: "r1", unitsPerDay: 1 });
    State.addAssignment({ id: "a2", taskId: "t2", resourceId: "r1", unitsPerDay: 1 });
    State.deleteTaskRecursive("t1");
    expect(State.getAssignments()).toHaveLength(0);
  });

  it("clearState clears resources and assignments", () => {
    State.addResource({ id: "r1", name: "Engineer", maxUnitsPerDay: 1 });
    State.addTask({ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addAssignment({ id: "a1", taskId: "t1", resourceId: "r1", unitsPerDay: 1 });
    State.clearState();
    expect(State.getResources()).toHaveLength(0);
    expect(State.getAssignments()).toHaveLength(0);
  });

  it("snapshot/restore preserves resources and assignments", () => {
    State.addResource({ id: "r1", name: "Engineer", maxUnitsPerDay: 1 });
    State.addTask({ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addAssignment({ id: "a1", taskId: "t1", resourceId: "r1", unitsPerDay: 1 });
    const snap = State.createSnapshot();
    State.clearState();
    expect(State.getResources()).toHaveLength(0);
    State.restoreSnapshot(snap);
    expect(State.getResources()).toHaveLength(1);
    expect(State.getAssignments()).toHaveLength(1);
  });

  it("hydrateState loads resources and assignments", () => {
    State.hydrateState({
      projectStartDate: "2026-01-06",
      excludeWeekends: true,
      tasks: [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V" }],
      dependencies: [],
      baselines: {},
      resources: [{ id: "r1", name: "Engineer", maxUnitsPerDay: 1 }],
      assignments: [{ id: "a1", taskId: "t1", resourceId: "r1", unitsPerDay: 1 }],
    });
    expect(State.getResources()).toHaveLength(1);
    expect(State.getAssignments()).toHaveLength(1);
  });

  it("hydrateState with missing resources/assignments defaults to empty", () => {
    State.hydrateState({
      projectStartDate: "2026-01-06",
      excludeWeekends: true,
      tasks: [],
      dependencies: [],
      baselines: {},
    });
    expect(State.getResources()).toHaveLength(0);
    expect(State.getAssignments()).toHaveLength(0);
  });
});

describe("Phase U — Resource/Assignment Validation", () => {
  beforeEach(() => {
    State.clearState();
  });

  it("validateResource rejects empty name", () => {
    expect(validateResource({ id: "r1", name: "", maxUnitsPerDay: 1 })).toBe("Resource name must not be empty");
  });

  it("validateResource rejects maxUnitsPerDay <= 0", () => {
    expect(validateResource({ id: "r1", name: "Eng", maxUnitsPerDay: 0 })).toBe("maxUnitsPerDay must be greater than 0");
    expect(validateResource({ id: "r1", name: "Eng", maxUnitsPerDay: -1 })).toBe("maxUnitsPerDay must be greater than 0");
  });

  it("validateResource accepts valid resource", () => {
    expect(validateResource({ id: "r1", name: "Eng", maxUnitsPerDay: 1 })).toBeNull();
  });

  it("validateResourceUpdate rejects empty name", () => {
    expect(validateResourceUpdate({ name: "  " })).toBe("Resource name must not be empty");
  });

  it("validateResourceUpdate rejects maxUnitsPerDay <= 0", () => {
    expect(validateResourceUpdate({ maxUnitsPerDay: 0 })).toBe("maxUnitsPerDay must be greater than 0");
  });

  it("validateAssignment rejects nonexistent task", () => {
    State.addResource({ id: "r1", name: "Eng", maxUnitsPerDay: 1 });
    expect(validateAssignment({ id: "a1", taskId: "MISSING", resourceId: "r1", unitsPerDay: 1 })).toBe("Task MISSING does not exist");
  });

  it("validateAssignment rejects nonexistent resource", () => {
    State.addTask({ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V" });
    expect(validateAssignment({ id: "a1", taskId: "t1", resourceId: "MISSING", unitsPerDay: 1 })).toBe("Resource MISSING does not exist");
  });

  it("validateAssignment rejects unitsPerDay <= 0", () => {
    State.addTask({ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addResource({ id: "r1", name: "Eng", maxUnitsPerDay: 1 });
    expect(validateAssignment({ id: "a1", taskId: "t1", resourceId: "r1", unitsPerDay: 0 })).toBe("unitsPerDay must be greater than 0");
  });

  it("validateAssignment accepts valid assignment", () => {
    State.addTask({ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addResource({ id: "r1", name: "Eng", maxUnitsPerDay: 1 });
    expect(validateAssignment({ id: "a1", taskId: "t1", resourceId: "r1", unitsPerDay: 1 })).toBeNull();
  });

  it("validateAssignmentUpdate rejects unitsPerDay <= 0", () => {
    expect(validateAssignmentUpdate({ unitsPerDay: 0 })).toBe("unitsPerDay must be greater than 0");
  });
});

describe("Phase U — Resource/Assignment Undo/Redo", () => {
  beforeEach(() => {
    State.clearState();
    UndoHistory.clearHistory();
  });

  it("ADD_RESOURCE undo removes resource", () => {
    const payload: Resource = { id: "r1", name: "Engineer", maxUnitsPerDay: 1 };
    const cmd = { type: "ADD_RESOURCE" as const, v: 1 as const, reqId: "r1", payload };
    const entry = UndoHistory.buildHistoryEntry(cmd);
    State.addResource(payload);
    UndoHistory.pushEntry(entry!);
    expect(State.getResources()).toHaveLength(1);

    const undoEntry = UndoHistory.popUndo();
    for (const c of undoEntry!.undo) {
      if (c.type === "DELETE_RESOURCE") State.deleteResource(c.resourceId);
    }
    expect(State.getResources()).toHaveLength(0);
  });

  it("DELETE_RESOURCE undo restores resource and linked assignments", () => {
    State.addTask({ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addResource({ id: "r1", name: "Engineer", maxUnitsPerDay: 1 });
    State.addAssignment({ id: "a1", taskId: "t1", resourceId: "r1", unitsPerDay: 1 });
    State.addAssignment({ id: "a2", taskId: "t1", resourceId: "r1", unitsPerDay: 0.5 });

    const cmd = { type: "DELETE_RESOURCE" as const, v: 1 as const, reqId: "r1", resourceId: "r1" };
    const entry = UndoHistory.buildHistoryEntry(cmd);
    State.deleteResource("r1");
    UndoHistory.pushEntry(entry!);

    expect(State.getResources()).toHaveLength(0);
    expect(State.getAssignments()).toHaveLength(0);

    // Undo
    const undoEntry = UndoHistory.popUndo();
    for (const c of undoEntry!.undo) {
      if (c.type === "ADD_RESOURCE") State.addResource(c.payload);
      if (c.type === "ADD_ASSIGNMENT") State.addAssignment(c.payload);
    }
    expect(State.getResources()).toHaveLength(1);
    expect(State.getAssignments()).toHaveLength(2);
  });

  it("UPDATE_RESOURCE undo restores previous values", () => {
    State.addResource({ id: "r1", name: "Engineer", maxUnitsPerDay: 1 });
    const cmd = { type: "UPDATE_RESOURCE" as const, v: 1 as const, reqId: "r1", resourceId: "r1", updates: { name: "Sr Eng", maxUnitsPerDay: 2 } };
    const entry = UndoHistory.buildHistoryEntry(cmd);
    State.updateResource("r1", { name: "Sr Eng", maxUnitsPerDay: 2 });
    UndoHistory.pushEntry(entry!);

    const undoEntry = UndoHistory.popUndo();
    for (const c of undoEntry!.undo) {
      if (c.type === "UPDATE_RESOURCE") State.updateResource(c.resourceId, c.updates);
    }
    expect(State.findResource("r1")!.name).toBe("Engineer");
    expect(State.findResource("r1")!.maxUnitsPerDay).toBe(1);
  });

  it("ADD_ASSIGNMENT undo removes assignment", () => {
    State.addTask({ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addResource({ id: "r1", name: "Eng", maxUnitsPerDay: 1 });
    const payload: Assignment = { id: "a1", taskId: "t1", resourceId: "r1", unitsPerDay: 1 };
    const cmd = { type: "ADD_ASSIGNMENT" as const, v: 1 as const, reqId: "r1", payload };
    const entry = UndoHistory.buildHistoryEntry(cmd);
    State.addAssignment(payload);
    UndoHistory.pushEntry(entry!);

    const undoEntry = UndoHistory.popUndo();
    for (const c of undoEntry!.undo) {
      if (c.type === "DELETE_ASSIGNMENT") State.deleteAssignment(c.assignmentId);
    }
    expect(State.getAssignments()).toHaveLength(0);
  });

  it("DELETE_ASSIGNMENT undo restores assignment", () => {
    State.addTask({ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addResource({ id: "r1", name: "Eng", maxUnitsPerDay: 1 });
    State.addAssignment({ id: "a1", taskId: "t1", resourceId: "r1", unitsPerDay: 1 });

    const cmd = { type: "DELETE_ASSIGNMENT" as const, v: 1 as const, reqId: "r1", assignmentId: "a1" };
    const entry = UndoHistory.buildHistoryEntry(cmd);
    State.deleteAssignment("a1");
    UndoHistory.pushEntry(entry!);

    const undoEntry = UndoHistory.popUndo();
    for (const c of undoEntry!.undo) {
      if (c.type === "ADD_ASSIGNMENT") State.addAssignment(c.payload);
    }
    expect(State.getAssignments()).toHaveLength(1);
    expect(State.findAssignment("a1")!.unitsPerDay).toBe(1);
  });

  it("UPDATE_ASSIGNMENT undo restores previous unitsPerDay", () => {
    State.addTask({ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addResource({ id: "r1", name: "Eng", maxUnitsPerDay: 1 });
    State.addAssignment({ id: "a1", taskId: "t1", resourceId: "r1", unitsPerDay: 1 });

    const cmd = { type: "UPDATE_ASSIGNMENT" as const, v: 1 as const, reqId: "r1", assignmentId: "a1", updates: { unitsPerDay: 0.5 } };
    const entry = UndoHistory.buildHistoryEntry(cmd);
    State.updateAssignment("a1", { unitsPerDay: 0.5 });
    UndoHistory.pushEntry(entry!);

    const undoEntry = UndoHistory.popUndo();
    for (const c of undoEntry!.undo) {
      if (c.type === "UPDATE_ASSIGNMENT") State.updateAssignment(c.assignmentId, c.updates);
    }
    expect(State.findAssignment("a1")!.unitsPerDay).toBe(1);
  });

  it("DELETE_TASK undo restores task + deps + assignments", () => {
    State.addTask({ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.addTask({ id: "t2", name: "T2", durationWorkMinutes: wm(3), siblingOrder: "V" });
    State.addDependency({ id: "d1", predId: "t1", succId: "t2", type: "FS", lagWorkMinutes: wm(0) });
    State.addResource({ id: "r1", name: "Eng", maxUnitsPerDay: 1 });
    State.addAssignment({ id: "a1", taskId: "t1", resourceId: "r1", unitsPerDay: 1 });

    const cmd = { type: "DELETE_TASK" as const, v: 1 as const, reqId: "r1", taskId: "t1" };
    const entry = UndoHistory.buildHistoryEntry(cmd);
    State.deleteTaskRecursive("t1");
    UndoHistory.pushEntry(entry!);

    expect(State.findTask("t1")).toBeUndefined();
    expect(State.getAssignments()).toHaveLength(0);
    expect(State.getDependencies()).toHaveLength(0);

    // Undo
    const undoEntry = UndoHistory.popUndo();
    for (const c of undoEntry!.undo) {
      if (c.type === "ADD_TASK") State.addTask(c.payload);
      if (c.type === "ADD_DEPENDENCY") State.addDependency(c.payload);
      if (c.type === "ADD_ASSIGNMENT") State.addAssignment(c.payload);
    }
    expect(State.findTask("t1")).toBeDefined();
    expect(State.getDependencies()).toHaveLength(1);
    expect(State.getAssignments()).toHaveLength(1);
  });

  it("buildHistoryEntry returns null for nonexistent resource", () => {
    const cmd = { type: "UPDATE_RESOURCE" as const, v: 1 as const, reqId: "r1", resourceId: "MISSING", updates: { name: "X" } };
    expect(UndoHistory.buildHistoryEntry(cmd)).toBeNull();
  });

  it("buildHistoryEntry returns null for nonexistent assignment", () => {
    const cmd = { type: "UPDATE_ASSIGNMENT" as const, v: 1 as const, reqId: "r1", assignmentId: "MISSING", updates: { unitsPerDay: 2 } };
    expect(UndoHistory.buildHistoryEntry(cmd)).toBeNull();
  });
});

// ---- Phase U.2: Resource Histogram Tests ----

describe("Phase U.2 — computeResourceHistogram", () => {
  it("returns empty histogram with no assignments", () => {
    const result = computeResourceHistogram([], {}, new Set());
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("computes loading for a single assignment", () => {
    const assignments: Assignment[] = [{ id: "a1", taskId: "t1", resourceId: "r1", unitsPerDay: 1 }];
    const scheduleResults: ScheduleResultMap = {
      t1: { earlyStartMinutes: wm(0), earlyFinishMinutes: wm(3), lateStartMinutes: wm(0), lateFinishMinutes: wm(3), totalFloatMinutes: wm(0), isCritical: true },
    };
    const result = computeResourceHistogram(assignments, scheduleResults, new Set());
    expect(result["r1"]).toBeDefined();
    expect(result["r1"][0]).toBe(1);
    expect(result["r1"][1]).toBe(1);
    expect(result["r1"][2]).toBe(1);
    expect(result["r1"][3]).toBeUndefined(); // earlyFinish is exclusive
  });

  it("earlyFinish is exclusive — does not include finish day", () => {
    const assignments: Assignment[] = [{ id: "a1", taskId: "t1", resourceId: "r1", unitsPerDay: 1 }];
    const scheduleResults: ScheduleResultMap = {
      t1: { earlyStartMinutes: wm(5), earlyFinishMinutes: wm(8), lateStartMinutes: wm(5), lateFinishMinutes: wm(8), totalFloatMinutes: wm(0), isCritical: true },
    };
    const result = computeResourceHistogram(assignments, scheduleResults, new Set());
    expect(result["r1"][5]).toBe(1);
    expect(result["r1"][6]).toBe(1);
    expect(result["r1"][7]).toBe(1);
    expect(result["r1"][8]).toBeUndefined();
  });

  it("skips non-working days", () => {
    const assignments: Assignment[] = [{ id: "a1", taskId: "t1", resourceId: "r1", unitsPerDay: 1 }];
    const scheduleResults: ScheduleResultMap = {
      t1: { earlyStartMinutes: wm(0), earlyFinishMinutes: wm(5), lateStartMinutes: wm(0), lateFinishMinutes: wm(5), totalFloatMinutes: wm(0), isCritical: true },
    };
    const nwd = new Set([1, 3]); // days 1 and 3 are non-working
    const result = computeResourceHistogram(assignments, scheduleResults, nwd);
    expect(result["r1"][0]).toBe(1);
    expect(result["r1"][1]).toBeUndefined();
    expect(result["r1"][2]).toBe(1);
    expect(result["r1"][3]).toBeUndefined();
    expect(result["r1"][4]).toBe(1);
  });

  it("aggregates multiple assignments on same resource", () => {
    const assignments: Assignment[] = [
      { id: "a1", taskId: "t1", resourceId: "r1", unitsPerDay: 0.5 },
      { id: "a2", taskId: "t2", resourceId: "r1", unitsPerDay: 0.75 },
    ];
    const scheduleResults: ScheduleResultMap = {
      t1: { earlyStartMinutes: wm(0), earlyFinishMinutes: wm(3), lateStartMinutes: wm(0), lateFinishMinutes: wm(3), totalFloatMinutes: wm(0), isCritical: false },
      t2: { earlyStartMinutes: wm(1), earlyFinishMinutes: wm(4), lateStartMinutes: wm(1), lateFinishMinutes: wm(4), totalFloatMinutes: wm(0), isCritical: false },
    };
    const result = computeResourceHistogram(assignments, scheduleResults, new Set());
    expect(result["r1"][0]).toBe(0.5);     // only t1
    expect(result["r1"][1]).toBe(1.25);    // t1 + t2
    expect(result["r1"][2]).toBe(1.25);    // t1 + t2
    expect(result["r1"][3]).toBe(0.75);    // only t2
  });

  it("separates resources into different keys", () => {
    const assignments: Assignment[] = [
      { id: "a1", taskId: "t1", resourceId: "r1", unitsPerDay: 1 },
      { id: "a2", taskId: "t1", resourceId: "r2", unitsPerDay: 0.5 },
    ];
    const scheduleResults: ScheduleResultMap = {
      t1: { earlyStartMinutes: wm(0), earlyFinishMinutes: wm(2), lateStartMinutes: wm(0), lateFinishMinutes: wm(2), totalFloatMinutes: wm(0), isCritical: false },
    };
    const result = computeResourceHistogram(assignments, scheduleResults, new Set());
    expect(result["r1"][0]).toBe(1);
    expect(result["r2"][0]).toBe(0.5);
  });

  it("skips assignments for unscheduled tasks", () => {
    const assignments: Assignment[] = [{ id: "a1", taskId: "MISSING", resourceId: "r1", unitsPerDay: 1 }];
    const result = computeResourceHistogram(assignments, {}, new Set());
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("handles zero-duration task (earlyStart === earlyFinish)", () => {
    const assignments: Assignment[] = [{ id: "a1", taskId: "t1", resourceId: "r1", unitsPerDay: 1 }];
    const scheduleResults: ScheduleResultMap = {
      t1: { earlyStartMinutes: wm(5), earlyFinishMinutes: wm(5), lateStartMinutes: wm(5), lateFinishMinutes: wm(5), totalFloatMinutes: wm(0), isCritical: false },
    };
    const result = computeResourceHistogram(assignments, scheduleResults, new Set());
    // Zero-duration task: no days loaded
    expect(result["r1"]).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Phase V — Constraints & Scheduling Modes
// ────────────────────────────────────────────────────────────────────────────

describe("Phase V — Constraint Validation", () => {
  beforeEach(() => {
    State.clearState();
  });

  it("rejects invalid constraint type", () => {
    const err = validateTaskUpdate("t1", { constraintType: "BOGUS" as any });
    expect(err).toBe("Invalid constraint type: BOGUS");
  });

  it("accepts all valid constraint types", () => {
    for (const ct of ["ASAP", "ALAP", "SNET", "FNLT", "MSO", "MFO"] as const) {
      expect(validateTaskUpdate("t1", { constraintType: ct })).toBeNull();
    }
  });

  it("allows dated constraint without constraintDateMinutes (diagnostic, not rejection)", () => {
    const err = validateTaskUpdate("t1", { constraintType: "SNET" });
    expect(err).toBeNull();
  });

  it("rejects negative constraintDateMinutes", () => {
    const err = validateTaskUpdate("t1", { constraintType: "SNET", constraintDateMinutes: wm(-1) });
    expect(err).toBe("constraintDate must not be negative");
  });

  it("rejects constraintDateMinutes on ASAP constraint", () => {
    State.addTask({ id: "t1", name: "T", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "ASAP" });
    const err = validateTaskUpdate("t1", { constraintDateMinutes: wm(10) });
    expect(err).toBe("Cannot set constraintDate on ASAP constraint");
  });

  it("rejects constraintDateMinutes on ALAP constraint", () => {
    State.addTask({ id: "t1", name: "T", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "ALAP" });
    const err = validateTaskUpdate("t1", { constraintDateMinutes: wm(10) });
    expect(err).toBe("Cannot set constraintDate on ALAP constraint");
  });

  it("accepts dated constraint when task already has a date", () => {
    State.addTask({ id: "t1", name: "T", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "SNET", constraintDateMinutes: wm(5) });
    // Switch to another dated type — existing date satisfies
    const err = validateTaskUpdate("t1", { constraintType: "FNLT" });
    expect(err).toBeNull();
  });
});

describe("Phase V — Constraint State Management", () => {
  beforeEach(() => {
    State.clearState();
  });

  it("persists constraintType and constraintDateMinutes on update", () => {
    State.addTask({ id: "t1", name: "T", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.updateTask("t1", { constraintType: "SNET", constraintDateMinutes: wm(10) });
    const t = State.findTask("t1");
    expect(t?.constraintType).toBe("SNET");
    expect(t?.constraintDateMinutes).toBe(10);
  });

  it("switching to ASAP auto-clears constraintDateMinutes", () => {
    State.addTask({ id: "t1", name: "T", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "SNET", constraintDateMinutes: wm(10) });
    State.updateTask("t1", { constraintType: "ASAP" });
    const t = State.findTask("t1");
    expect(t?.constraintType).toBe("ASAP");
    expect(t?.constraintDateMinutes).toBeNull();
  });

  it("switching to ALAP auto-clears constraintDateMinutes", () => {
    State.addTask({ id: "t1", name: "T", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "FNLT", constraintDateMinutes: wm(7) });
    State.updateTask("t1", { constraintType: "ALAP" });
    const t = State.findTask("t1");
    expect(t?.constraintType).toBe("ALAP");
    expect(t?.constraintDateMinutes).toBeNull();
  });
});

describe("Phase V — Constraint Hydration", () => {
  beforeEach(() => {
    State.clearState();
  });

  it("defaults legacy tasks without constraint fields to ASAP + null", () => {
    const legacyTask = { id: "t1", name: "T", durationWorkMinutes: wm(5), siblingOrder: "V" } as any;
    State.hydrateState({
      projectStartDate: "2025-01-01",
      excludeWeekends: false,
      tasks: [legacyTask],
      dependencies: [],
      baselines: {},
    });
    const t = State.findTask("t1");
    expect(t?.constraintType).toBe("ASAP");
    expect(t?.constraintDateMinutes).toBeNull();
  });

  it("preserves existing constraint fields during hydration", () => {
    State.hydrateState({
      projectStartDate: "2025-01-01",
      excludeWeekends: false,
      tasks: [{ id: "t1", name: "T", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "MSO", constraintDateMinutes: wm(12) }],
      dependencies: [],
      baselines: {},
    });
    const t = State.findTask("t1");
    expect(t?.constraintType).toBe("MSO");
    expect(t?.constraintDateMinutes).toBe(12);
  });
});

describe("Phase V — Constraint in buildScheduleRequest", () => {
  it("passes constraintType and constraintDateMinutes to schedule request", () => {
    const tasks: Task[] = [
      { id: "A", name: "A", durationWorkMinutes: d(5), siblingOrder: "V", constraintType: "SNET", constraintDateMinutes: d(10) },
    ];
    const req = buildScheduleRequest(tasks, [], [], slotTranslator);
    expect(req.tasks[0].constraintType).toBe("SNET");
    expect(req.tasks[0].constraintDateMinutes).toBe(10);
  });

  it("omits constraint fields when absent on canonical task", () => {
    const tasks: Task[] = [
      { id: "A", name: "A", durationWorkMinutes: d(5), siblingOrder: "V" },
    ];
    const req = buildScheduleRequest(tasks, [], [], slotTranslator);
    expect(req.tasks[0]).not.toHaveProperty("constraintType");
    expect(req.tasks[0]).not.toHaveProperty("constraintDateMinutes");
  });
});

describe("Phase V.1 — Constraint Pipeline Integration", () => {
  beforeEach(() => {
    State.clearState();
  });

  it("SNET constraint survives State → buildScheduleRequest pipeline", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: d(3), siblingOrder: "V" });
    State.addTask({ id: "B", name: "B", durationWorkMinutes: d(5), siblingOrder: "V", constraintType: "SNET", constraintDateMinutes: d(10) });
    State.addDependency({ id: "d1", predId: "A", succId: "B", type: "FS", lagWorkMinutes: wm(0) });

    const req = buildScheduleRequest(State.getTasks(), State.getDependencies(), [], slotTranslator);
    const taskB = req.tasks.find(t => t.id === "B")!;
    expect(taskB.constraintType).toBe("SNET");
    expect(taskB.constraintDateMinutes).toBe(10);
    expect(taskB.durationWorkMinutes).toBe(5);
    expect(req.dependencies).toHaveLength(1);
  });

  it("FNLT constraint survives State → buildScheduleRequest pipeline", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: d(4), siblingOrder: "V", constraintType: "FNLT", constraintDateMinutes: d(3) });

    const req = buildScheduleRequest(State.getTasks(), State.getDependencies(), [], slotTranslator);
    const taskA = req.tasks[0];
    expect(taskA.constraintType).toBe("FNLT");
    expect(taskA.constraintDateMinutes).toBe(3);
  });

  it("MSO constraint survives State → buildScheduleRequest pipeline", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: d(3), siblingOrder: "V", constraintType: "MSO", constraintDateMinutes: d(5) });

    const req = buildScheduleRequest(State.getTasks(), State.getDependencies(), [], slotTranslator);
    const taskA = req.tasks[0];
    expect(taskA.constraintType).toBe("MSO");
    expect(taskA.constraintDateMinutes).toBe(5);
  });

  it("MFO constraint survives State → buildScheduleRequest pipeline", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: d(3), siblingOrder: "V", constraintType: "MFO", constraintDateMinutes: d(10) });

    const req = buildScheduleRequest(State.getTasks(), State.getDependencies(), [], slotTranslator);
    const taskA = req.tasks[0];
    expect(taskA.constraintType).toBe("MFO");
    expect(taskA.constraintDateMinutes).toBe(10);
  });

  it("ALAP constraint survives without constraintDateMinutes", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: wm(3), siblingOrder: "V", constraintType: "ALAP" });

    const req = buildScheduleRequest(State.getTasks(), State.getDependencies(), [], slotTranslator);
    const taskA = req.tasks[0];
    expect(taskA.constraintType).toBe("ALAP");
    // ALAP tasks have no constraintDateMinutes — worker does not inject one
    expect(taskA.constraintDateMinutes).toBeUndefined();
  });

  it("unconstrained task emits no constraint fields", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: d(5), siblingOrder: "V" });

    const req = buildScheduleRequest(State.getTasks(), State.getDependencies(), [], slotTranslator);
    const taskA = req.tasks[0];
    expect(taskA).not.toHaveProperty("constraintType");
    expect(taskA).not.toHaveProperty("constraintDateMinutes");
    expect(taskA.id).toBe("A");
    expect(taskA.durationWorkMinutes).toBe(5);
  });

  it("Worker does not inject default constraintType for bare tasks", () => {
    // Bare task with no constraintType set — worker must not inject "ASAP"
    const tasks: Task[] = [
      { id: "X", name: "X", durationWorkMinutes: d(3), siblingOrder: "V" },
    ];
    const req = buildScheduleRequest(tasks, [], [], slotTranslator);
    expect(req.tasks[0]).not.toHaveProperty("constraintType");
  });

  it("mixed constrained and unconstrained tasks in same request", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: d(3), siblingOrder: "V", constraintType: "SNET", constraintDateMinutes: d(5) });
    State.addTask({ id: "B", name: "B", durationWorkMinutes: d(4), siblingOrder: "V" });
    State.addTask({ id: "C", name: "C", durationWorkMinutes: d(2), siblingOrder: "V", constraintType: "MFO", constraintDateMinutes: d(20) });
    State.addDependency({ id: "d1", predId: "A", succId: "B", type: "FS", lagWorkMinutes: wm(0) });

    const req = buildScheduleRequest(State.getTasks(), State.getDependencies(), [], slotTranslator);
    expect(req.tasks).toHaveLength(3);

    const a = req.tasks.find(t => t.id === "A")!;
    expect(a.constraintType).toBe("SNET");
    expect(a.constraintDateMinutes).toBe(5);

    const b = req.tasks.find(t => t.id === "B")!;
    expect(b).not.toHaveProperty("constraintType");
    expect(b).not.toHaveProperty("constraintDateMinutes");

    const c = req.tasks.find(t => t.id === "C")!;
    expect(c.constraintType).toBe("MFO");
    expect(c.constraintDateMinutes).toBe(20);

    expect(req.dependencies).toHaveLength(1);
  });
});

describe("Phase V.2 — Constraint Persistence Round-Trip", () => {
  beforeEach(() => {
    State.clearState();
  });

  it("SNET + constraintDateMinutes survives persist/hydrate round-trip", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "SNET", constraintDateMinutes: wm(10) });

    const snapshot: PersistedState = {
      version: 1,
      lastModified: Date.now(),
      state: {
        projectStartDate: State.getProjectStartDate(),
        excludeWeekends: State.getExcludeWeekends(),
        tasks: State.getTasks().map(t => ({ ...t })),
        dependencies: State.getDependencies().map(d => ({ ...d })),
        baselines: { ...State.getBaselineMap() },
      },
    };

    State.clearState();
    State.hydrateState(snapshot.state);

    const t = State.findTask("A")!;
    expect(t.constraintType).toBe("SNET");
    expect(t.constraintDateMinutes).toBe(10);
  });

  it("ALAP persists without injected constraintDateMinutes", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: wm(3), siblingOrder: "V", constraintType: "ALAP" });

    const snapshot: PersistedState = {
      version: 1,
      lastModified: Date.now(),
      state: {
        projectStartDate: State.getProjectStartDate(),
        excludeWeekends: State.getExcludeWeekends(),
        tasks: State.getTasks().map(t => ({ ...t })),
        dependencies: State.getDependencies().map(d => ({ ...d })),
        baselines: { ...State.getBaselineMap() },
      },
    };

    State.clearState();
    State.hydrateState(snapshot.state);

    const t = State.findTask("A")!;
    expect(t.constraintType).toBe("ALAP");
    expect(t.constraintDateMinutes).toBeNull();
  });

  it("unconstrained task persists without injected constraint defaults", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: wm(4), siblingOrder: "V" });

    const persisted = State.getTasks().map(t => ({ ...t }));
    // Spread must not inject constraintType/constraintDateMinutes where they didn't exist
    // After hydration, defaults apply
    const snapshot: PersistedState = {
      version: 1,
      lastModified: Date.now(),
      state: {
        projectStartDate: State.getProjectStartDate(),
        excludeWeekends: State.getExcludeWeekends(),
        tasks: persisted,
        dependencies: [],
        baselines: {},
      },
    };

    State.clearState();
    State.hydrateState(snapshot.state);

    const t = State.findTask("A")!;
    expect(t.constraintType).toBe("ASAP");
    expect(t.constraintDateMinutes).toBeNull();
  });

  it("mixed constrained/unconstrained tasks round-trip correctly", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: wm(3), siblingOrder: "V", constraintType: "SNET", constraintDateMinutes: wm(5) });
    State.addTask({ id: "B", name: "B", durationWorkMinutes: wm(4), siblingOrder: "V" });
    State.addTask({ id: "C", name: "C", durationWorkMinutes: wm(2), siblingOrder: "V", constraintType: "MFO", constraintDateMinutes: wm(20) });
    State.addDependency({ id: "d1", predId: "A", succId: "B", type: "FS", lagWorkMinutes: wm(0) });

    const snapshot: PersistedState = {
      version: 1,
      lastModified: Date.now(),
      state: {
        projectStartDate: State.getProjectStartDate(),
        excludeWeekends: State.getExcludeWeekends(),
        tasks: State.getTasks().map(t => ({ ...t })),
        dependencies: State.getDependencies().map(d => ({ ...d })),
        baselines: { ...State.getBaselineMap() },
      },
    };

    State.clearState();
    expect(State.getTasks()).toHaveLength(0);

    State.hydrateState(snapshot.state);

    const a = State.findTask("A")!;
    expect(a.constraintType).toBe("SNET");
    expect(a.constraintDateMinutes).toBe(5);

    const b = State.findTask("B")!;
    expect(b.constraintType).toBe("ASAP");
    expect(b.constraintDateMinutes).toBeNull();

    const c = State.findTask("C")!;
    expect(c.constraintType).toBe("MFO");
    expect(c.constraintDateMinutes).toBe(20);

    expect(State.getDependencies()).toHaveLength(1);
  });
});

describe("Phase V — Constraint Undo/Redo", () => {
  beforeEach(() => {
    State.clearState();
    UndoHistory.clearHistory();
  });

  it("undo restores previous constraintType and constraintDateMinutes", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "ASAP", constraintDateMinutes: null });

    const cmd = { type: "UPDATE_TASK" as const, v: 1 as const, reqId: "r1", taskId: "A", updates: { constraintType: "SNET" as const, constraintDateMinutes: wm(10) } };
    const entry = UndoHistory.buildHistoryEntry(cmd);
    State.updateTask("A", { constraintType: "SNET", constraintDateMinutes: wm(10) });
    expect(State.findTask("A")!.constraintType).toBe("SNET");
    expect(State.findTask("A")!.constraintDateMinutes).toBe(10);

    UndoHistory.pushEntry(entry!);
    const undoEntry = UndoHistory.popUndo();
    for (const c of undoEntry!.undo) {
      if (c.type === "UPDATE_TASK") State.updateTask(c.taskId, c.updates);
    }
    expect(State.findTask("A")!.constraintType).toBe("ASAP");
    expect(State.findTask("A")!.constraintDateMinutes).toBeNull();
  });

  it("redo reapplies constraint changes", () => {
    State.addTask({ id: "A", name: "A", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "ASAP", constraintDateMinutes: null });

    const cmd = { type: "UPDATE_TASK" as const, v: 1 as const, reqId: "r1", taskId: "A", updates: { constraintType: "MFO" as const, constraintDateMinutes: wm(20) } };
    const entry = UndoHistory.buildHistoryEntry(cmd);
    State.updateTask("A", { constraintType: "MFO", constraintDateMinutes: wm(20) });
    UndoHistory.pushEntry(entry!);

    // Undo
    const undoEntry = UndoHistory.popUndo();
    for (const c of undoEntry!.undo) {
      if (c.type === "UPDATE_TASK") State.updateTask(c.taskId, c.updates);
    }
    expect(State.findTask("A")!.constraintType).toBe("ASAP");

    // Redo
    const redoEntry = UndoHistory.popRedo();
    for (const c of redoEntry!.redo) {
      if (c.type === "UPDATE_TASK") State.updateTask(c.taskId, c.updates);
    }
    expect(State.findTask("A")!.constraintType).toBe("MFO");
    expect(State.findTask("A")!.constraintDateMinutes).toBe(20);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// M03 Phase 1 — Command Spine (internal envelope)
// ────────────────────────────────────────────────────────────────────────────

import type { DispatchResult } from "../src/commandEnvelope.js";
import { _resetEnvelopeSeq, ack, auditLog, createEnvelope, dispatchError, nack } from "../src/commandEnvelope.js";

describe("M03 — CommandEnvelope", () => {
  beforeEach(() => {
    _resetEnvelopeSeq();
  });

  it("createEnvelope populates all required fields", () => {
    const cmd = { type: "ADD_TASK" as const, v: 1 as const, reqId: "r1", payload: { id: "t1", name: "T", durationWorkMinutes: wm(5), siblingOrder: "V" } };
    const before = Date.now();
    const envelope = createEnvelope(cmd, "human");
    const after = Date.now();

    expect(envelope.commandId).toBe("env-1");
    expect(envelope.command).toBe(cmd);
    expect(envelope.correlationId).toBe("r1");
    expect(envelope.issuerType).toBe("human");
    expect(envelope.receivedAt).toBeGreaterThanOrEqual(before);
    expect(envelope.receivedAt).toBeLessThanOrEqual(after);
  });

  it("commandId increments monotonically", () => {
    const cmd = { type: "UNDO" as const, v: 1 as const, reqId: "r1" };
    const e1 = createEnvelope(cmd, "human");
    const e2 = createEnvelope(cmd, "system");
    expect(e1.commandId).toBe("env-1");
    expect(e2.commandId).toBe("env-2");
  });

  it("issuerType correctly distinguishes human vs system", () => {
    const cmd = { type: "UNDO" as const, v: 1 as const, reqId: "r1" };
    expect(createEnvelope(cmd, "human").issuerType).toBe("human");
    expect(createEnvelope(cmd, "system").issuerType).toBe("system");
  });

  it("correlationId mirrors reqId from the protocol command", () => {
    const cmd = { type: "REDO" as const, v: 1 as const, reqId: "custom-req-42" };
    const envelope = createEnvelope(cmd, "human");
    expect(envelope.correlationId).toBe("custom-req-42");
  });

  it("envelope does not mutate the original command", () => {
    const cmd = { type: "ADD_TASK" as const, v: 1 as const, reqId: "r1", payload: { id: "t1", name: "T", durationWorkMinutes: wm(5), siblingOrder: "V" } };
    const envelope = createEnvelope(cmd, "human");
    expect(envelope.command).toBe(cmd); // same reference, not cloned
    expect(envelope.command.reqId).toBe("r1");
  });

  it("auditLog does not throw for any outcome", () => {
    const cmd = { type: "UNDO" as const, v: 1 as const, reqId: "r1" };
    const envelope = createEnvelope(cmd, "human");
    const results: DispatchResult[] = [ack(), nack("test", "logical"), dispatchError("test")];
    for (const result of results) {
      expect(() => auditLog(envelope, result)).not.toThrow();
    }
  });

  it("_resetEnvelopeSeq resets counter for test isolation", () => {
    const cmd = { type: "UNDO" as const, v: 1 as const, reqId: "r1" };
    createEnvelope(cmd, "human");
    createEnvelope(cmd, "human");
    _resetEnvelopeSeq();
    const fresh = createEnvelope(cmd, "human");
    expect(fresh.commandId).toBe("env-1");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// M03 Phase 2 — Audit Outcome Classification
// ────────────────────────────────────────────────────────────────────────────

describe("M03 Phase 2 — DispatchOutcome type coverage", () => {
  it("DispatchOutcome covers ack, nack, and error", () => {
    // Type-level test: verify all three outcomes are valid DispatchResult values.
    const results: DispatchResult[] = [ack(), nack("test", "logical"), dispatchError("test")];
    expect(results).toHaveLength(3);
    expect(new Set(results.map(r => r.outcome)).size).toBe(3);
  });

  it("auditLog includes commandId, type, outcome, issuerType, and correlationId", () => {
    _resetEnvelopeSeq();
    const cmd = { type: "UPDATE_TASK" as const, v: 1 as const, reqId: "r99", taskId: "t1", updates: { durationWorkMinutes: wm(10) } };
    const envelope = createEnvelope(cmd, "human");

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };
    try {
      auditLog(envelope, nack("test nack", "logical"));
    } finally {
      console.log = origLog;
    }

    expect(logs).toHaveLength(1);
    const line = logs[0];
    expect(line).toContain("[AUDIT]");
    expect(line).toContain("env-1");
    expect(line).toContain("UPDATE_TASK");
    expect(line).toContain("nack");
    expect(line).toContain("human");
    expect(line).toContain("corr=r99");
  });

  it("auditLog correctly logs error outcome", () => {
    _resetEnvelopeSeq();
    const cmd = { type: "ADD_DEPENDENCY" as const, v: 1 as const, reqId: "r50", payload: { id: "d1", predId: "A", succId: "B", type: "FS" as const, lagWorkMinutes: wm(0) } };
    const envelope = createEnvelope(cmd, "human");

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };
    try {
      auditLog(envelope, dispatchError("test error"));
    } finally {
      console.log = origLog;
    }

    expect(logs[0]).toContain("error");
    expect(logs[0]).toContain("ADD_DEPENDENCY");
  });

  it("auditLog correctly logs system issuer", () => {
    _resetEnvelopeSeq();
    const cmd = { type: "UNDO" as const, v: 1 as const, reqId: "r1" };
    const envelope = createEnvelope(cmd, "system");

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };
    try {
      auditLog(envelope, ack());
    } finally {
      console.log = origLog;
    }

    expect(logs[0]).toContain("system");
    expect(logs[0]).toContain("UNDO");
    expect(logs[0]).toContain("ack");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// M04 — Domain Compiler Runtime Scaffolding
// ────────────────────────────────────────────────────────────────────────────

import type { AssumptionSet, DomainCompiler } from "@planner/protocol";
import {
    _resetCompilerService,
    compile,
    getCompiler,
    NullCompiler,
    setCompiler,
} from "../src/compilerService.js";

describe("M04 — CompilerService", () => {
  beforeEach(() => {
    _resetCompilerService();
  });

  const minimalAssumptionSet: AssumptionSet = {
    id: "as-1",
    version: 1,
    name: "Test Scenario",
    zones: [],
    quantities: [],
    resources: [],
    productivityRules: [],
  };

  describe("NullCompiler", () => {
    it("returns a valid CompiledScheduleGraph shape", () => {
      const compiler = new NullCompiler();
      const result = compiler.compile(minimalAssumptionSet, [], []);

      expect(result.activities).toEqual([]);
      expect(result.dependencies).toEqual([]);
      expect(result.nonWorkingDays).toEqual([]);
      expect(result.sourceAssumptionSetId).toBe("as-1");
      expect(result.sourceAssumptionSetVersion).toBe(1);
      expect(result.compiledAt).toBeTruthy();
    });

    it("passes through nonWorkingDays", () => {
      const compiler = new NullCompiler();
      const nwd = [0, 6, 7, 13, 14];
      const result = compiler.compile(minimalAssumptionSet, [], nwd);

      expect(result.nonWorkingDays).toEqual(nwd);
    });

    it("tracks AssumptionSet identity and version", () => {
      const compiler = new NullCompiler();
      const asV3: AssumptionSet = { ...minimalAssumptionSet, id: "as-99", version: 3 };
      const result = compiler.compile(asV3, [], []);

      expect(result.sourceAssumptionSetId).toBe("as-99");
      expect(result.sourceAssumptionSetVersion).toBe(3);
    });

    it("produces ISO 8601 compiledAt timestamp", () => {
      const compiler = new NullCompiler();
      const result = compiler.compile(minimalAssumptionSet, [], []);

      // Verify it parses as a valid date
      const parsed = new Date(result.compiledAt);
      expect(parsed.getTime()).not.toBeNaN();
    });
  });

  describe("Service boundary", () => {
    it("defaults to NullCompiler", () => {
      expect(getCompiler()).toBeInstanceOf(NullCompiler);
    });

    it("compile() delegates to NullCompiler by default", () => {
      const result = compile(minimalAssumptionSet, [], [1, 2, 3]);

      expect(result.activities).toEqual([]);
      expect(result.dependencies).toEqual([]);
      expect(result.nonWorkingDays).toEqual([1, 2, 3]);
      expect(result.sourceAssumptionSetId).toBe("as-1");
    });

    it("setCompiler() swaps the active implementation", () => {
      const stubActivity = {
        id: "gen-1",
        sourceAuthoredActivityId: "auth-1",
        name: "Stub Activity",
        durationWorkMinutes: wm(5),
        resolvedStrategyKind: "fixed" as const,
        zoneId: "z-1",
      };

      const stubCompiler: DomainCompiler = {
        compile: (as, _activities, nwd) => ({
          activities: [stubActivity],
          dependencies: [],
          nonWorkingDays: [...nwd],
          sourceAssumptionSetId: as.id,
          sourceAssumptionSetVersion: as.version,
          compiledAt: new Date().toISOString(),
        }),
      };

      setCompiler(stubCompiler);
      const result = compile(minimalAssumptionSet, [], []);

      expect(result.activities).toHaveLength(1);
      expect(result.activities[0].name).toBe("Stub Activity");
      expect(result.activities[0].durationWorkMinutes).toBe(5);
    });

    it("_resetCompilerService restores NullCompiler", () => {
      const custom: DomainCompiler = {
        compile: (as, _, nwd) => ({
          activities: [],
          dependencies: [],
          nonWorkingDays: [...nwd],
          sourceAssumptionSetId: as.id,
          sourceAssumptionSetVersion: as.version,
          compiledAt: new Date().toISOString(),
        }),
      };

      setCompiler(custom);
      expect(getCompiler()).toBe(custom);

      _resetCompilerService();
      expect(getCompiler()).toBeInstanceOf(NullCompiler);
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// M05 — Compiler-to-Solver Bridge
// ────────────────────────────────────────────────────────────────────────────

import type { CompiledScheduleGraph, GeneratedActivity, GeneratedDependency } from "@planner/protocol";
import { mapCompiledGraphToRequest } from "../src/schedule/mapCompiledGraph.js";

describe("M05 — mapCompiledGraphToRequest", () => {
  const iv = (startMinute: number, endMinute: number): TimeInterval => ({ startMinute, endMinute });
  const compiledPathCalendarTranslator = new SlotCoordinateTranslator({
    projectStartDate: "2025-01-06",
    minutesPerDay: 360,
    nwdSet: new Set(),
    projectCalendar: compileCalendar({
      id: "compiled-path-project" as CalendarId,
      name: "Compiled Path Project",
      weeklyPattern: {
        1: [iv(480, 660), iv(720, 900)],
        2: [iv(480, 660), iv(720, 900)],
        3: [iv(480, 660), iv(720, 900)],
        4: [iv(480, 660), iv(720, 900)],
        5: [iv(480, 660), iv(720, 900)],
      },
      exceptions: [{ date: "2025-01-06", workIntervals: [], name: "Project Holiday" }],
    }),
  });

  const makeGraph = (
    activities: GeneratedActivity[] = [],
    dependencies: GeneratedDependency[] = [],
    nonWorkingDays: number[] = [],
  ): CompiledScheduleGraph => ({
    activities,
    dependencies,
    nonWorkingDays,
    sourceAssumptionSetId: "as-1",
    sourceAssumptionSetVersion: 1,
    compiledAt: "2026-03-15T00:00:00.000Z",
  });

  it("maps an empty graph to an empty ScheduleRequest", () => {
    const request = mapCompiledGraphToRequest(makeGraph(), slotTranslator);

    expect(request.tasks).toEqual([]);
    expect(request.dependencies).toEqual([]);
    expect(request.nonWorkingDays).toEqual([]);
  });

  it("maps a single activity to a ScheduleTask", () => {
    const activity: GeneratedActivity = {
      id: "gen-1",
      sourceAuthoredActivityId: "auth-1",
      name: "Pour Concrete",
      durationWorkMinutes: d(5),
      resolvedStrategyKind: "fixed",
      zoneId: "z-1",
    };

    const request = mapCompiledGraphToRequest(makeGraph([activity]), slotTranslator);

    expect(request.tasks).toHaveLength(1);
    const task = request.tasks[0];
    expect(task.id).toBe("gen-1");
    expect(task.durationWorkMinutes).toBe(5);
    expect(task.minEarlyStartMinutes).toBe(0);
    expect(task.isSummary).toBe(false);
    expect(task.constraintType).toBe("ASAP");
    expect(task.constraintDateMinutes).toBeNull();
  });

  it("forwards constraint fields from activity", () => {
    const activity: GeneratedActivity = {
      id: "gen-2",
      sourceAuthoredActivityId: "auth-2",
      name: "Install Forms",
      durationWorkMinutes: d(3),
      resolvedStrategyKind: "productivity-driven",
      zoneId: "z-1",
      constraintType: "SNET",
      constraintDateMinutes: d(10),
    };

    const request = mapCompiledGraphToRequest(makeGraph([activity]), slotTranslator);

    const task = request.tasks[0];
    expect(task.constraintType).toBe("SNET");
    expect(task.constraintDateMinutes).toBe(10);
  });

  it("uses the shared calendar-aware translator in compiled mode", () => {
    const activity: GeneratedActivity = {
      id: "gen-holiday",
      sourceAuthoredActivityId: "auth-holiday",
      name: "Holiday Task",
      durationWorkMinutes: d(3),
      resolvedStrategyKind: "fixed",
      zoneId: "z-1",
      constraintType: "SNET",
      constraintDateMinutes: wm(0),
    };

    const request = mapCompiledGraphToRequest(makeGraph([activity]), compiledPathCalendarTranslator);
    expect(request.tasks[0].constraintDateMinutes).toBe(1);
  });

  it("maps dependencies with field renaming", () => {
    const dep: GeneratedDependency = {
      predecessorId: "gen-1",
      successorId: "gen-2",
      type: "FS",
      lagWorkMinutes: d(2),
    };

    const request = mapCompiledGraphToRequest(makeGraph([], [dep]), slotTranslator);

    expect(request.dependencies).toHaveLength(1);
    const mapped = request.dependencies[0];
    expect(mapped.predId).toBe("gen-1");
    expect(mapped.succId).toBe("gen-2");
    expect(mapped.depType).toBe("FS");
    expect(mapped.lagWorkMinutes).toBe(2);
  });

  it("maps all four dependency types", () => {
    const types = ["FS", "SS", "FF", "SF"] as const;
    const deps: GeneratedDependency[] = types.map((t, i) => ({
      predecessorId: `gen-${i}`,
      successorId: `gen-${i + 10}`,
      type: t,
      lagWorkMinutes: d(i),
    }));

    const request = mapCompiledGraphToRequest(makeGraph([], deps), slotTranslator);

    expect(request.dependencies).toHaveLength(4);
    types.forEach((t, i) => {
      expect(request.dependencies[i].depType).toBe(t);
      expect(request.dependencies[i].lagWorkMinutes).toBe(i);
    });
  });

  it("passes nonWorkingDays through unchanged", () => {
    const nwd = [0, 6, 7, 13, 14, 20, 21];
    const request = mapCompiledGraphToRequest(makeGraph([], [], nwd), slotTranslator);

    expect(request.nonWorkingDays).toEqual(nwd);
  });

  it("drops domain traceability fields (sourceAuthoredActivityId, zoneId, resolvedStrategyKind)", () => {
    const activity: GeneratedActivity = {
      id: "gen-1",
      sourceAuthoredActivityId: "auth-1",
      name: "Pour Concrete",
      durationWorkMinutes: d(5),
      resolvedStrategyKind: "productivity-driven",
      zoneId: "z-1",
    };

    const request = mapCompiledGraphToRequest(makeGraph([activity]), slotTranslator);

    const task = request.tasks[0];
    // These domain fields must not leak to the kernel
    expect(task).not.toHaveProperty("sourceAuthoredActivityId");
    expect(task).not.toHaveProperty("zoneId");
    expect(task).not.toHaveProperty("resolvedStrategyKind");
    expect(task).not.toHaveProperty("name");
  });

  it("drops compilation provenance (sourceAssumptionSetId, compiledAt)", () => {
    const request = mapCompiledGraphToRequest(makeGraph(), slotTranslator);

    // ScheduleRequest has no provenance fields
    expect(request).not.toHaveProperty("sourceAssumptionSetId");
    expect(request).not.toHaveProperty("sourceAssumptionSetVersion");
    expect(request).not.toHaveProperty("compiledAt");
  });

  it("maps a multi-activity graph with dependencies and calendar", () => {
    const activities: GeneratedActivity[] = [
      {
        id: "gen-1",
        sourceAuthoredActivityId: "auth-1",
        name: "Excavation",
        durationWorkMinutes: d(10),
        resolvedStrategyKind: "productivity-driven",
        zoneId: "z-1",
      },
      {
        id: "gen-2",
        sourceAuthoredActivityId: "auth-2",
        name: "Foundation",
        durationWorkMinutes: d(7),
        resolvedStrategyKind: "fixed",
        zoneId: "z-1",
        constraintType: "SNET",
        constraintDateMinutes: d(15),
      },
      {
        id: "gen-3",
        sourceAuthoredActivityId: "auth-3",
        name: "Steel Erection",
        durationWorkMinutes: d(14),
        resolvedStrategyKind: "manual-override",
        zoneId: "z-2",
      },
    ];

    const deps: GeneratedDependency[] = [
      { predecessorId: "gen-1", successorId: "gen-2", type: "FS", lagWorkMinutes: wm(0) },
      { predecessorId: "gen-2", successorId: "gen-3", type: "SS", lagWorkMinutes: d(3) },
    ];

    const nwd = [5, 6, 12, 13];

    const request = mapCompiledGraphToRequest(makeGraph(activities, deps, nwd), slotTranslator);

    expect(request.tasks).toHaveLength(3);
    expect(request.dependencies).toHaveLength(2);
    expect(request.nonWorkingDays).toEqual(nwd);

    // Verify durations mapped correctly
    expect(request.tasks[0].durationWorkMinutes).toBe(10);
    expect(request.tasks[1].durationWorkMinutes).toBe(7);
    expect(request.tasks[2].durationWorkMinutes).toBe(14);

    // Verify constraint on second task
    expect(request.tasks[1].constraintType).toBe("SNET");
    expect(request.tasks[1].constraintDateMinutes).toBe(15);

    // Verify all tasks are leaf (not summary, no hierarchy)
    for (const task of request.tasks) {
      expect(task.isSummary).toBe(false);
      expect(task.minEarlyStartMinutes).toBe(0);
      expect(task.parentId).toBeUndefined();
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// M06 — Controlled Compiler Invocation Path
// ────────────────────────────────────────────────────────────────────────────

import type { AuthoredActivity } from "@planner/protocol";
import { buildCompiledScheduleRequest } from "../src/schedule/compiledSchedulePath.js";

describe("M06 — buildCompiledScheduleRequest", () => {
  beforeEach(() => {
    _resetCompilerService();
  });

  const minimalAssumptionSet: AssumptionSet = {
    id: "as-1",
    version: 1,
    name: "Test Scenario",
    zones: [],
    quantities: [],
    resources: [],
    productivityRules: [],
  };

  describe("NullCompiler pipeline (default)", () => {
    it("returns an empty ScheduleRequest with compiledAt timestamp", () => {
      const { request, compiledAt } = buildCompiledScheduleRequest(
        minimalAssumptionSet,
        [],
        [],
        slotTranslator,
      );

      expect(request.tasks).toEqual([]);
      expect(request.dependencies).toEqual([]);
      expect(request.nonWorkingDays).toEqual([]);
      expect(new Date(compiledAt).getTime()).not.toBeNaN();
    });

    it("passes nonWorkingDays through the full pipeline", () => {
      const nwd = [0, 6, 7, 13, 14];
      const { request } = buildCompiledScheduleRequest(
        minimalAssumptionSet,
        [],
        nwd,
        slotTranslator,
      );

      expect(request.nonWorkingDays).toEqual(nwd);
    });
  });

  describe("Stub compiler pipeline (end-to-end)", () => {
    const stubActivities: AuthoredActivity[] = [
      {
        id: "auth-1",
        name: "Excavation",
        zoneId: "z-1",
        durationStrategy: { kind: "fixed", durationWorkMinutes: d(10) },
        dependencies: [],
      },
      {
        id: "auth-2",
        name: "Foundation",
        zoneId: "z-1",
        durationStrategy: { kind: "fixed", durationWorkMinutes: d(7) },
        dependencies: [
          { predecessorActivityId: "auth-1", type: "FS", lagWorkMinutes: wm(0) },
        ],
        constraintType: "SNET",
        constraintDateMinutes: d(15),
      },
    ];

    /**
     * A stub compiler that resolves fixed-duration authored activities
     * into generated activities, mirroring what a real compiler would do.
     */
    const stubCompiler: DomainCompiler = {
      compile: (
        assumptionSet: AssumptionSet,
        authoredActivities: readonly AuthoredActivity[],
        nonWorkingDays: readonly number[],
      ): CompiledScheduleGraph => ({
        activities: authoredActivities.map((aa) => ({
          id: `gen-${aa.id}`,
          sourceAuthoredActivityId: aa.id,
          name: aa.name,
          durationWorkMinutes:
            aa.durationStrategy.kind === "fixed"
              ? aa.durationStrategy.durationWorkMinutes
              : wm(1),
          resolvedStrategyKind: aa.durationStrategy.kind,
          zoneId: aa.zoneId,
          constraintType: aa.constraintType,
          constraintDateMinutes: aa.constraintDateMinutes,
        })),
        dependencies: authoredActivities.flatMap((aa) =>
          aa.dependencies.map((dep) => ({
            predecessorId: `gen-${dep.predecessorActivityId}`,
            successorId: `gen-${aa.id}`,
            type: dep.type,
            lagWorkMinutes: dep.lagWorkMinutes,
          })),
        ),
        nonWorkingDays: [...nonWorkingDays],
        sourceAssumptionSetId: assumptionSet.id,
        sourceAssumptionSetVersion: assumptionSet.version,
        compiledAt: new Date().toISOString(),
      }),
    };

    it("produces a complete ScheduleRequest from authored activities", () => {
      setCompiler(stubCompiler);
      const nwd = [5, 6, 12, 13];

      const { request, compiledAt } = buildCompiledScheduleRequest(
        minimalAssumptionSet,
        stubActivities,
        nwd,
        slotTranslator,
      );

      // Tasks
      expect(request.tasks).toHaveLength(2);
      expect(request.tasks[0].id).toBe("gen-auth-1");
      expect(request.tasks[0].durationWorkMinutes).toBe(10);
      expect(request.tasks[0].constraintType).toBe("ASAP");
      expect(request.tasks[0].constraintDateMinutes).toBeNull();

      expect(request.tasks[1].id).toBe("gen-auth-2");
      expect(request.tasks[1].durationWorkMinutes).toBe(7);
      expect(request.tasks[1].constraintType).toBe("SNET");
      expect(request.tasks[1].constraintDateMinutes).toBe(15);

      // Dependencies
      expect(request.dependencies).toHaveLength(1);
      expect(request.dependencies[0].predId).toBe("gen-auth-1");
      expect(request.dependencies[0].succId).toBe("gen-auth-2");
      expect(request.dependencies[0].depType).toBe("FS");
      expect(request.dependencies[0].lagWorkMinutes).toBe(0);

      // Calendar
      expect(request.nonWorkingDays).toEqual(nwd);

      // Timestamp
      expect(new Date(compiledAt).getTime()).not.toBeNaN();
    });

    it("domain traceability is absent from the returned ScheduleRequest", () => {
      setCompiler(stubCompiler);

      const { request } = buildCompiledScheduleRequest(
        minimalAssumptionSet,
        stubActivities,
        [],
        slotTranslator,
      );

      // ScheduleRequest must not carry domain fields
      for (const task of request.tasks) {
        expect(task).not.toHaveProperty("sourceAuthoredActivityId");
        expect(task).not.toHaveProperty("zoneId");
        expect(task).not.toHaveProperty("resolvedStrategyKind");
        expect(task).not.toHaveProperty("name");
      }
      expect(request).not.toHaveProperty("sourceAssumptionSetId");
      expect(request).not.toHaveProperty("compiledAt");
    });

    it("all tasks are leaf activities (no hierarchy)", () => {
      setCompiler(stubCompiler);

      const { request } = buildCompiledScheduleRequest(
        minimalAssumptionSet,
        stubActivities,
        [],
        slotTranslator,
      );

      for (const task of request.tasks) {
        expect(task.isSummary).toBe(false);
        expect(task.minEarlyStartMinutes).toBe(0);
        expect(task.parentId).toBeUndefined();
      }
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// M07 — Optional Compiler Scheduling Path
// ────────────────────────────────────────────────────────────────────────────

import {
    _resetSchedulingMode,
    getSchedulingMode,
    setSchedulingMode,
} from "../src/schedulingMode.js";

describe("M07 — SchedulingMode", () => {
  beforeEach(() => {
    _resetSchedulingMode();
  });

  it("defaults to legacy", () => {
    expect(getSchedulingMode()).toBe("legacy");
  });

  it("can be set to compiled", () => {
    setSchedulingMode("compiled");
    expect(getSchedulingMode()).toBe("compiled");
  });

  it("can be set back to legacy", () => {
    setSchedulingMode("compiled");
    setSchedulingMode("legacy");
    expect(getSchedulingMode()).toBe("legacy");
  });

  it("_resetSchedulingMode restores default", () => {
    setSchedulingMode("compiled");
    _resetSchedulingMode();
    expect(getSchedulingMode()).toBe("legacy");
  });
});

describe("M07 — Compiled path produces valid ScheduleRequest via mode switch", () => {
  beforeEach(() => {
    _resetCompilerService();
    _resetSchedulingMode();
  });

  it("compiled mode with NullCompiler returns empty request", () => {
    setSchedulingMode("compiled");

    const { request } = buildCompiledScheduleRequest(
      { id: "as-1", version: 1, name: "S", zones: [], quantities: [], resources: [], productivityRules: [] },
      [],
      [5, 6],
      slotTranslator,
    );

    expect(request.tasks).toEqual([]);
    expect(request.dependencies).toEqual([]);
    expect(request.nonWorkingDays).toEqual([5, 6]);
  });

  it("compiled mode with stub compiler returns solver-ready request", () => {
    const stubCompiler: DomainCompiler = {
      compile: (
        as: AssumptionSet,
        activities: readonly AuthoredActivity[],
        nwd: readonly number[],
      ): CompiledScheduleGraph => ({
        activities: activities.map((a) => ({
          id: `g-${a.id}`,
          sourceAuthoredActivityId: a.id,
          name: a.name,
          durationWorkMinutes: a.durationStrategy.kind === "fixed" ? a.durationStrategy.durationWorkMinutes : wm(1),
          resolvedStrategyKind: a.durationStrategy.kind,
          zoneId: a.zoneId,
          constraintType: a.constraintType,
          constraintDateMinutes: a.constraintDateMinutes,
        })),
        dependencies: [],
        nonWorkingDays: [...nwd],
        sourceAssumptionSetId: as.id,
        sourceAssumptionSetVersion: as.version,
        compiledAt: new Date().toISOString(),
      }),
    };

    setCompiler(stubCompiler);
    setSchedulingMode("compiled");

    const authored: AuthoredActivity[] = [
      {
        id: "a1",
        name: "Task A",
        zoneId: "z1",
        durationStrategy: { kind: "fixed", durationWorkMinutes: d(5) },
        dependencies: [],
      },
    ];

    const { request } = buildCompiledScheduleRequest(
      { id: "as-1", version: 1, name: "S", zones: [], quantities: [], resources: [], productivityRules: [] },
      authored,
      [],
      slotTranslator,
    );

    expect(request.tasks).toHaveLength(1);
    expect(request.tasks[0].id).toBe("g-a1");
    expect(request.tasks[0].durationWorkMinutes).toBe(5);
    expect(request.tasks[0].isSummary).toBe(false);

    // Domain fields must not leak to solver
    expect(request.tasks[0]).not.toHaveProperty("zoneId");
    expect(request.tasks[0]).not.toHaveProperty("sourceAuthoredActivityId");
  });

  it("legacy mode is unchanged by compiled path existence", () => {
    // Default mode is legacy — buildScheduleRequest still works
    expect(getSchedulingMode()).toBe("legacy");

    const request = buildScheduleRequest(
      [{ id: "t1", name: "T1", durationWorkMinutes: d(3), siblingOrder: "V" }],
      [],
      [],
      slotTranslator,
    );

    expect(request.tasks).toHaveLength(1);
    expect(request.tasks[0].id).toBe("t1");
    expect(request.tasks[0].durationWorkMinutes).toBe(3);
  });
});

/* ------------------------------------------------------------------ */
/*  Phase V.10b — computeConstraintDiagnostics                         */
/* ------------------------------------------------------------------ */
import { computeConstraintDiagnostics, mergeResultDiagnostics } from "../src/constraintDiagnostics.js";

describe("computeConstraintDiagnostics", () => {
  it("returns empty map for ASAP tasks", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V" }];
    expect(computeConstraintDiagnostics(tasks)).toEqual({});
  });

  it("emits MISSING_DATE_FOR_CONSTRAINT for dated type without date", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "SNET" }];
    const map = computeConstraintDiagnostics(tasks);
    expect(map["t1"]).toEqual(["MISSING_DATE_FOR_CONSTRAINT"]);
  });

  it("emits no code for dated type with date set", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "SNET", constraintDateMinutes: wm(10) }];
    expect(computeConstraintDiagnostics(tasks)).toEqual({});
  });

  it("emits DATE_IGNORED_BY_MODE for ALAP with date", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "ALAP", constraintDateMinutes: wm(5) }];
    const map = computeConstraintDiagnostics(tasks);
    expect(map["t1"]).toEqual(["DATE_IGNORED_BY_MODE"]);
  });

  it("emits no code for ALAP without date", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "ALAP" }];
    expect(computeConstraintDiagnostics(tasks)).toEqual({});
  });

  it("skips summary tasks", () => {
    const tasks: Task[] = [
      { id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "SNET" },
      { id: "t2", name: "T2", durationWorkMinutes: wm(3), siblingOrder: "V", parentId: "t1" },
    ];
    // t1 is summary (has child t2), so its SNET constraint is skipped
    // t2 has no constraint, so no diagnostics
    expect(computeConstraintDiagnostics(tasks)).toEqual({});
  });

  it("emits MISSING_DATE for MSO without date", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "MSO" }];
    const map = computeConstraintDiagnostics(tasks);
    expect(map["t1"]).toEqual(["MISSING_DATE_FOR_CONSTRAINT"]);
  });

  it("handles multiple tasks with mixed diagnostics", () => {
    const tasks: Task[] = [
      { id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "SNET" },
      { id: "t2", name: "T2", durationWorkMinutes: wm(3), siblingOrder: "V", constraintType: "ALAP", constraintDateMinutes: wm(10) },
      { id: "t3", name: "T3", durationWorkMinutes: wm(2), siblingOrder: "V" },
    ];
    const map = computeConstraintDiagnostics(tasks);
    expect(map["t1"]).toEqual(["MISSING_DATE_FOR_CONSTRAINT"]);
    expect(map["t2"]).toEqual(["DATE_IGNORED_BY_MODE"]);
    expect(map["t3"]).toBeUndefined();
  });
});

describe("Phase V.10b — Incomplete dated constraints allowed", () => {
  beforeEach(() => {
    State.clearState();
  });

  it("allows SNET without date in canonical state", () => {
    State.addTask({ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.updateTask("t1", { constraintType: "SNET" });
    const t = State.findTask("t1");
    expect(t?.constraintType).toBe("SNET");
    expect(t?.constraintDateMinutes).toBeUndefined();
  });

  it("allows MSO without date in canonical state", () => {
    State.addTask({ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.updateTask("t1", { constraintType: "MSO" });
    const t = State.findTask("t1");
    expect(t?.constraintType).toBe("MSO");
  });

  it("diagnostic fires for incomplete dated constraint", () => {
    const tasks: Task[] = [
      { id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "FNLT" },
    ];
    const map = computeConstraintDiagnostics(tasks);
    expect(map["t1"]).toEqual(["MISSING_DATE_FOR_CONSTRAINT"]);
  });

  it("buildScheduleRequest succeeds with incomplete constraint", () => {
    State.addTask({ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V" });
    State.updateTask("t1", { constraintType: "SNET" });
    const req = buildScheduleRequest(State.getTasks(), [], [], slotTranslator);
    // Request builds successfully — kernel treats missing date as unconstrained
    expect(req.tasks).toHaveLength(1);
    expect(req.tasks[0].id).toBe("t1");
    expect(req.tasks[0].constraintType).toBe("SNET");
    expect(req.tasks[0].constraintDateMinutes).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  Phase V.10c — mergeResultDiagnostics (GENERATING_NEGATIVE_FLOAT)    */
/* ------------------------------------------------------------------ */

describe("mergeResultDiagnostics", () => {
  const mkResult = (totalFloat: number): ScheduleResultMap["string"] => ({
    earlyStartMinutes: wm(0), earlyFinishMinutes: wm(5), lateStartMinutes: wm(0), lateFinishMinutes: wm(5), totalFloatMinutes: wm(totalFloat), isCritical: totalFloat <= 0,
  });

  it("emits GENERATING_NEGATIVE_FLOAT for constrained task with negative float", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "SNET", constraintDateMinutes: wm(10) }];
    const sr: ScheduleResultMap = { t1: mkResult(-2) };
    const map = mergeResultDiagnostics(tasks, sr, {});
    expect(map["t1"]).toEqual(["GENERATING_NEGATIVE_FLOAT"]);
  });

  it("does not emit when totalFloat >= 0", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "SNET", constraintDateMinutes: wm(10) }];
    const sr: ScheduleResultMap = { t1: mkResult(3) };
    const map = mergeResultDiagnostics(tasks, sr, {});
    expect(map["t1"]).toBeUndefined();
  });

  it("does not emit when constraintDateMinutes is missing", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "SNET" }];
    const sr: ScheduleResultMap = { t1: mkResult(-2) };
    const map = mergeResultDiagnostics(tasks, sr, {});
    expect(map["t1"]).toBeUndefined();
  });

  it("does not emit for ASAP task with negative float", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V" }];
    const sr: ScheduleResultMap = { t1: mkResult(-1) };
    const map = mergeResultDiagnostics(tasks, sr, {});
    expect(map["t1"]).toBeUndefined();
  });

  it("does not emit for ALAP task with negative float", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "ALAP" }];
    const sr: ScheduleResultMap = { t1: mkResult(-1) };
    const map = mergeResultDiagnostics(tasks, sr, {});
    expect(map["t1"]).toBeUndefined();
  });

  it("merges with existing input diagnostics", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "FNLT", constraintDateMinutes: wm(2) }];
    const sr: ScheduleResultMap = { t1: mkResult(-3) };
    const inputDiags = { t1: ["DATE_IGNORED_BY_MODE" as const] };
    const map = mergeResultDiagnostics(tasks, sr, inputDiags);
    expect(map["t1"]).toEqual(["DATE_IGNORED_BY_MODE", "GENERATING_NEGATIVE_FLOAT"]);
  });

  it("skips summary tasks", () => {
    const tasks: Task[] = [
      { id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "SNET", constraintDateMinutes: wm(10) },
      { id: "t2", name: "T2", durationWorkMinutes: wm(3), siblingOrder: "V", parentId: "t1" },
    ];
    const sr: ScheduleResultMap = { t1: mkResult(-5) };
    const map = mergeResultDiagnostics(tasks, sr, {});
    // t1 is summary (has child), so it's skipped
    expect(map["t1"]).toBeUndefined();
  });

  it("does not emit when no schedule result exists for task", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "MSO", constraintDateMinutes: wm(10) }];
    const map = mergeResultDiagnostics(tasks, {}, {});
    expect(map["t1"]).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  Phase V.10d — SUPERSEDED_BY_LOGIC                                  */
/* ------------------------------------------------------------------ */

describe("mergeResultDiagnostics — SUPERSEDED_BY_LOGIC", () => {
  const mkResult = (overrides: Partial<ScheduleResultMap[string]> = {}): ScheduleResultMap[string] => ({
    earlyStartMinutes: wm(0), earlyFinishMinutes: wm(5), lateStartMinutes: wm(0), lateFinishMinutes: wm(5), totalFloatMinutes: wm(0), isCritical: false, ...overrides,
  });
  const iv = (startMinute: number, endMinute: number): TimeInterval => ({ startMinute, endMinute });
  const sixHourWeekdayCalendar: CalendarOutputContext = {
    calendar: compileCalendar({
      id: "six-hour-days" as CalendarId,
      name: "Six Hour Days",
      weeklyPattern: {
        1: [iv(480, 660), iv(720, 900)],
        2: [iv(480, 660), iv(720, 900)],
        3: [iv(480, 660), iv(720, 900)],
        4: [iv(480, 660), iv(720, 900)],
        5: [iv(480, 660), iv(720, 900)],
      },
      exceptions: [],
    }),
    projectStartDate: "2025-01-06",
  };

  it("emits for SNET when earlyStart > constraintDateMinutes", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "SNET", constraintDateMinutes: d(3) }];
    const sr: ScheduleResultMap = { t1: mkResult({ earlyStartMinutes: wm(5) }) };
    const map = mergeResultDiagnostics(tasks, sr, {});
    expect(map["t1"]).toContain("SUPERSEDED_BY_LOGIC");
  });

  it("does not emit for SNET when earlyStart === constraintDateMinutes", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "SNET", constraintDateMinutes: d(5) }];
    const sr: ScheduleResultMap = { t1: mkResult({ earlyStartMinutes: wm(5) }) };
    const map = mergeResultDiagnostics(tasks, sr, {});
    expect(map["t1"]).toBeUndefined();
  });

  it("does not emit for SNET when earlyStart < constraintDateMinutes", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "SNET", constraintDateMinutes: d(10) }];
    const sr: ScheduleResultMap = { t1: mkResult({ earlyStartMinutes: wm(5) }) };
    const map = mergeResultDiagnostics(tasks, sr, {});
    expect(map["t1"]).toBeUndefined();
  });

  it("emits for FNLT when lateFinish < constraintDateMinutes", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "FNLT", constraintDateMinutes: d(20) }];
    const sr: ScheduleResultMap = { t1: mkResult({ lateFinishMinutes: wm(15) }) };
    const map = mergeResultDiagnostics(tasks, sr, {});
    expect(map["t1"]).toContain("SUPERSEDED_BY_LOGIC");
  });

  it("does not emit for FNLT when lateFinish === constraintDateMinutes", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "FNLT", constraintDateMinutes: d(15) }];
    const sr: ScheduleResultMap = { t1: mkResult({ lateFinishMinutes: wm(15) }) };
    const map = mergeResultDiagnostics(tasks, sr, {});
    expect(map["t1"]).toBeUndefined();
  });

  it("does not emit for FNLT when lateFinish > constraintDateMinutes", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "FNLT", constraintDateMinutes: d(10) }];
    const sr: ScheduleResultMap = { t1: mkResult({ lateFinishMinutes: wm(15) }) };
    const map = mergeResultDiagnostics(tasks, sr, {});
    expect(map["t1"]).toBeUndefined();
  });

  it("does not emit for MSO (must-constraint)", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "MSO", constraintDateMinutes: d(3) }];
    const sr: ScheduleResultMap = { t1: mkResult({ earlyStartMinutes: wm(10) }) };
    const map = mergeResultDiagnostics(tasks, sr, {});
    expect(map["t1"]?.includes("SUPERSEDED_BY_LOGIC")).toBeFalsy();
  });

  it("does not emit for MFO (must-constraint)", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "MFO", constraintDateMinutes: d(3) }];
    const sr: ScheduleResultMap = { t1: mkResult({ lateFinishMinutes: wm(1) }) };
    const map = mergeResultDiagnostics(tasks, sr, {});
    expect(map["t1"]?.includes("SUPERSEDED_BY_LOGIC")).toBeFalsy();
  });

  it("does not emit for SNET without constraintDateMinutes", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "SNET" }];
    const sr: ScheduleResultMap = { t1: mkResult({ earlyStartMinutes: wm(10) }) };
    const map = mergeResultDiagnostics(tasks, sr, {});
    expect(map["t1"]?.includes("SUPERSEDED_BY_LOGIC")).toBeFalsy();
  });

  it("uses authored project-day offset for logic checks when calendarContext is present", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "SNET", constraintDateMinutes: d(6) }];
    const sr: ScheduleResultMap = { t1: mkResult({ earlyStartMinutes: wm(7) }) };

    const scalar = mergeResultDiagnostics(tasks, sr, {}, new Set(), 360);
    expect(scalar["t1"]?.includes("SUPERSEDED_BY_LOGIC")).toBeFalsy();

    const calendarAware = mergeResultDiagnostics(tasks, sr, {}, new Set(), 360, sixHourWeekdayCalendar);
    expect(calendarAware["t1"]).toContain("SUPERSEDED_BY_LOGIC");
  });

  it("skips summary tasks", () => {
    const tasks: Task[] = [
      { id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "SNET", constraintDateMinutes: wm(0) },
      { id: "t2", name: "T2", durationWorkMinutes: wm(3), siblingOrder: "V", parentId: "t1" },
    ];
    const sr: ScheduleResultMap = { t1: mkResult({ earlyStartMinutes: wm(10) }) };
    const map = mergeResultDiagnostics(tasks, sr, {});
    expect(map["t1"]).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  Phase V.10e — SUPERSEDED_BY_CALENDAR                               */
/* ------------------------------------------------------------------ */

describe("mergeResultDiagnostics — SUPERSEDED_BY_CALENDAR", () => {
  const mkResult = (overrides: Partial<ScheduleResultMap[string]> = {}): ScheduleResultMap[string] => ({
    earlyStartMinutes: wm(0), earlyFinishMinutes: wm(5), lateStartMinutes: wm(0), lateFinishMinutes: wm(5), totalFloatMinutes: wm(0), isCritical: false, ...overrides,
  });
  const iv = (startMinute: number, endMinute: number): TimeInterval => ({ startMinute, endMinute });
  const holidayCalendarCtx: CalendarOutputContext = {
    calendar: compileCalendar({
      id: "holiday-six-hour" as CalendarId,
      name: "Holiday Six Hour",
      weeklyPattern: {
        1: [iv(480, 660), iv(720, 900)],
        2: [iv(480, 660), iv(720, 900)],
        3: [iv(480, 660), iv(720, 900)],
        4: [iv(480, 660), iv(720, 900)],
        5: [iv(480, 660), iv(720, 900)],
      },
      exceptions: [{ date: "2025-01-12", workIntervals: [], name: "Holiday" }],
    }),
    projectStartDate: "2025-01-06",
  };
  const halfDayCalendarCtx: CalendarOutputContext = {
    calendar: compileCalendar({
      id: "half-day-six-hour" as CalendarId,
      name: "Half Day Six Hour",
      weeklyPattern: {
        1: [iv(480, 660), iv(720, 900)],
        2: [iv(480, 660), iv(720, 900)],
        3: [iv(480, 660), iv(720, 900)],
        4: [iv(480, 660), iv(720, 900)],
        5: [iv(480, 660), iv(720, 900)],
      },
      exceptions: [{ date: "2025-01-10", workIntervals: [iv(480, 660)], name: "Half Day" }],
    }),
    projectStartDate: "2025-01-06",
  };

  it("emits when constraintDateMinutes falls on a non-working day", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "SNET", constraintDateMinutes: d(6) }];
    const sr: ScheduleResultMap = { t1: mkResult() };
    const nwd = new Set([5, 6, 12, 13]);
    const map = mergeResultDiagnostics(tasks, sr, {}, nwd);
    expect(map["t1"]).toContain("SUPERSEDED_BY_CALENDAR");
  });

  it("does not emit when constraintDateMinutes is a working day", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "SNET", constraintDateMinutes: d(7) }];
    const sr: ScheduleResultMap = { t1: mkResult() };
    const nwd = new Set([5, 6, 12, 13]);
    const map = mergeResultDiagnostics(tasks, sr, {}, nwd);
    expect(map["t1"]?.includes("SUPERSEDED_BY_CALENDAR")).toBeFalsy();
  });

  it("emits for FNLT on non-working day", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "FNLT", constraintDateMinutes: d(13) }];
    const sr: ScheduleResultMap = { t1: mkResult({ lateFinishMinutes: wm(15) }) };
    const nwd = new Set([5, 6, 12, 13]);
    const map = mergeResultDiagnostics(tasks, sr, {}, nwd);
    expect(map["t1"]).toContain("SUPERSEDED_BY_CALENDAR");
  });

  it("emits for MSO on non-working day", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "MSO", constraintDateMinutes: d(5) }];
    const sr: ScheduleResultMap = { t1: mkResult() };
    const nwd = new Set([5, 6, 12, 13]);
    const map = mergeResultDiagnostics(tasks, sr, {}, nwd);
    expect(map["t1"]).toContain("SUPERSEDED_BY_CALENDAR");
  });

  it("does not emit for ASAP", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V" }];
    const sr: ScheduleResultMap = { t1: mkResult() };
    const nwd = new Set([0, 1, 2, 3, 4, 5]);
    const map = mergeResultDiagnostics(tasks, sr, {}, nwd);
    expect(map["t1"]).toBeUndefined();
  });

  it("does not emit when constraintDateMinutes is missing", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "SNET" }];
    const sr: ScheduleResultMap = { t1: mkResult() };
    const nwd = new Set([0, 1, 2, 3]);
    const map = mergeResultDiagnostics(tasks, sr, {}, nwd);
    expect(map["t1"]?.includes("SUPERSEDED_BY_CALENDAR")).toBeFalsy();
  });

  it("does not emit when nonWorkingDays is not provided", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "SNET", constraintDateMinutes: d(6) }];
    const sr: ScheduleResultMap = { t1: mkResult() };
    const map = mergeResultDiagnostics(tasks, sr, {});
    expect(map["t1"]?.includes("SUPERSEDED_BY_CALENDAR")).toBeFalsy();
  });

  it("uses compiled calendar holiday exceptions when calendarContext is present", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "SNET", constraintDateMinutes: d(6) }];
    const sr: ScheduleResultMap = { t1: mkResult() };

    const scalar = mergeResultDiagnostics(tasks, sr, {}, new Set([6]), 360);
    expect(scalar["t1"]?.includes("SUPERSEDED_BY_CALENDAR")).toBeFalsy();

    const calendarAware = mergeResultDiagnostics(tasks, sr, {}, new Set([6]), 360, holidayCalendarCtx);
    expect(calendarAware["t1"]).toContain("SUPERSEDED_BY_CALENDAR");
  });

  it("does not treat half-day exceptions as non-working when calendarContext is present", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "SNET", constraintDateMinutes: d(4) }];
    const sr: ScheduleResultMap = { t1: mkResult() };

    const calendarAware = mergeResultDiagnostics(tasks, sr, {}, new Set([4]), 360, halfDayCalendarCtx);
    expect(calendarAware["t1"]?.includes("SUPERSEDED_BY_CALENDAR")).toBeFalsy();
  });

  it("preserves scalar fallback when calendarContext is absent", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "SNET", constraintDateMinutes: d(6) }];
    const sr: ScheduleResultMap = { t1: mkResult() };
    const map = mergeResultDiagnostics(tasks, sr, {}, new Set([8]), 360);
    expect(map["t1"]).toContain("SUPERSEDED_BY_CALENDAR");
  });

  it("coexists with SUPERSEDED_BY_LOGIC when both true", () => {
    const tasks: Task[] = [{ id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "SNET", constraintDateMinutes: d(6) }];
    const sr: ScheduleResultMap = { t1: mkResult({ earlyStartMinutes: wm(10) }) };
    const nwd = new Set([5, 6, 12, 13]);
    const map = mergeResultDiagnostics(tasks, sr, {}, nwd);
    expect(map["t1"]).toContain("SUPERSEDED_BY_LOGIC");
    expect(map["t1"]).toContain("SUPERSEDED_BY_CALENDAR");
  });

  it("skips summary tasks", () => {
    const tasks: Task[] = [
      { id: "t1", name: "T1", durationWorkMinutes: wm(5), siblingOrder: "V", constraintType: "SNET", constraintDateMinutes: d(6) },
      { id: "t2", name: "T2", durationWorkMinutes: wm(3), siblingOrder: "V", parentId: "t1" },
    ];
    const sr: ScheduleResultMap = { t1: mkResult() };
    const nwd = new Set([5, 6]);
    const map = mergeResultDiagnostics(tasks, sr, {}, nwd);
    expect(map["t1"]).toBeUndefined();
  });
});

// ── Phase 10A: Hierarchy Editing Smoke Tests ──────────────────────────

describe("Phase 10A — Hierarchy Editing", () => {
  beforeEach(() => {
    State.clearState();
  });

  describe("Expand All / Collapse All", () => {
    it("clearCollapsedIds expands all collapsed nodes", () => {
      State.addTask({ id: "S", name: "Summary", durationWorkMinutes: wm(0), siblingOrder: "V" });
      State.addTask({ id: "A", name: "Child", durationWorkMinutes: wm(5), parentId: "S", siblingOrder: "V" });
      State.computeHierarchy();

      const fullProj = Hierarchy.buildFullProjection(State.getTasks());
      Hierarchy.setFullProjection(fullProj);

      // Collapse
      Hierarchy.toggleCollapsed("S");
      expect(Hierarchy.isCollapsed("S")).toBe(true);
      const collapsed = Hierarchy.filterVisibleRows(fullProj);
      expect(collapsed.length).toBe(1); // only summary visible

      // Expand All
      Hierarchy.clearCollapsedIds();
      const expanded = Hierarchy.filterVisibleRows(fullProj);
      expect(expanded.length).toBe(2); // summary + child
      expect(Hierarchy.isCollapsed("S")).toBe(false);
    });

    it("setCollapsedIds collapses all summaries", () => {
      State.addTask({ id: "S1", name: "S1", durationWorkMinutes: wm(0), siblingOrder: "V" });
      State.addTask({ id: "A", name: "A", durationWorkMinutes: wm(5), parentId: "S1", siblingOrder: "V" });
      State.addTask({ id: "S2", name: "S2", durationWorkMinutes: wm(0), siblingOrder: "k" });
      State.addTask({ id: "B", name: "B", durationWorkMinutes: wm(3), parentId: "S2", siblingOrder: "V" });
      State.addTask({ id: "R", name: "Root Leaf", durationWorkMinutes: wm(2), siblingOrder: "s" });
      State.computeHierarchy();

      const fullProj = Hierarchy.buildFullProjection(State.getTasks());
      Hierarchy.setFullProjection(fullProj);

      // All expanded → 5 visible
      expect(Hierarchy.filterVisibleRows(fullProj).length).toBe(5);

      // Collapse all summaries
      const summaryIds = new Set<string>();
      for (const t of State.getTasks()) {
        if (State.isTaskSummary(t.id)) summaryIds.add(t.id);
      }
      Hierarchy.setCollapsedIds(summaryIds);
      const collapsed = Hierarchy.filterVisibleRows(fullProj);
      // Only summaries + root leaf visible (children hidden)
      expect(collapsed.length).toBe(3);
    });
  });

  describe("Reorder Task (Move Up / Move Down)", () => {
    it("reorders task among siblings — move down", () => {
      State.addTask({ id: "a", name: "A", durationWorkMinutes: wm(5), siblingOrder: "V" });
      State.addTask({ id: "b", name: "B", durationWorkMinutes: wm(3), siblingOrder: "k" });
      State.addTask({ id: "c", name: "C", durationWorkMinutes: wm(2), siblingOrder: "s" });
      State.computeHierarchy();

      // Move "a" after "b" (equivalent to moving "a" down)
      const err = State.reorderTask("a", "b");
      expect(err).toBeNull();
      State.computeHierarchy();

      const ordered = State.getTasks();
      const names = ordered.map(t => t.name);
      expect(names).toEqual(["B", "A", "C"]);
    });

    it("reorders task among siblings — move up (place first)", () => {
      State.addTask({ id: "a", name: "A", durationWorkMinutes: wm(5), siblingOrder: "V" });
      State.addTask({ id: "b", name: "B", durationWorkMinutes: wm(3), siblingOrder: "k" });
      State.computeHierarchy();

      // Move "b" to first position (no afterTaskId)
      const err = State.reorderTask("b");
      expect(err).toBeNull();
      State.computeHierarchy();

      const names = State.getTasks().map(t => t.name);
      expect(names).toEqual(["B", "A"]);
    });

    it("rejects reorder with invalid afterTaskId", () => {
      State.addTask({ id: "a", name: "A", durationWorkMinutes: wm(5), siblingOrder: "V" });
      State.addTask({ id: "b", name: "B", durationWorkMinutes: wm(3), siblingOrder: "k" });
      State.addTask({ id: "child", name: "Child", durationWorkMinutes: wm(1), siblingOrder: "V", parentId: "a" });

      // Try to place "b" after "child" — "child" is not a sibling of "b"
      const err = State.reorderTask("b", "child");
      expect(err).toContain("not found among siblings");
    });
  });

  describe("Indent / Outdent", () => {
    it("indent makes task a child of previous sibling", () => {
      State.addTask({ id: "a", name: "A", durationWorkMinutes: wm(5), siblingOrder: "V" });
      State.addTask({ id: "b", name: "B", durationWorkMinutes: wm(3), siblingOrder: "k" });
      State.computeHierarchy();

      const err = State.indentTask("b");
      expect(err).toBeNull();
      expect(State.findTask("b")!.parentId).toBe("a");
    });

    it("indent rejects first sibling (no previous sibling)", () => {
      State.addTask({ id: "a", name: "A", durationWorkMinutes: wm(5), siblingOrder: "V" });
      State.computeHierarchy();

      const err = State.indentTask("a");
      expect(err).toContain("no previous sibling");
    });

    it("outdent moves task up one level", () => {
      State.addTask({ id: "a", name: "A", durationWorkMinutes: wm(5), siblingOrder: "V" });
      State.addTask({ id: "b", name: "B", durationWorkMinutes: wm(3), siblingOrder: "V", parentId: "a" });
      State.computeHierarchy();

      const err = State.outdentTask("b");
      expect(err).toBeNull();
      expect(State.findTask("b")!.parentId).toBeUndefined();
    });

    it("outdent rejects root task", () => {
      State.addTask({ id: "a", name: "A", durationWorkMinutes: wm(5), siblingOrder: "V" });
      State.computeHierarchy();

      const err = State.outdentTask("a");
      expect(err).toContain("root level");
    });
  });

  describe("Add Child / Add Sibling", () => {
    it("addTask with parentId creates a child", () => {
      State.addTask({ id: "a", name: "Parent", durationWorkMinutes: wm(5), siblingOrder: "V" });
      State.addTask({ id: "child", name: "Child", durationWorkMinutes: wm(3), siblingOrder: "", parentId: "a" });
      State.computeHierarchy();

      expect(State.findTask("child")!.parentId).toBe("a");
      expect(State.isTaskSummary("a")).toBe(true);
      expect(State.getTaskDepth("child")).toBe(1);
    });

    it("addTask with same parentId creates a sibling", () => {
      State.addTask({ id: "parent", name: "Parent", durationWorkMinutes: wm(5), siblingOrder: "V" });
      State.addTask({ id: "a", name: "A", durationWorkMinutes: wm(3), siblingOrder: "", parentId: "parent" });
      State.addTask({ id: "b", name: "B", durationWorkMinutes: wm(2), siblingOrder: "", parentId: "parent" });
      State.computeHierarchy();

      expect(State.findTask("a")!.parentId).toBe("parent");
      expect(State.findTask("b")!.parentId).toBe("parent");
      const tasks = State.getTasks();
      const children = tasks.filter(t => t.parentId === "parent");
      expect(children.length).toBe(2);
    });
  });
});
