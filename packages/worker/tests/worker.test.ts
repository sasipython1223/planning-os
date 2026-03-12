/**
 * Worker scheduling integration tests.
 * Tests the full pipeline: state → scheduling → result application.
 */

import type { Assignment, Dependency, Resource, ScheduleResultMap, Task } from "protocol";
import type { ScheduleError, ScheduleResponse } from "protocol/kernel";
import { isScheduleError } from "protocol/kernel";
import { beforeEach, describe, expect, it } from "vitest";
import * as UndoHistory from "../src/history.js";
import { computeResourceHistogram } from "../src/resourceHistogram.js";
import { rollupSummarySchedules } from "../src/rollupSummaries.js";
import { applyScheduleResult } from "../src/schedule/applyScheduleResult.js";
import { buildScheduleRequest } from "../src/schedule/buildScheduleRequest.js";
import * as State from "../src/state.js";
import { validateAssignment, validateAssignmentUpdate, validateDependency, validateResource, validateResourceUpdate, validateTask, validateTaskUpdate } from "../src/validation.js";

describe("Worker State", () => {
  beforeEach(() => {
    State.clearState();
  });

  it("should add and retrieve tasks", () => {
    const task: Task = { id: "task1", name: "Task 1", duration: 5, depth: 0, isSummary: false };
    State.addTask(task);

    expect(State.getTasks()).toHaveLength(1);
    expect(State.findTask("task1")).toEqual(task);
  });

  it("should update task properties", () => {
    const task: Task = { id: "task1", name: "Task 1", duration: 5, depth: 0, isSummary: false };
    State.addTask(task);

    State.updateTask("task1", { name: "Updated Task", duration: 10 });

    const updated = State.findTask("task1");
    expect(updated?.name).toBe("Updated Task");
    expect(updated?.duration).toBe(10);
  });

  it("should add and retrieve dependencies", () => {
    const dep: Dependency = { id: "dep1", predId: "A", succId: "B", type: "FS", lag: 0 };
    State.addDependency(dep);

    expect(State.getDependencies()).toHaveLength(1);
    expect(State.findDependency("A", "B")).toEqual(dep);
  });

  it("should create snapshot with deep copies", () => {
    const taskA: Task = { id: "A", name: "Task A", duration: 5, depth: 0, isSummary: false };
    const taskB: Task = { id: "B", name: "Task B", duration: 3, depth: 0, isSummary: false };
    const dep: Dependency = { id: "dep1", predId: "A", succId: "B", type: "FS", lag: 0 };

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
    State.addTask({ id: "A", name: "Task A", duration: 5, depth: 0, isSummary: false });
    State.addTask({ id: "B", name: "Task B", duration: 3, depth: 0, isSummary: false });

    const snapshot = State.createSnapshot();

    // Mutate state
    State.addTask({ id: "C", name: "Task C", duration: 2, depth: 0, isSummary: false });
    State.updateTask("A", { duration: 10 });

    expect(State.getTasks()).toHaveLength(3);
    expect(State.findTask("A")?.duration).toBe(10);

    // Restore
    State.restoreSnapshot(snapshot);

    expect(State.getTasks()).toHaveLength(2);
    expect(State.findTask("A")?.duration).toBe(5);
    expect(State.findTask("C")).toBeUndefined();
  });
});

describe("Validation", () => {
  beforeEach(() => {
    State.clearState();
  });

  it("should reject empty task names", () => {
    const task: Task = { id: "task1", name: "", duration: 5, depth: 0, isSummary: false };
    const error = validateTask(task);

    expect(error).toBe("Task name must not be empty");
  });

  it("should reject zero or negative duration", () => {
    const task: Task = { id: "task1", name: "Task", duration: 0, depth: 0, isSummary: false };
    const error = validateTask(task);

    expect(error).toBe("Task duration must be greater than 0");
  });

  it("should reject self-dependencies", () => {
    State.addTask({ id: "A", name: "Task A", duration: 5, depth: 0, isSummary: false });
    const dep: Dependency = { id: "dep1", predId: "A", succId: "A", type: "FS", lag: 0 };
    const error = validateDependency(dep);

    expect(error).toBe("Dependency cannot point to itself");
  });

  it("should reject dependencies with missing tasks", () => {
    State.addTask({ id: "A", name: "Task A", duration: 5, depth: 0, isSummary: false });
    const dep: Dependency = { id: "dep1", predId: "A", succId: "B", type: "FS", lag: 0 };
    const error = validateDependency(dep);

    expect(error).toContain("Successor task B does not exist");
  });
});

describe("Schedule Request Builder", () => {
  it("should build request for single task", () => {
    const tasks: Task[] = [{ id: "A", name: "Task A", duration: 5, depth: 0, isSummary: false }];
    const dependencies: Dependency[] = [];

    const request = buildScheduleRequest(tasks, dependencies, []);

    expect(request.tasks).toHaveLength(1);
    expect(request.tasks[0]).toEqual({ id: "A", duration: 5, minEarlyStart: 0, parentId: undefined, isSummary: false });
    expect(request.dependencies).toHaveLength(0);
  });

  it("should build request for simple chain", () => {
    const tasks: Task[] = [
      { id: "A", name: "Task A", duration: 3, depth: 0, isSummary: false },
      { id: "B", name: "Task B", duration: 5, depth: 0, isSummary: false },
    ];
    const dependencies: Dependency[] = [
      { id: "dep1", predId: "A", succId: "B", type: "FS", lag: 0 },
    ];

    const request = buildScheduleRequest(tasks, dependencies, []);

    expect(request.tasks).toHaveLength(2);
    expect(request.dependencies).toHaveLength(1);
    expect(request.dependencies[0]).toEqual({ predId: "A", succId: "B", depType: "FS", lag: 0 });
  });

  it("should pass all dependency types through", () => {
    const tasks: Task[] = [
      { id: "A", name: "Task A", duration: 3, depth: 0, isSummary: false },
      { id: "B", name: "Task B", duration: 5, depth: 0, isSummary: false },
    ];
    const dependencies: Dependency[] = [
      { id: "dep1", predId: "A", succId: "B", type: "FS", lag: 0 },
      { id: "dep2", predId: "A", succId: "B", type: "SS", lag: 2 },
    ];

    const request = buildScheduleRequest(tasks, dependencies, []);

    expect(request.dependencies).toHaveLength(2);
    expect(request.dependencies[0]).toEqual({ predId: "A", succId: "B", depType: "FS", lag: 0 });
    expect(request.dependencies[1]).toEqual({ predId: "A", succId: "B", depType: "SS", lag: 2 });
  });
});

describe("Schedule Result Application", () => {
  it("should convert ScheduleResponse to result map", () => {
    const response: ScheduleResponse = {
      scheduleVersion: 1,
      results: [
        { taskId: "A", earlyStart: 0, earlyFinish: 5, lateStart: 0, lateFinish: 5, totalFloat: 0, isCritical: true },
        { taskId: "B", earlyStart: 5, earlyFinish: 10, lateStart: 5, lateFinish: 10, totalFloat: 0, isCritical: true },
      ],
    };

    const resultMap = applyScheduleResult(response);

    expect(resultMap["A"]).toEqual({ earlyStart: 0, earlyFinish: 5, lateStart: 0, lateFinish: 5, totalFloat: 0, isCritical: true });
    expect(resultMap["B"]).toEqual({ earlyStart: 5, earlyFinish: 10, lateStart: 5, lateFinish: 10, totalFloat: 0, isCritical: true });
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
    State.addTask({ id: "A", name: "Task A", duration: 5, depth: 0, isSummary: false });
    State.addTask({ id: "B", name: "Task B", duration: 3, depth: 0, isSummary: false });
    State.addDependency({ id: "dep1", predId: "A", succId: "B", type: "FS", lag: 0 });

    const validSnapshot = State.createSnapshot();

    // Simulate attempted mutation that would create cycle: B → A
    const cycleSnapshot = State.createSnapshot();
    State.addDependency({ id: "dep2", predId: "B", succId: "A", type: "FS", lag: 0 });

    // Build request and run scheduling
    const request = buildScheduleRequest(State.getTasks(), State.getDependencies(), []);
    
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
    State.addTask({ id: "A", name: "Task A", duration: 5, depth: 0, isSummary: false });
    State.addTask({ id: "B", name: "Task B", duration: 3, depth: 0, isSummary: false });
    State.addTask({ id: "C", name: "Task C", duration: 2, depth: 0, isSummary: false });

    // Add valid chain: A → B
    State.addDependency({ id: "dep1", predId: "A", succId: "B", type: "FS", lag: 0 });

    const snapshot = State.createSnapshot();

    // Add another valid dependency: B → C (extends chain)
    State.addDependency({ id: "dep2", predId: "B", succId: "C", type: "FS", lag: 0 });

    const request = buildScheduleRequest(State.getTasks(), State.getDependencies(), []);

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
    State.addTask({ id: "A", name: "Task A", duration: 5, depth: 0, isSummary: false });
    
    const snapshot = State.createSnapshot();

    // Attempt to set invalid duration (would fail validation earlier, but testing rollback)
    // In real scenario, this could be a duration that causes numeric overflow
    State.updateTask("A", { duration: 999999 });

    const taskA = State.findTask("A");
    expect(taskA?.duration).toBe(999999);

    // Simulate scheduling failure detection
    const schedulingFailed = taskA!.duration > 100000; // Arbitrary large number

    if (schedulingFailed) {
      State.restoreSnapshot(snapshot);
    }

    // Verify rollback
    const restoredTask = State.findTask("A");
    expect(restoredTask?.duration).toBe(5);
  });

  it("should handle rollback of dependency to missing task", () => {
    // Edge case: dependency added before validation (shouldn't happen with current validation)
    State.addTask({ id: "A", name: "Task A", duration: 5, depth: 0, isSummary: false });

    const snapshot = State.createSnapshot();

    // Malformed state: dependency to non-existent task
    State.addDependency({ id: "dep1", predId: "A", succId: "NonExistent", type: "FS", lag: 0 });

    const request = buildScheduleRequest(State.getTasks(), State.getDependencies(), []);

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
    State.addTask({ id: "A", name: "Task A", duration: 5, depth: 0, isSummary: false });
    State.addTask({ id: "B", name: "Task B", duration: 3, depth: 0, isSummary: false });
    State.addDependency({ id: "dep1", predId: "A", succId: "B", type: "FS", lag: 0 });

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
    State.addTask({ id: "A", name: "Task A", duration: 5, depth: 0, isSummary: false });
    State.addTask({ id: "B", name: "Task B", duration: 3, depth: 0, isSummary: false });
    State.addTask({ id: "C", name: "Task C", duration: 2, depth: 0, isSummary: false });
    State.addDependency({ id: "dep1", predId: "A", succId: "B", type: "FS", lag: 0 });
    State.addDependency({ id: "dep2", predId: "B", succId: "C", type: "FS", lag: 0 });
    State.addDependency({ id: "dep3", predId: "A", succId: "C", type: "FS", lag: 0 });

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
    State.addTask({ id: "A", name: "Task A", duration: 5, depth: 0, isSummary: false });
    State.addTask({ id: "B", name: "Task B", duration: 3, depth: 0, isSummary: false });
    State.addTask({ id: "C", name: "Task C", duration: 2, depth: 0, isSummary: false });
    State.addDependency({ id: "dep1", predId: "A", succId: "B", type: "FS", lag: 0 });
    State.addDependency({ id: "dep2", predId: "B", succId: "C", type: "FS", lag: 0 });

    State.deleteTask("B");

    // Remaining deps should only reference existing tasks
    const taskIds = new Set(State.getTasks().map(t => t.id));
    for (const dep of State.getDependencies()) {
      expect(taskIds.has(dep.predId)).toBe(true);
      expect(taskIds.has(dep.succId)).toBe(true);
    }
  });

  it("should find dependency by id", () => {
    State.addDependency({ id: "dep1", predId: "A", succId: "B", type: "FS", lag: 0 });
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
    State.addTask({ id: "A", name: "Original", duration: 7, depth: 0, isSummary: false });
    State.updateTask("A", { name: "Renamed" });

    const task = State.findTask("A");
    expect(task?.name).toBe("Renamed");
    expect(task?.duration).toBe(7);
    expect(task?.id).toBe("A");
  });

  it("should update duration only and preserve name and id", () => {
    State.addTask({ id: "A", name: "Keep Me", duration: 5, depth: 0, isSummary: false });
    State.updateTask("A", { duration: 12 });

    const task = State.findTask("A");
    expect(task?.duration).toBe(12);
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
    const error = validateTaskUpdate("test-task", { duration: 0 });
    expect(error).toBe("Task duration must be greater than 0");
  });

  it("should reject negative duration via validation", () => {
    const error = validateTaskUpdate("test-task", { duration: -3 });
    expect(error).toBe("Task duration must be greater than 0");
  });

  it("should accept valid name-only update via validation", () => {
    const error = validateTaskUpdate("test-task", { name: "New Name" });
    expect(error).toBeNull();
  });

  it("should accept valid duration-only update via validation", () => {
    const error = validateTaskUpdate("test-task", { duration: 10 });
    expect(error).toBeNull();
  });
});

describe("minEarlyStart constraint", () => {
  beforeEach(() => {
    State.clearState();
  });

  it("should reject negative minEarlyStart via validation", () => {
    expect(validateTaskUpdate("test-task", { minEarlyStart: -1 })).toBe("minEarlyStart must not be negative");
  });

  it("should accept zero minEarlyStart via validation", () => {
    expect(validateTaskUpdate("test-task", { minEarlyStart: 0 })).toBeNull();
  });

  it("should accept positive minEarlyStart via validation", () => {
    expect(validateTaskUpdate("test-task", { minEarlyStart: 10 })).toBeNull();
  });

  it("should persist minEarlyStart on update", () => {
    State.addTask({ id: "t1", name: "Task1", duration: 5, depth: 0, isSummary: false });
    State.updateTask("t1", { minEarlyStart: 7 });
    const task = State.findTask("t1");
    expect(task?.minEarlyStart).toBe(7);
  });

  it("should preserve minEarlyStart on partial update", () => {
    State.addTask({ id: "t1", name: "Task1", duration: 5, minEarlyStart: 3, depth: 0, isSummary: false });
    State.updateTask("t1", { name: "Renamed" });
    const task = State.findTask("t1");
    expect(task?.minEarlyStart).toBe(3);
    expect(task?.name).toBe("Renamed");
  });

  it("should map minEarlyStart in buildScheduleRequest (defaults 0)", () => {
    const tasks: Task[] = [
      { id: "a", name: "A", duration: 5, depth: 0, isSummary: false },
      { id: "b", name: "B", duration: 3, minEarlyStart: 10, depth: 0, isSummary: false },
    ];
    const deps: Dependency[] = [];
    const req = buildScheduleRequest(tasks, deps, []);
    expect(req.tasks[0].minEarlyStart).toBe(0);
    expect(req.tasks[1].minEarlyStart).toBe(10);
  });

  it("should snapshot and restore minEarlyStart", () => {
    State.addTask({ id: "t1", name: "T1", duration: 5, minEarlyStart: 4, depth: 0, isSummary: false });
    const snapshot = State.createSnapshot();
    State.updateTask("t1", { minEarlyStart: 99 });
    expect(State.findTask("t1")?.minEarlyStart).toBe(99);
    State.restoreSnapshot(snapshot);
    expect(State.findTask("t1")?.minEarlyStart).toBe(4);
  });
});

describe("Hierarchy", () => {
  beforeEach(() => {
    State.clearState();
  });

  it("should compute depth and isSummary", () => {
    State.addTask({ id: "S", name: "Summary", duration: 0, depth: 0, isSummary: false });
    State.addTask({ id: "A", name: "Child A", duration: 5, parentId: "S", depth: 0, isSummary: false });
    State.addTask({ id: "B", name: "Child B", duration: 3, parentId: "S", depth: 0, isSummary: false });
    State.computeHierarchy();
    const s = State.findTask("S")!;
    const a = State.findTask("A")!;
    expect(s.isSummary).toBe(true);
    expect(s.depth).toBe(0);
    expect(a.isSummary).toBe(false);
    expect(a.depth).toBe(1);
  });

  it("should compute nested depth", () => {
    State.addTask({ id: "OS", name: "Outer", duration: 0, depth: 0, isSummary: false });
    State.addTask({ id: "IS", name: "Inner", duration: 0, parentId: "OS", depth: 0, isSummary: false });
    State.addTask({ id: "A", name: "Leaf", duration: 3, parentId: "IS", depth: 0, isSummary: false });
    State.computeHierarchy();
    expect(State.findTask("OS")!.depth).toBe(0);
    expect(State.findTask("IS")!.depth).toBe(1);
    expect(State.findTask("A")!.depth).toBe(2);
  });

  it("should delete subtree recursively", () => {
    State.addTask({ id: "S", name: "Summary", duration: 0, depth: 0, isSummary: false });
    State.addTask({ id: "A", name: "Child", duration: 5, parentId: "S", depth: 0, isSummary: false });
    State.addTask({ id: "X", name: "Standalone", duration: 3, depth: 0, isSummary: false });
    State.addDependency({ id: "d1", predId: "A", succId: "X", type: "FS", lag: 0 });
    State.deleteTaskRecursive("S");
    expect(State.getTasks()).toHaveLength(1);
    expect(State.findTask("X")).toBeDefined();
    expect(State.getDependencies()).toHaveLength(0);
  });

  it("should reject self-parent via validation", () => {
    State.addTask({ id: "A", name: "Task A", duration: 5, depth: 0, isSummary: false });
    const error = validateTaskUpdate("A", { parentId: "A" });
    expect(error).toBe("Task cannot be its own parent");
  });

  it("should reject hierarchy cycle via validation", () => {
    State.addTask({ id: "A", name: "Task A", duration: 5, parentId: "B", depth: 0, isSummary: false });
    State.addTask({ id: "B", name: "Task B", duration: 3, depth: 0, isSummary: false });
    const error = validateTaskUpdate("B", { parentId: "A" });
    expect(error).toBe("Setting this parent would create a hierarchy cycle");
  });

  it("should update parentId", () => {
    State.addTask({ id: "S", name: "Summary", duration: 0, depth: 0, isSummary: false });
    State.addTask({ id: "A", name: "Task A", duration: 5, depth: 0, isSummary: false });
    State.updateTask("A", { parentId: "S" });
    expect(State.findTask("A")!.parentId).toBe("S");
    State.updateTask("A", { parentId: null });
    expect(State.findTask("A")!.parentId).toBeUndefined();
  });

  it("should map parentId and isSummary in buildScheduleRequest", () => {
    const tasks: Task[] = [
      { id: "S", name: "Summary", duration: 0, depth: 0, isSummary: true },
      { id: "A", name: "Child", duration: 5, parentId: "S", depth: 1, isSummary: false },
    ];
    const req = buildScheduleRequest(tasks, [], []);
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
    State.addTask({ id: "GP", name: "Grandparent", duration: 1, depth: 0, isSummary: false });
    State.addTask({ id: "P", name: "Parent", duration: 1, parentId: "GP", depth: 0, isSummary: false });
    State.addTask({ id: "L", name: "Leaf", duration: 5, parentId: "P", depth: 0, isSummary: false });
    State.computeHierarchy();

    const sched: ScheduleResultMap = {
      "L": { earlyStart: 0, earlyFinish: 5, lateStart: 0, lateFinish: 5, totalFloat: 0, isCritical: true },
    };
    rollupSummarySchedules(State.getTasks(), sched);

    expect(sched["P"]).toBeDefined();
    expect(sched["P"].earlyStart).toBe(0);
    expect(sched["P"].earlyFinish).toBe(5);
    expect(sched["GP"]).toBeDefined();
    expect(sched["GP"].earlyStart).toBe(0);
    expect(sched["GP"].earlyFinish).toBe(5);

    // Simulate increased leaf duration
    const sched2: ScheduleResultMap = {
      "L": { earlyStart: 0, earlyFinish: 10, lateStart: 0, lateFinish: 10, totalFloat: 0, isCritical: true },
    };
    rollupSummarySchedules(State.getTasks(), sched2);

    expect(sched2["P"].earlyFinish).toBe(10);
    expect(sched2["GP"].earlyFinish).toBe(10);
  });

  it("old/new parent transfer: reparent shrinks old and expands new", () => {
    State.addTask({ id: "X", name: "Old Parent", duration: 1, depth: 0, isSummary: false });
    State.addTask({ id: "Y", name: "New Parent", duration: 1, depth: 0, isSummary: false });
    State.addTask({ id: "A", name: "Big Child", duration: 5, parentId: "X", depth: 0, isSummary: false });
    State.addTask({ id: "B", name: "Small Child", duration: 3, parentId: "X", depth: 0, isSummary: false });
    State.addTask({ id: "C", name: "Tiny Child", duration: 2, parentId: "Y", depth: 0, isSummary: false });
    State.computeHierarchy();

    const sched1: ScheduleResultMap = {
      "A": { earlyStart: 0, earlyFinish: 5, lateStart: 0, lateFinish: 5, totalFloat: 0, isCritical: true },
      "B": { earlyStart: 0, earlyFinish: 3, lateStart: 2, lateFinish: 5, totalFloat: 2, isCritical: false },
      "C": { earlyStart: 0, earlyFinish: 2, lateStart: 0, lateFinish: 2, totalFloat: 0, isCritical: true },
    };
    rollupSummarySchedules(State.getTasks(), sched1);

    expect(sched1["X"].earlyFinish).toBe(5);
    expect(sched1["Y"].earlyFinish).toBe(2);

    // Move A from X to Y
    State.updateTask("A", { parentId: "Y" });
    State.computeHierarchy();

    const sched2: ScheduleResultMap = {
      "A": { earlyStart: 0, earlyFinish: 5, lateStart: 0, lateFinish: 5, totalFloat: 0, isCritical: true },
      "B": { earlyStart: 0, earlyFinish: 3, lateStart: 2, lateFinish: 5, totalFloat: 2, isCritical: false },
      "C": { earlyStart: 0, earlyFinish: 2, lateStart: 0, lateFinish: 2, totalFloat: 0, isCritical: true },
    };
    rollupSummarySchedules(State.getTasks(), sched2);

    expect(sched2["X"].earlyFinish).toBe(3);
    expect(sched2["Y"].earlyFinish).toBe(5);
  });

  it("blanking: summary with no valid scheduled children has no schedule entry", () => {
    State.addTask({ id: "S", name: "Summary", duration: 1, depth: 0, isSummary: false });
    State.addTask({ id: "A", name: "Child", duration: 5, parentId: "S", depth: 0, isSummary: false });
    State.computeHierarchy();

    // No schedule entries for children → summary blanked
    const sched: ScheduleResultMap = {};
    rollupSummarySchedules(State.getTasks(), sched);

    expect(sched["S"]).toBeUndefined();
  });

  it("guard: summary task strips duration and minEarlyStart from updates", () => {
    State.addTask({ id: "S", name: "Summary", duration: 1, depth: 0, isSummary: false });
    State.addTask({ id: "A", name: "Child", duration: 5, parentId: "S", depth: 0, isSummary: false });
    State.computeHierarchy();

    expect(State.findTask("S")!.isSummary).toBe(true);

    // Simulate worker guard: strip physics fields before applying
    const updates: { duration?: number; minEarlyStart?: number; name?: string } = {
      duration: 99,
      minEarlyStart: 10,
      name: "Renamed",
    };
    if (State.findTask("S")!.isSummary) {
      delete updates.duration;
      delete updates.minEarlyStart;
    }
    State.updateTask("S", updates);

    expect(State.findTask("S")!.duration).toBe(1); // unchanged
    expect(State.findTask("S")!.minEarlyStart).toBeUndefined(); // unchanged
    expect(State.findTask("S")!.name).toBe("Renamed"); // name changed
  });

  it("mixed valid/invalid children: summary ignores invalid children", () => {
    State.addTask({ id: "S", name: "Summary", duration: 1, depth: 0, isSummary: false });
    State.addTask({ id: "A", name: "Valid", duration: 5, parentId: "S", depth: 0, isSummary: false });
    State.addTask({ id: "B", name: "Invalid", duration: 3, parentId: "S", depth: 0, isSummary: false });
    State.computeHierarchy();

    // Only A has valid schedule, B is unscheduled
    const sched: ScheduleResultMap = {
      "A": { earlyStart: 2, earlyFinish: 7, lateStart: 2, lateFinish: 7, totalFloat: 0, isCritical: true },
    };
    rollupSummarySchedules(State.getTasks(), sched);

    expect(sched["S"]).toBeDefined();
    expect(sched["S"].earlyStart).toBe(2);
    expect(sched["S"].earlyFinish).toBe(7);
  });

  it("empty summary with isSummary=false after computeHierarchy is not processed", () => {
    State.addTask({ id: "S", name: "Lone Task", duration: 5, depth: 0, isSummary: false });
    State.computeHierarchy();

    expect(State.findTask("S")!.isSummary).toBe(false);

    // Rollup should not touch non-summary tasks
    const sched: ScheduleResultMap = {
      "S": { earlyStart: 0, earlyFinish: 5, lateStart: 0, lateFinish: 5, totalFloat: 0, isCritical: true },
    };
    rollupSummarySchedules(State.getTasks(), sched);

    // Leaf task schedule is untouched
    expect(sched["S"].earlyStart).toBe(0);
    expect(sched["S"].earlyFinish).toBe(5);
  });

  it("drawGantt receives no schedule for empty summary (no ghost bracket)", () => {
    State.addTask({ id: "S", name: "Summary", duration: 1, depth: 0, isSummary: false });
    State.addTask({ id: "A", name: "Child", duration: 5, parentId: "S", depth: 0, isSummary: false });
    State.computeHierarchy();

    // Kernel returned a stale entry for summary — rollup should overwrite
    const sched: ScheduleResultMap = {
      "S": { earlyStart: 0, earlyFinish: 1, lateStart: 0, lateFinish: 1, totalFloat: 0, isCritical: false },
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
      { id: "A", name: "A", duration: 3, depth: 0, isSummary: false },
    ];
    const blocked = [5, 6, 12, 13];
    const req = buildScheduleRequest(tasks, [], blocked);
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
    State.addTask({ id: "P", name: "Parent", duration: 1, depth: 0, isSummary: false });
    State.addTask({ id: "C1", name: "Child 1", duration: 1, parentId: "P", depth: 0, isSummary: false });
    State.computeHierarchy();
    State.addTask({ id: "GC", name: "Grandchild", duration: 1, parentId: "C1", depth: 0, isSummary: false });
    State.computeHierarchy();
    State.addTask({ id: "D", name: "Root D", duration: 1, depth: 0, isSummary: false });

    // Now add a second child under P — should land after GC, before D
    State.computeHierarchy();
    State.addTask({ id: "C2", name: "Child 2", duration: 1, parentId: "P", depth: 0, isSummary: false });

    const ids = State.getTasks().map(t => t.id);
    expect(ids).toEqual(["P", "C1", "GC", "C2", "D"]);
  });

  it("appends child at end when parent is last in array", () => {
    State.addTask({ id: "A", name: "A", duration: 1, depth: 0, isSummary: false });
    State.addTask({ id: "P", name: "Parent", duration: 1, depth: 0, isSummary: false });
    State.computeHierarchy();
    State.addTask({ id: "C1", name: "Child 1", duration: 1, parentId: "P", depth: 0, isSummary: false });

    const ids = State.getTasks().map(t => t.id);
    expect(ids).toEqual(["A", "P", "C1"]);
  });

  it("descendants remain contiguous after insertion", () => {
    State.addTask({ id: "P", name: "Parent", duration: 1, depth: 0, isSummary: false });
    State.addTask({ id: "C1", name: "C1", duration: 1, parentId: "P", depth: 0, isSummary: false });
    State.computeHierarchy();
    State.addTask({ id: "C2", name: "C2", duration: 1, parentId: "P", depth: 0, isSummary: false });
    State.computeHierarchy();
    State.addTask({ id: "R", name: "Root", duration: 1, depth: 0, isSummary: false });

    // Add C3 under P — should be contiguous with C1 and C2
    State.computeHierarchy();
    State.addTask({ id: "C3", name: "C3", duration: 1, parentId: "P", depth: 0, isSummary: false });

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
    State.addTask({ id: "A", name: "A", duration: 1, depth: 0, isSummary: false });
    State.addTask({ id: "B", name: "B", duration: 1, depth: 0, isSummary: false });
    State.addTask({ id: "C", name: "C", duration: 1, depth: 0, isSummary: false });

    const ids = State.getTasks().map(t => t.id);
    expect(ids).toEqual(["A", "B", "C"]);
  });

  it("findInsertionIndexForParent returns end for unknown parent", () => {
    State.addTask({ id: "A", name: "A", duration: 1, depth: 0, isSummary: false });
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
    State.addTask({ id: "A", name: "A", duration: 5, depth: 0, isSummary: false });
    State.addTask({ id: "B", name: "B", duration: 3, depth: 0, isSummary: false });
    const dep: Dependency = { id: "dep1", predId: "A", succId: "B", type: "SS", lag: 2 };
    const error = validateDependency(dep);
    expect(error).toBeNull();
  });

  it("should accept FF dependency with negative lag", () => {
    State.addTask({ id: "A", name: "A", duration: 5, depth: 0, isSummary: false });
    State.addTask({ id: "B", name: "B", duration: 3, depth: 0, isSummary: false });
    const dep: Dependency = { id: "dep1", predId: "A", succId: "B", type: "FF", lag: -1 };
    const error = validateDependency(dep);
    expect(error).toBeNull();
  });

  it("should accept SF dependency with zero lag", () => {
    State.addTask({ id: "A", name: "A", duration: 5, depth: 0, isSummary: false });
    State.addTask({ id: "B", name: "B", duration: 3, depth: 0, isSummary: false });
    const dep: Dependency = { id: "dep1", predId: "A", succId: "B", type: "SF", lag: 0 };
    const error = validateDependency(dep);
    expect(error).toBeNull();
  });

  it("should reject invalid dependency type", () => {
    State.addTask({ id: "A", name: "A", duration: 5, depth: 0, isSummary: false });
    State.addTask({ id: "B", name: "B", duration: 3, depth: 0, isSummary: false });
    const dep: Dependency = { id: "dep1", predId: "A", succId: "B", type: "XX" as any, lag: 0 };
    const error = validateDependency(dep);
    expect(error).toBe("Invalid dependency type: XX");
  });

  it("should reject non-integer lag", () => {
    State.addTask({ id: "A", name: "A", duration: 5, depth: 0, isSummary: false });
    State.addTask({ id: "B", name: "B", duration: 3, depth: 0, isSummary: false });
    const dep: Dependency = { id: "dep1", predId: "A", succId: "B", type: "FS", lag: 1.5 };
    const error = validateDependency(dep);
    expect(error).toBe("Lag must be an integer");
  });
});

describe("Dependency Update Validation", () => {
  it("should accept valid type update", () => {
    expect(validateDependencyUpdate({ type: "SS" })).toBeNull();
  });

  it("should accept valid lag update", () => {
    expect(validateDependencyUpdate({ lag: -3 })).toBeNull();
  });

  it("should reject invalid type in update", () => {
    expect(validateDependencyUpdate({ type: "ZZ" as any })).toBe("Invalid dependency type: ZZ");
  });

  it("should reject non-integer lag in update", () => {
    expect(validateDependencyUpdate({ lag: 2.7 })).toBe("Lag must be an integer");
  });
});

describe("Update Dependency State", () => {
  beforeEach(() => {
    State.clearState();
  });

  it("should update dependency type", () => {
    State.addTask({ id: "A", name: "A", duration: 5, depth: 0, isSummary: false });
    State.addTask({ id: "B", name: "B", duration: 3, depth: 0, isSummary: false });
    State.addDependency({ id: "dep1", predId: "A", succId: "B", type: "FS", lag: 0 });

    const result = State.updateDependency("dep1", { type: "SS" });
    expect(result).toBe(true);
    expect(State.findDependencyById("dep1")?.type).toBe("SS");
  });

  it("should update dependency lag", () => {
    State.addTask({ id: "A", name: "A", duration: 5, depth: 0, isSummary: false });
    State.addTask({ id: "B", name: "B", duration: 3, depth: 0, isSummary: false });
    State.addDependency({ id: "dep1", predId: "A", succId: "B", type: "FS", lag: 0 });

    const result = State.updateDependency("dep1", { lag: 3 });
    expect(result).toBe(true);
    expect(State.findDependencyById("dep1")?.lag).toBe(3);
  });

  it("should update both type and lag", () => {
    State.addTask({ id: "A", name: "A", duration: 5, depth: 0, isSummary: false });
    State.addTask({ id: "B", name: "B", duration: 3, depth: 0, isSummary: false });
    State.addDependency({ id: "dep1", predId: "A", succId: "B", type: "FS", lag: 0 });

    State.updateDependency("dep1", { type: "FF", lag: -2 });
    const dep = State.findDependencyById("dep1");
    expect(dep?.type).toBe("FF");
    expect(dep?.lag).toBe(-2);
  });

  it("should return false for non-existent dependency", () => {
    expect(State.updateDependency("nope", { lag: 1 })).toBe(false);
  });

  it("should preserve other fields when updating type only", () => {
    State.addTask({ id: "A", name: "A", duration: 5, depth: 0, isSummary: false });
    State.addTask({ id: "B", name: "B", duration: 3, depth: 0, isSummary: false });
    State.addDependency({ id: "dep1", predId: "A", succId: "B", type: "FS", lag: 5 });

    State.updateDependency("dep1", { type: "SS" });
    const dep = State.findDependencyById("dep1");
    expect(dep?.type).toBe("SS");
    expect(dep?.lag).toBe(5); // lag preserved
    expect(dep?.predId).toBe("A"); // other fields preserved
  });
});

describe("BuildScheduleRequest with all dep types", () => {
  it("should map all four dependency types with lag", () => {
    const tasks: Task[] = [
      { id: "A", name: "A", duration: 3, depth: 0, isSummary: false },
      { id: "B", name: "B", duration: 5, depth: 0, isSummary: false },
    ];
    const deps: Dependency[] = [
      { id: "d1", predId: "A", succId: "B", type: "FS", lag: 0 },
      { id: "d2", predId: "A", succId: "B", type: "SS", lag: 2 },
      { id: "d3", predId: "A", succId: "B", type: "FF", lag: -1 },
      { id: "d4", predId: "A", succId: "B", type: "SF", lag: 3 },
    ];
    const req = buildScheduleRequest(tasks, deps, []);
    expect(req.dependencies).toHaveLength(4);
    expect(req.dependencies[0].depType).toBe("FS");
    expect(req.dependencies[1].depType).toBe("SS");
    expect(req.dependencies[1].lag).toBe(2);
    expect(req.dependencies[2].depType).toBe("FF");
    expect(req.dependencies[2].lag).toBe(-1);
    expect(req.dependencies[3].depType).toBe("SF");
    expect(req.dependencies[3].lag).toBe(3);
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
        { id: "A", name: "Alpha", duration: 5, depth: 0, isSummary: false },
        { id: "B", name: "Beta", duration: 3, depth: 0, isSummary: false },
      ],
      dependencies: [
        { id: "d1", predId: "A", succId: "B", type: "FS" as const, lag: 0 },
      ],
      baselines: { "A": { start: 0, finish: 5 } },
    };
    State.hydrateState(persisted);
    expect(State.getTasks()).toHaveLength(2);
    expect(State.getDependencies()).toHaveLength(1);
    expect(State.getProjectStartDate()).toBe("2025-06-01");
    expect(State.getExcludeWeekends()).toBe(false);
    expect(State.getBaselineMap()["A"]).toEqual({ start: 0, finish: 5 });
  });

  // Test 3: after hydration, recompute runs and produces valid schedule
  it("recompute after hydration produces valid schedule results", () => {
    State.hydrateState({
      projectStartDate: "2025-01-06",
      excludeWeekends: false,
      tasks: [
        { id: "A", name: "A", duration: 3, depth: 0, isSummary: false },
        { id: "B", name: "B", duration: 5, depth: 0, isSummary: false },
      ],
      dependencies: [
        { id: "d1", predId: "A", succId: "B", type: "FS" as const, lag: 0 },
      ],
      baselines: {},
    });
    State.computeHierarchy();

    const request = buildScheduleRequest(
      State.getTasks(),
      State.getDependencies(),
      [],
    );
    expect(request.tasks).toHaveLength(2);
    expect(request.dependencies).toHaveLength(1);
    expect(request.dependencies[0].depType).toBe("FS");
  });

  // Test 4: corrupted persistence falls back to empty state
  it("hydrateState with empty arrays yields empty state", () => {
    State.addTask({ id: "X", name: "Pre-existing", duration: 1, depth: 0, isSummary: false });
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
      tasks: [{ id: "A", name: "A", duration: 3, depth: 0, isSummary: false }],
      dependencies: [],
      baselines: {},
    });
    State.setLatestScheduleResults({
      "A": { earlyStart: 0, earlyFinish: 3, lateStart: 0, lateFinish: 3, totalFloat: 0, isCritical: true },
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
    State.addTask({ id: "A", name: "A", duration: 5, depth: 0, isSummary: false });
    State.addTask({ id: "B", name: "B", duration: 3, depth: 0, isSummary: false });
    State.addTask({ id: "C", name: "C", duration: 2, depth: 0, isSummary: false });
    State.addDependency({ id: "d1", predId: "A", succId: "B", type: "FS", lag: 0 });
    State.addDependency({ id: "d2", predId: "B", succId: "C", type: "FS", lag: 0 });
    State.setBaselineMap({ "A": { start: 0, finish: 5 }, "B": { start: 5, finish: 8 }, "C": { start: 8, finish: 10 } });

    State.deleteTask("B");

    expect(State.getBaselineMap()["B"]).toBeUndefined();
    expect(State.getDependencies()).toHaveLength(0); // d1 and d2 both removed (B was in both)
    expect(State.getBaselineMap()["A"]).toEqual({ start: 0, finish: 5 });
    expect(State.getBaselineMap()["C"]).toEqual({ start: 8, finish: 10 });
  });

  // Test 8: baselines survive hydration round-trip
  it("baselines survive persist/hydrate round-trip", () => {
    State.addTask({ id: "A", name: "A", duration: 5, depth: 0, isSummary: false });
    State.addTask({ id: "B", name: "B", duration: 3, depth: 0, isSummary: false });
    const baselines = { "A": { start: 0, finish: 5 }, "B": { start: 5, finish: 8 } };
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
    expect(State.getBaselineMap()["A"]).toEqual({ start: 0, finish: 5 });
    expect(State.getBaselineMap()["B"]).toEqual({ start: 5, finish: 8 });
  });

  // Test 9: SS/FF/SF dependencies survive hydration round-trip
  it("advanced dependency types survive persist/hydrate round-trip", () => {
    State.addTask({ id: "A", name: "A", duration: 5, depth: 0, isSummary: false });
    State.addTask({ id: "B", name: "B", duration: 3, depth: 0, isSummary: false });
    State.addDependency({ id: "d1", predId: "A", succId: "B", type: "SS", lag: 2 });
    State.addDependency({ id: "d2", predId: "A", succId: "B", type: "FF", lag: -1 });
    State.addDependency({ id: "d3", predId: "A", succId: "B", type: "SF", lag: 3 });

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
    expect(deps.find(d => d.id === "d1")?.lag).toBe(2);
    expect(deps.find(d => d.id === "d2")?.type).toBe("FF");
    expect(deps.find(d => d.id === "d2")?.lag).toBe(-1);
    expect(deps.find(d => d.id === "d3")?.type).toBe("SF");
    expect(deps.find(d => d.id === "d3")?.lag).toBe(3);
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
    State.addTask({ id: "S", name: "Summary", duration: 0, depth: 0, isSummary: false });
    State.addTask({ id: "C1", name: "Child 1", duration: 5, parentId: "S", depth: 0, isSummary: false });
    State.addTask({ id: "C2", name: "Child 2", duration: 3, parentId: "S", depth: 0, isSummary: false });
    State.addTask({ id: "X", name: "Standalone", duration: 2, depth: 0, isSummary: false });
    State.setBaselineMap({
      "S": { start: 0, finish: 5 },
      "C1": { start: 0, finish: 5 },
      "C2": { start: 0, finish: 3 },
      "X": { start: 0, finish: 2 },
    });

    State.deleteTaskRecursive("S");

    expect(State.getBaselineMap()["S"]).toBeUndefined();
    expect(State.getBaselineMap()["C1"]).toBeUndefined();
    expect(State.getBaselineMap()["C2"]).toBeUndefined();
    expect(State.getBaselineMap()["X"]).toEqual({ start: 0, finish: 2 });
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
      "A": { earlyStart: 0, earlyFinish: 5, lateStart: 0, lateFinish: 5, totalFloat: 0, isCritical: true },
    };
    const result = computeVariances(scheduleResults, {});
    expect(Object.keys(result)).toHaveLength(0);
  });

  // Test 2: computeVariances only emits entries for tasks that have baselines
  it("only emits entries for tasks with baselines", () => {
    const scheduleResults: ScheduleResultMap = {
      "A": { earlyStart: 0, earlyFinish: 5, lateStart: 0, lateFinish: 5, totalFloat: 0, isCritical: true },
      "B": { earlyStart: 5, earlyFinish: 10, lateStart: 5, lateFinish: 10, totalFloat: 0, isCritical: true },
    };
    const baselines = { "A": { start: 0, finish: 5 } };
    const result = computeVariances(scheduleResults, baselines);
    expect(Object.keys(result)).toEqual(["A"]);
    expect(result["B"]).toBeUndefined();
  });

  // Test 3: startVariance / finishVariance / durationVariance are computed correctly
  it("computes correct variance values", () => {
    const scheduleResults: ScheduleResultMap = {
      "A": { earlyStart: 2, earlyFinish: 9, lateStart: 2, lateFinish: 9, totalFloat: 0, isCritical: true },
    };
    const baselines = { "A": { start: 0, finish: 5 } };
    const result = computeVariances(scheduleResults, baselines);

    expect(result["A"].startVariance).toBe(2);    // 2 - 0
    expect(result["A"].finishVariance).toBe(4);    // 9 - 5
    expect(result["A"].durationVariance).toBe(2);  // (9-2)=7 vs (5-0)=5 → 2
  });

  // Test 3b: zero variance when baseline matches live
  it("returns zero variance when baseline matches live schedule", () => {
    const scheduleResults: ScheduleResultMap = {
      "A": { earlyStart: 0, earlyFinish: 5, lateStart: 0, lateFinish: 5, totalFloat: 0, isCritical: true },
    };
    const baselines = { "A": { start: 0, finish: 5 } };
    const result = computeVariances(scheduleResults, baselines);

    expect(result["A"].startVariance).toBe(0);
    expect(result["A"].finishVariance).toBe(0);
    expect(result["A"].durationVariance).toBe(0);
  });

  // Test 3c: negative variance (task is ahead of baseline)
  it("computes negative variance when task is ahead of baseline", () => {
    const scheduleResults: ScheduleResultMap = {
      "A": { earlyStart: 0, earlyFinish: 3, lateStart: 0, lateFinish: 3, totalFloat: 0, isCritical: true },
    };
    const baselines = { "A": { start: 2, finish: 7 } };
    const result = computeVariances(scheduleResults, baselines);

    expect(result["A"].startVariance).toBe(-2);     // 0 - 2
    expect(result["A"].finishVariance).toBe(-4);     // 3 - 7
    expect(result["A"].durationVariance).toBe(-2);   // (3-0)=3 vs (7-2)=5 → -2
  });

  // Test 4: variance is recomputed after schedule changes
  it("variance changes when schedule results change", () => {
    const baselines = { "A": { start: 0, finish: 5 } };

    const before: ScheduleResultMap = {
      "A": { earlyStart: 0, earlyFinish: 5, lateStart: 0, lateFinish: 5, totalFloat: 0, isCritical: true },
    };
    const v1 = computeVariances(before, baselines);
    expect(v1["A"].startVariance).toBe(0);
    expect(v1["A"].finishVariance).toBe(0);

    const after: ScheduleResultMap = {
      "A": { earlyStart: 2, earlyFinish: 10, lateStart: 2, lateFinish: 10, totalFloat: 0, isCritical: true },
    };
    const v2 = computeVariances(after, baselines);
    expect(v2["A"].startVariance).toBe(2);
    expect(v2["A"].finishVariance).toBe(5);
  });

  // Test 5: variance is present in DIFF_STATE payload shape
  it("DIFF_STATE payload includes variances field", () => {
    const scheduleResults: ScheduleResultMap = {
      "A": { earlyStart: 0, earlyFinish: 5, lateStart: 0, lateFinish: 5, totalFloat: 0, isCritical: true },
    };
    const baselines = { "A": { start: 0, finish: 5 } };
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
      startVariance: 0,
      finishVariance: 0,
      durationVariance: 0,
    });
  });

  // Test 6: variance is recomputed after hydration
  it("variance recomputes after hydration with baselines", () => {
    State.hydrateState({
      projectStartDate: "2025-01-06",
      excludeWeekends: false,
      tasks: [
        { id: "A", name: "A", duration: 5, depth: 0, isSummary: false },
      ],
      dependencies: [],
      baselines: { "A": { start: 0, finish: 5 } },
    });

    // Simulate post-hydration schedule
    const scheduleResults: ScheduleResultMap = {
      "A": { earlyStart: 0, earlyFinish: 5, lateStart: 0, lateFinish: 5, totalFloat: 0, isCritical: true },
    };
    const variances = computeVariances(scheduleResults, State.getBaselineMap());

    expect(variances["A"]).toEqual({
      startVariance: 0,
      finishVariance: 0,
      durationVariance: 0,
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
        tasks: [{ id: "A", name: "A", duration: 5, depth: 0, isSummary: false }],
        dependencies: [],
        baselines: { "A": { start: 0, finish: 5 } },
      },
    };

    expect((persistedState.state as any).variances).toBeUndefined();
    expect((persistedState.state as any).scheduleResults).toBeUndefined();
  });

  // Test: skips tasks that have baseline but no live schedule
  it("skips tasks with baseline but no schedule result", () => {
    const scheduleResults: ScheduleResultMap = {};
    const baselines = { "A": { start: 0, finish: 5 } };
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
    State.addTask({ id: "A", name: "Task A", duration: 5, depth: 0, isSummary: false });

    const cmd = { type: "UPDATE_TASK" as const, v: 1 as const, reqId: "r1", taskId: "A", updates: { duration: 10 } };
    const entry = UndoHistory.buildHistoryEntry(cmd);
    expect(entry).not.toBeNull();

    // Apply forward mutation
    State.updateTask("A", { duration: 10 });
    expect(State.findTask("A")!.duration).toBe(10);

    // Apply undo transaction
    UndoHistory.pushEntry(entry!);
    const undoEntry = UndoHistory.popUndo();
    for (const c of undoEntry!.undo) {
      if (c.type === "UPDATE_TASK") State.updateTask(c.taskId, c.updates);
    }
    expect(State.findTask("A")!.duration).toBe(5);
  });

  it("redo reapplies UPDATE_TASK change", () => {
    State.addTask({ id: "A", name: "Task A", duration: 5, depth: 0, isSummary: false });

    const cmd = { type: "UPDATE_TASK" as const, v: 1 as const, reqId: "r1", taskId: "A", updates: { duration: 10 } };
    const entry = UndoHistory.buildHistoryEntry(cmd);
    State.updateTask("A", { duration: 10 });
    UndoHistory.pushEntry(entry!);

    // Undo
    const undoEntry = UndoHistory.popUndo();
    for (const c of undoEntry!.undo) {
      if (c.type === "UPDATE_TASK") State.updateTask(c.taskId, c.updates);
    }
    expect(State.findTask("A")!.duration).toBe(5);

    // Redo
    const redoEntry = UndoHistory.popRedo();
    for (const c of redoEntry!.redo) {
      if (c.type === "UPDATE_TASK") State.updateTask(c.taskId, c.updates);
    }
    expect(State.findTask("A")!.duration).toBe(10);
  });

  it("ADD_DEPENDENCY undo removes dependency", () => {
    State.addTask({ id: "A", name: "A", duration: 5, depth: 0, isSummary: false });
    State.addTask({ id: "B", name: "B", duration: 3, depth: 0, isSummary: false });

    const dep: Dependency = { id: "d1", predId: "A", succId: "B", type: "FS", lag: 0 };
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
    State.addTask({ id: "A", name: "A", duration: 5, depth: 0, isSummary: false });
    State.addTask({ id: "B", name: "B", duration: 3, depth: 0, isSummary: false });
    const dep: Dependency = { id: "d1", predId: "A", succId: "B", type: "FS", lag: 0 };
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
    State.addTask({ id: "A", name: "A", duration: 5, depth: 0, isSummary: false });
    State.addTask({ id: "B", name: "B", duration: 3, depth: 0, isSummary: false });
    State.addDependency({ id: "d1", predId: "A", succId: "B", type: "FS", lag: 0 });

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
    State.addTask({ id: "A", name: "A", duration: 5, depth: 0, isSummary: false });

    // First mutation
    const cmd1 = { type: "UPDATE_TASK" as const, v: 1 as const, reqId: "r1", taskId: "A", updates: { duration: 10 } };
    const entry1 = UndoHistory.buildHistoryEntry(cmd1);
    State.updateTask("A", { duration: 10 });
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

    State.addTask({ id: "A", name: "A", duration: 5, depth: 0, isSummary: false });
    const cmd = { type: "UPDATE_TASK" as const, v: 1 as const, reqId: "r1", taskId: "A", updates: { duration: 10 } };
    const entry = UndoHistory.buildHistoryEntry(cmd);
    State.updateTask("A", { duration: 10 });
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
    State.addTask({ id: "A", name: "A", duration: 1, depth: 0, isSummary: false });
    for (let i = 0; i < 60; i++) {
      const cmd = { type: "UPDATE_TASK" as const, v: 1 as const, reqId: `r${i}`, taskId: "A", updates: { duration: i + 2 } };
      const entry = UndoHistory.buildHistoryEntry(cmd);
      State.updateTask("A", { duration: i + 2 });
      UndoHistory.pushEntry(entry!);
    }
    expect(UndoHistory.getUndoStack().length).toBe(50);
  });

  it("clearHistory resets stacks (simulates reload)", () => {
    State.addTask({ id: "A", name: "A", duration: 5, depth: 0, isSummary: false });
    const cmd = { type: "UPDATE_TASK" as const, v: 1 as const, reqId: "r1", taskId: "A", updates: { duration: 10 } };
    const entry = UndoHistory.buildHistoryEntry(cmd);
    State.updateTask("A", { duration: 10 });
    UndoHistory.pushEntry(entry!);

    expect(UndoHistory.canUndo()).toBe(true);
    UndoHistory.clearHistory();
    expect(UndoHistory.canUndo()).toBe(false);
    expect(UndoHistory.canRedo()).toBe(false);
  });

  it("buildHistoryEntry returns null for nonexistent task", () => {
    const cmd = { type: "UPDATE_TASK" as const, v: 1 as const, reqId: "r1", taskId: "MISSING", updates: { duration: 10 } };
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
    State.addTask({ id: "t1", name: "T1", duration: 5, depth: 0, isSummary: false });
    State.addResource({ id: "r1", name: "Engineer", maxUnitsPerDay: 1 });
    State.addAssignment({ id: "a1", taskId: "t1", resourceId: "r1", unitsPerDay: 1 });
    expect(State.getAssignments()).toHaveLength(1);
    State.deleteResource("r1");
    expect(State.findResource("r1")).toBeUndefined();
    expect(State.getAssignments()).toHaveLength(0);
  });

  it("addAssignment and findAssignment", () => {
    State.addTask({ id: "t1", name: "T1", duration: 5, depth: 0, isSummary: false });
    State.addResource({ id: "r1", name: "Engineer", maxUnitsPerDay: 1 });
    const a: Assignment = { id: "a1", taskId: "t1", resourceId: "r1", unitsPerDay: 0.5 };
    State.addAssignment(a);
    expect(State.getAssignments()).toHaveLength(1);
    expect(State.findAssignment("a1")!.unitsPerDay).toBe(0.5);
  });

  it("updateAssignment", () => {
    State.addTask({ id: "t1", name: "T1", duration: 5, depth: 0, isSummary: false });
    State.addResource({ id: "r1", name: "Engineer", maxUnitsPerDay: 1 });
    State.addAssignment({ id: "a1", taskId: "t1", resourceId: "r1", unitsPerDay: 1 });
    State.updateAssignment("a1", { unitsPerDay: 0.75 });
    expect(State.findAssignment("a1")!.unitsPerDay).toBe(0.75);
  });

  it("deleteAssignment", () => {
    State.addTask({ id: "t1", name: "T1", duration: 5, depth: 0, isSummary: false });
    State.addResource({ id: "r1", name: "Engineer", maxUnitsPerDay: 1 });
    State.addAssignment({ id: "a1", taskId: "t1", resourceId: "r1", unitsPerDay: 1 });
    State.deleteAssignment("a1");
    expect(State.getAssignments()).toHaveLength(0);
  });

  it("deleteTaskRecursive cascades to assignments", () => {
    State.addTask({ id: "t1", name: "T1", duration: 5, depth: 0, isSummary: false });
    State.addTask({ id: "t2", name: "T2", duration: 3, depth: 1, isSummary: false, parentId: "t1" });
    State.addResource({ id: "r1", name: "Engineer", maxUnitsPerDay: 1 });
    State.addAssignment({ id: "a1", taskId: "t1", resourceId: "r1", unitsPerDay: 1 });
    State.addAssignment({ id: "a2", taskId: "t2", resourceId: "r1", unitsPerDay: 1 });
    State.deleteTaskRecursive("t1");
    expect(State.getAssignments()).toHaveLength(0);
  });

  it("clearState clears resources and assignments", () => {
    State.addResource({ id: "r1", name: "Engineer", maxUnitsPerDay: 1 });
    State.addTask({ id: "t1", name: "T1", duration: 5, depth: 0, isSummary: false });
    State.addAssignment({ id: "a1", taskId: "t1", resourceId: "r1", unitsPerDay: 1 });
    State.clearState();
    expect(State.getResources()).toHaveLength(0);
    expect(State.getAssignments()).toHaveLength(0);
  });

  it("snapshot/restore preserves resources and assignments", () => {
    State.addResource({ id: "r1", name: "Engineer", maxUnitsPerDay: 1 });
    State.addTask({ id: "t1", name: "T1", duration: 5, depth: 0, isSummary: false });
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
      tasks: [{ id: "t1", name: "T1", duration: 5, depth: 0, isSummary: false }],
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
    State.addTask({ id: "t1", name: "T1", duration: 5, depth: 0, isSummary: false });
    expect(validateAssignment({ id: "a1", taskId: "t1", resourceId: "MISSING", unitsPerDay: 1 })).toBe("Resource MISSING does not exist");
  });

  it("validateAssignment rejects unitsPerDay <= 0", () => {
    State.addTask({ id: "t1", name: "T1", duration: 5, depth: 0, isSummary: false });
    State.addResource({ id: "r1", name: "Eng", maxUnitsPerDay: 1 });
    expect(validateAssignment({ id: "a1", taskId: "t1", resourceId: "r1", unitsPerDay: 0 })).toBe("unitsPerDay must be greater than 0");
  });

  it("validateAssignment accepts valid assignment", () => {
    State.addTask({ id: "t1", name: "T1", duration: 5, depth: 0, isSummary: false });
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
    State.addTask({ id: "t1", name: "T1", duration: 5, depth: 0, isSummary: false });
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
    State.addTask({ id: "t1", name: "T1", duration: 5, depth: 0, isSummary: false });
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
    State.addTask({ id: "t1", name: "T1", duration: 5, depth: 0, isSummary: false });
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
    State.addTask({ id: "t1", name: "T1", duration: 5, depth: 0, isSummary: false });
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
    State.addTask({ id: "t1", name: "T1", duration: 5, depth: 0, isSummary: false });
    State.addTask({ id: "t2", name: "T2", duration: 3, depth: 0, isSummary: false });
    State.addDependency({ id: "d1", predId: "t1", succId: "t2", type: "FS", lag: 0 });
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
      t1: { earlyStart: 0, earlyFinish: 3, lateStart: 0, lateFinish: 3, totalFloat: 0, isCritical: true },
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
      t1: { earlyStart: 5, earlyFinish: 8, lateStart: 5, lateFinish: 8, totalFloat: 0, isCritical: true },
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
      t1: { earlyStart: 0, earlyFinish: 5, lateStart: 0, lateFinish: 5, totalFloat: 0, isCritical: true },
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
      t1: { earlyStart: 0, earlyFinish: 3, lateStart: 0, lateFinish: 3, totalFloat: 0, isCritical: false },
      t2: { earlyStart: 1, earlyFinish: 4, lateStart: 1, lateFinish: 4, totalFloat: 0, isCritical: false },
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
      t1: { earlyStart: 0, earlyFinish: 2, lateStart: 0, lateFinish: 2, totalFloat: 0, isCritical: false },
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
      t1: { earlyStart: 5, earlyFinish: 5, lateStart: 5, lateFinish: 5, totalFloat: 0, isCritical: false },
    };
    const result = computeResourceHistogram(assignments, scheduleResults, new Set());
    // Zero-duration task: no days loaded
    expect(result["r1"]).toBeUndefined();
  });
});
