/// <reference lib="webworker" />

import type { Command, WorkerMessage } from "protocol";
import type { ScheduleError } from "protocol/kernel";
import { generateNonWorkingDays } from "./calendar.js";
import { rollupSummarySchedules } from "./rollupSummaries.js";
import { applyScheduleResult } from "./schedule/applyScheduleResult.js";
import { buildScheduleRequest } from "./schedule/buildScheduleRequest.js";
import { runSchedule } from "./schedule/runSchedule.js";
import * as State from "./state.js";
import * as Validation from "./validation.js";
import { loadCpmWasm } from "./wasm/loadCpmWasm.js";

const ctx: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

// Worker initialization state
let isReady = false;

/**
 * Emit a message to the UI.
 */
const emit = (message: WorkerMessage): void => {
  ctx.postMessage(message);
};

/**
 * Run scheduling and emit state with results.
 * Returns true if scheduling succeeded, false if it failed.
 */
const CALENDAR_HORIZON = 3650; // ~10 years

const runSchedulingAndEmitState = (): boolean => {
  // Recompute hierarchy metadata before scheduling
  State.computeHierarchy();

  const tasks = State.getTasks();
  const dependencies = State.getDependencies();

  // Generate calendar data
  const nonWorkingDays = generateNonWorkingDays(
    State.getProjectStartDate(),
    true, // excludeWeekends — hardcoded for now
    CALENDAR_HORIZON,
  );

  // Build schedule request
  const request = buildScheduleRequest(tasks, dependencies, nonWorkingDays);

  // Run scheduling
  const result = runSchedule(request);

  // Check if result is an error
  if ("type" in result && typeof result.type === "string") {
    const scheduleError = result as ScheduleError;

    // Emit error message
    emit({
      type: "SCHEDULE_ERROR",
      v: 1,
      error: {
        type: scheduleError.type,
        message: scheduleError.message,
        taskId: "taskId" in scheduleError ? scheduleError.taskId : undefined,
      },
    });

    // Emit state without schedule results (current state may be invalid)
    const emptyPayload = {
      tasks: [...tasks],
      dependencies: [...dependencies],
      scheduleResults: {},
      projectStartDate: State.getProjectStartDate(),
    };
    console.log("[AUDIT Worker Emit] schedule-error path", {
      taskCount: emptyPayload.tasks.length,
      depCount: emptyPayload.dependencies.length,
    });
    emit({ type: "DIFF_STATE", v: 1, payload: emptyPayload });

    return false;
  } else {
    // Success - apply schedule result and emit state
    const scheduleResults = applyScheduleResult(result);

    // Worker-authoritative summary rollup (overwrites kernel summary results)
    rollupSummarySchedules(tasks, scheduleResults);

    console.log("[AUDIT Kernel Math]", Object.entries(scheduleResults).map(([id, s]) => ({
      id,
      ES: s.earlyStart,
      EF: s.earlyFinish,
      LS: s.lateStart,
      LF: s.lateFinish,
      TF: s.totalFloat,
      isCritical: s.isCritical,
    })));

    const payload = {
      tasks: [...tasks],
      dependencies: [...dependencies],
      scheduleResults,
      projectStartDate: State.getProjectStartDate(),
    };
    const critCount = Object.values(scheduleResults).filter(s => s.isCritical).length;
    console.log("[AUDIT Worker Emit] success path", {
      taskCount: payload.tasks.length,
      depCount: payload.dependencies.length,
      criticalCount: critCount,
    });
    emit({ type: "DIFF_STATE", v: 1, payload });

    return true;
  }
};

/**
 * Handle incoming commands from UI.
 * Routes to appropriate handlers and triggers scheduling.
 */
const handleCommand = (cmd: Command): void => {
  if (!isReady) {
    emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: "Worker not ready" });
    return;
  }

  if (cmd.type === "ADD_TASK") {
    const error = Validation.validateTask(cmd.payload);
    if (error) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error });
      return;
    }

    State.addTask(cmd.payload);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    
    // Adding isolated task cannot break scheduling - no rollback needed
    runSchedulingAndEmitState();
  }

  if (cmd.type === "UPDATE_TASK") {
    const task = State.findTask(cmd.taskId);
    if (!task) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: `Task ${cmd.taskId} not found` });
      return;
    }

    // Strip schedule-physics fields from summary tasks
    const updates = { ...cmd.updates };
    if (task.isSummary) {
      delete updates.duration;
      delete updates.minEarlyStart;
    }

    const error = Validation.validateTaskUpdate(cmd.taskId, updates);
    if (error) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error });
      return;
    }

    // Atomic mutation: snapshot → mutate → schedule → rollback-or-commit
    const snapshot = State.createSnapshot();
    State.updateTask(cmd.taskId, updates);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });

    const success = runSchedulingAndEmitState();
    if (!success) {
      State.restoreSnapshot(snapshot);
      runSchedulingAndEmitState();
    }
  }

  if (cmd.type === "ADD_DEPENDENCY") {
    const error = Validation.validateDependency(cmd.payload);
    if (error) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error });
      return;
    }

    // Atomic mutation: snapshot → mutate → schedule → rollback-or-commit
    const snapshot = State.createSnapshot();
    State.addDependency(cmd.payload);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });

    const success = runSchedulingAndEmitState();
    if (!success) {
      State.restoreSnapshot(snapshot);
      runSchedulingAndEmitState();
    }
  }

  if (cmd.type === "DELETE_TASK") {
    if (!State.findTask(cmd.taskId)) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: `Task ${cmd.taskId} not found` });
      return;
    }

    State.deleteTaskRecursive(cmd.taskId);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    runSchedulingAndEmitState();
  }

  if (cmd.type === "DELETE_DEPENDENCY") {
    if (!State.findDependencyById(cmd.dependencyId)) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: `Dependency ${cmd.dependencyId} not found` });
      return;
    }

    State.deleteDependency(cmd.dependencyId);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    runSchedulingAndEmitState();
  }
};

/**
 * Initialize worker: load WASM and emit WORKER_READY.
 */
const initializeWorker = async (): Promise<void> => {
  try {
    await loadCpmWasm();
    isReady = true;
    emit({ type: "WORKER_READY", v: 1 });
  } catch (error) {
    console.error("Failed to initialize worker:", error);
    // Worker remains not ready
  }
};

// Set up message handler
ctx.onmessage = (event: MessageEvent<Command>) => {
  handleCommand(event.data);
};

// Start initialization
initializeWorker();

export { };
