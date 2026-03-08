/**
 * Worker scheduling integration tests.
 * Tests the full pipeline: state → scheduling → result application.
 */

import type { Dependency, ScheduleResultMap, Task } from "protocol";
import type { ScheduleError, ScheduleResponse } from "protocol/kernel";
import { beforeEach, describe, expect, it } from "vitest";
import { rollupSummarySchedules } from "../src/rollupSummaries.js";
import { applyScheduleResult } from "../src/schedule/applyScheduleResult.js";
import { buildScheduleRequest } from "../src/schedule/buildScheduleRequest.js";
import * as State from "../src/state.js";
import { validateDependency, validateTask, validateTaskUpdate } from "../src/validation.js";

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
    const dep: Dependency = { id: "dep1", predId: "A", succId: "B", type: "FS" };
    State.addDependency(dep);

    expect(State.getDependencies()).toHaveLength(1);
    expect(State.findDependency("A", "B")).toEqual(dep);
  });

  it("should create snapshot with deep copies", () => {
    const taskA: Task = { id: "A", name: "Task A", duration: 5, depth: 0, isSummary: false };
    const taskB: Task = { id: "B", name: "Task B", duration: 3, depth: 0, isSummary: false };
    const dep: Dependency = { id: "dep1", predId: "A", succId: "B", type: "FS" };

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
    const dep: Dependency = { id: "dep1", predId: "A", succId: "A", type: "FS" };
    const error = validateDependency(dep);

    expect(error).toBe("Dependency cannot point to itself");
  });

  it("should reject dependencies with missing tasks", () => {
    State.addTask({ id: "A", name: "Task A", duration: 5, depth: 0, isSummary: false });
    const dep: Dependency = { id: "dep1", predId: "A", succId: "B", type: "FS" };
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
      { id: "dep1", predId: "A", succId: "B", type: "FS" },
    ];

    const request = buildScheduleRequest(tasks, dependencies, []);

    expect(request.tasks).toHaveLength(2);
    expect(request.dependencies).toHaveLength(1);
    expect(request.dependencies[0]).toEqual({ predId: "A", succId: "B" });
  });

  it("should filter non-FS dependencies", () => {
    const tasks: Task[] = [
      { id: "A", name: "Task A", duration: 3, depth: 0, isSummary: false },
      { id: "B", name: "Task B", duration: 5, depth: 0, isSummary: false },
    ];
    const dependencies: Dependency[] = [
      { id: "dep1", predId: "A", succId: "B", type: "FS" },
      { id: "dep2", predId: "A", succId: "B", type: "SS" },
    ];

    const request = buildScheduleRequest(tasks, dependencies, []);

    expect(request.dependencies).toHaveLength(1);
    expect(request.dependencies[0].predId).toBe("A");
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
    State.addDependency({ id: "dep1", predId: "A", succId: "B", type: "FS" });

    const validSnapshot = State.createSnapshot();

    // Simulate attempted mutation that would create cycle: B → A
    const cycleSnapshot = State.createSnapshot();
    State.addDependency({ id: "dep2", predId: "B", succId: "A", type: "FS" });

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
    State.addDependency({ id: "dep1", predId: "A", succId: "B", type: "FS" });

    const snapshot = State.createSnapshot();

    // Add another valid dependency: B → C (extends chain)
    State.addDependency({ id: "dep2", predId: "B", succId: "C", type: "FS" });

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
    State.addDependency({ id: "dep1", predId: "A", succId: "NonExistent", type: "FS" });

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
    State.addDependency({ id: "dep1", predId: "A", succId: "B", type: "FS" });

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
    State.addDependency({ id: "dep1", predId: "A", succId: "B", type: "FS" });
    State.addDependency({ id: "dep2", predId: "B", succId: "C", type: "FS" });
    State.addDependency({ id: "dep3", predId: "A", succId: "C", type: "FS" });

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
    State.addDependency({ id: "dep1", predId: "A", succId: "B", type: "FS" });
    State.addDependency({ id: "dep2", predId: "B", succId: "C", type: "FS" });

    State.deleteTask("B");

    // Remaining deps should only reference existing tasks
    const taskIds = new Set(State.getTasks().map(t => t.id));
    for (const dep of State.getDependencies()) {
      expect(taskIds.has(dep.predId)).toBe(true);
      expect(taskIds.has(dep.succId)).toBe(true);
    }
  });

  it("should find dependency by id", () => {
    State.addDependency({ id: "dep1", predId: "A", succId: "B", type: "FS" });
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
    State.addDependency({ id: "d1", predId: "A", succId: "X", type: "FS" });
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
