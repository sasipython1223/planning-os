/// <reference lib="webworker" />

import type { BaselineMap, Command, WorkerMessage } from "protocol";
import type { ScheduleError } from "protocol/kernel";
import { generateNonWorkingDays } from "./calendar.js";
import type { CommandEnvelope, DispatchOutcome } from "./commandEnvelope.js";
import { auditLog, createEnvelope } from "./commandEnvelope.js";
import { computeConstraintDiagnostics, mergeResultDiagnostics } from "./constraintDiagnostics.js";
import * as UndoHistory from "./history.js";
import type { PersistedState } from "./persistence.js";
import { loadPersistedState, migratePersistedState, savePersistedState } from "./persistence.js";
import { computeResourceHistogram } from "./resourceHistogram.js";
import { rollupSummarySchedules } from "./rollupSummaries.js";
import { applyScheduleResult } from "./schedule/applyScheduleResult.js";
import { buildScheduleRequest } from "./schedule/buildScheduleRequest.js";
import { buildCompiledScheduleRequest } from "./schedule/compiledSchedulePath.js";
import { runSchedule } from "./schedule/runSchedule.js";
import { getSchedulingMode } from "./schedulingMode.js";
import * as State from "./state.js";
import * as Validation from "./validation.js";
import { computeVariances } from "./variance.js";
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
    State.getExcludeWeekends(),
    CALENDAR_HORIZON,
  );

  // Build schedule request — M07: guarded branch for compiled vs legacy path
  const request =
    getSchedulingMode() === "compiled"
      ? buildCompiledScheduleRequest(
          State.getAssumptionSet(),
          State.getAuthoredActivities(),
          nonWorkingDays,
        ).request
      : buildScheduleRequest(tasks, dependencies, nonWorkingDays);

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
      baselines: State.getBaselineMap(),
      variances: {},
      projectStartDate: State.getProjectStartDate(),
      nonWorkingDays,
      resources: [...State.getResources()],
      assignments: [...State.getAssignments()],
      resourceHistogram: {},
      diagnosticsMap: computeConstraintDiagnostics(tasks),
      canUndo: UndoHistory.canUndo(),
      canRedo: UndoHistory.canRedo(),
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

    // Store latest schedule results for baseline snapshot
    State.setLatestScheduleResults(scheduleResults);

    console.log("[AUDIT Kernel Math]", Object.entries(scheduleResults).map(([id, s]) => ({
      id,
      ES: s.earlyStart,
      EF: s.earlyFinish,
      LS: s.lateStart,
      LF: s.lateFinish,
      TF: s.totalFloat,
      isCritical: s.isCritical,
    })));

    const variances = computeVariances(scheduleResults, State.getBaselineMap());

    const nwdSet = new Set(nonWorkingDays);
    const resourceHistogram = computeResourceHistogram(
      State.getAssignments(),
      scheduleResults,
      nwdSet,
    );

    const inputDiags = computeConstraintDiagnostics(tasks);
    const diagnosticsMap = mergeResultDiagnostics(tasks, scheduleResults, inputDiags, nwdSet);

    const payload = {
      tasks: [...tasks],
      dependencies: [...dependencies],
      scheduleResults,
      baselines: State.getBaselineMap(),
      variances,
      projectStartDate: State.getProjectStartDate(),
      nonWorkingDays,
      resources: [...State.getResources()],
      assignments: [...State.getAssignments()],
      resourceHistogram,
      diagnosticsMap,
      canUndo: UndoHistory.canUndo(),
      canRedo: UndoHistory.canRedo(),
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
 * Apply a single command as an internal replay (no history, no ACK).
 * Used by undo/redo transaction replay.
 *
 * TRANSITIONAL: This function mutates canonical state directly,
 * bypassing dispatchCommand() and the envelope/audit path.
 * This is architecturally necessary for undo/redo (replay commands
 * are internal reversals, not new user intent). Do not expand this
 * path to handle new command types or new mutation scenarios.
 * When undo/redo is refactored to use the command spine natively,
 * this function should be removed.
 */
const applyReplayCommand = (cmd: Command): void => {
  switch (cmd.type) {
    case "ADD_TASK":
      State.addTask(cmd.payload);
      break;
    case "UPDATE_TASK":
      State.updateTask(cmd.taskId, cmd.updates);
      break;
    case "DELETE_TASK":
      State.deleteTaskRecursive(cmd.taskId);
      break;
    case "ADD_DEPENDENCY":
      State.addDependency(cmd.payload);
      break;
    case "DELETE_DEPENDENCY":
      State.deleteDependency(cmd.dependencyId);
      break;
    case "UPDATE_DEPENDENCY":
      State.updateDependency(cmd.dependencyId, cmd.updates);
      break;
    case "SNAPSHOT_BASELINE": {
      const sr = State.getLatestScheduleResults();
      const newBaseline: BaselineMap = {};
      for (const taskId of Object.keys(sr)) {
        newBaseline[taskId] = { start: sr[taskId].earlyStart, finish: sr[taskId].earlyFinish };
      }
      State.setBaselineMap(newBaseline);
      break;
    }
    case "CLEAR_BASELINE":
      State.setBaselineMap({});
      break;
    case "ADD_RESOURCE":
      State.addResource(cmd.payload);
      break;
    case "UPDATE_RESOURCE":
      State.updateResource(cmd.resourceId, cmd.updates);
      break;
    case "DELETE_RESOURCE":
      State.deleteResource(cmd.resourceId);
      break;
    case "ADD_ASSIGNMENT":
      State.addAssignment(cmd.payload);
      break;
    case "UPDATE_ASSIGNMENT":
      State.updateAssignment(cmd.assignmentId, cmd.updates);
      break;
    case "DELETE_ASSIGNMENT":
      State.deleteAssignment(cmd.assignmentId);
      break;
    default: {
      // Handle internal-only RESTORE_BASELINES command
      const any = cmd as unknown as { type: string; baselines?: BaselineMap };
      if (any.type === "RESTORE_BASELINES" && any.baselines) {
        State.setBaselineMap({ ...any.baselines });
      }
      break;
    }
  }
};

/** History-eligible command types. */
const HISTORY_ELIGIBLE = new Set([
  "ADD_TASK", "UPDATE_TASK", "DELETE_TASK",
  "ADD_DEPENDENCY", "DELETE_DEPENDENCY", "UPDATE_DEPENDENCY",
  "SNAPSHOT_BASELINE", "CLEAR_BASELINE",
  "ADD_RESOURCE", "UPDATE_RESOURCE", "DELETE_RESOURCE",
  "ADD_ASSIGNMENT", "UPDATE_ASSIGNMENT", "DELETE_ASSIGNMENT",
]);

// ── M03 Command Spine ────────────────────────────────────────────────
//
// dispatchCommand() is the single entry point for all inbound commands.
// It wraps commands in a CommandEnvelope (internal metadata), delegates
// to handleCommand() for routing/execution, and logs at the audit seam.
//
// Phase 1: Envelope + coarse audit log (always "ack").
// Phase 2: handleCommand returns DispatchOutcome for accurate audit.
//          Replay bypass paths marked as transitional.
//
// TRANSITIONAL: handleCommand() retains all existing per-command routing,
// validation, rollback, history, and persistence logic. It is not yet
// refactored into per-type handler functions. Future milestones may
// extract handlers, but behavioral correctness must not change here.
// ─────────────────────────────────────────────────────────────────────

/**
 * Dispatch a command through the envelope spine.
 * Creates an envelope, delegates to handleCommand, and logs the outcome.
 *
 * This is the only entry point for UI-issued commands.
 * Internal replay paths (undo/redo) use applyReplayCommand() which
 * bypasses the envelope spine — see transitional comment there.
 *
 * AUDIT SEAM: The auditLog call after handleCommand is the single
 * attachment point for future event ledger / governance hooks.
 * Outcome is now classified per-branch: "ack", "nack", or "error".
 */
const dispatchCommand = (cmd: Command): void => {
  const envelope = createEnvelope(cmd, "human");
  const outcome = handleCommand(cmd, envelope);
  auditLog(envelope, outcome);
};

/**
 * Handle incoming commands.
 * Routes to appropriate handlers and triggers scheduling.
 *
 * @param cmd      - The protocol command to execute
 * @param envelope - Optional envelope for audit logging. Absent during
 *                   internal replay (undo/redo), where audit is not needed.
 *
 * TRANSITIONAL: The envelope parameter is optional to allow the existing
 * applyReplayCommand() and undo/redo paths to call handleCommand directly
 * without constructing envelopes. Once all mutation paths route through
 * dispatchCommand, the envelope parameter may become required.
 */
const handleCommand = (cmd: Command, envelope?: CommandEnvelope): DispatchOutcome => {
  if (!isReady) {
    emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: "Worker not ready" });
    return "nack";
  }

  // ---- UNDO ----
  if (cmd.type === "UNDO") {
    const entry = UndoHistory.popUndo();
    if (!entry) return "nack";
    // TRANSITIONAL: undo replay mutates state via applyReplayCommand,
    // bypassing the command spine. See applyReplayCommand() comment.
    for (const c of entry.undo) applyReplayCommand(c);
    runSchedulingAndEmitState();
    debouncedSave();
    return "ack";
  }

  // ---- REDO ----
  if (cmd.type === "REDO") {
    const entry = UndoHistory.popRedo();
    if (!entry) return "nack";
    // TRANSITIONAL: redo replay mutates state via applyReplayCommand,
    // bypassing the command spine. See applyReplayCommand() comment.
    for (const c of entry.redo) applyReplayCommand(c);
    runSchedulingAndEmitState();
    debouncedSave();
    return "ack";
  }

  // ---- Forward mutations ----

  // Build history entry BEFORE mutation (captures pre-state)
  const historyEntry = HISTORY_ELIGIBLE.has(cmd.type)
    ? UndoHistory.buildHistoryEntry(cmd)
    : null;

  if (cmd.type === "ADD_TASK") {
    const error = Validation.validateTask(cmd.payload);
    if (error) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error });
      return "nack";
    }

    State.addTask(cmd.payload);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    
    runSchedulingAndEmitState();
    if (historyEntry) UndoHistory.pushEntry(historyEntry);
    debouncedSave();
    return "ack";
  }

  if (cmd.type === "UPDATE_TASK") {
    const task = State.findTask(cmd.taskId);
    if (!task) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: `Task ${cmd.taskId} not found` });
      return "nack";
    }

    const updates = { ...cmd.updates };
    if (task.isSummary) {
      delete updates.duration;
      delete updates.minEarlyStart;
    }

    const error = Validation.validateTaskUpdate(cmd.taskId, updates);
    if (error) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error });
      return "nack";
    }

    const snapshot = State.createSnapshot();
    State.updateTask(cmd.taskId, updates);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });

    const success = runSchedulingAndEmitState();
    if (!success) {
      State.restoreSnapshot(snapshot);
      runSchedulingAndEmitState();
      return "error";
    } else {
      if (historyEntry) UndoHistory.pushEntry(historyEntry);
      debouncedSave();
      return "ack";
    }
  }

  if (cmd.type === "ADD_DEPENDENCY") {
    const error = Validation.validateDependency(cmd.payload);
    if (error) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error });
      return "nack";
    }

    const snapshot = State.createSnapshot();
    State.addDependency(cmd.payload);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });

    const success = runSchedulingAndEmitState();
    if (!success) {
      State.restoreSnapshot(snapshot);
      runSchedulingAndEmitState();
      return "error";
    } else {
      if (historyEntry) UndoHistory.pushEntry(historyEntry);
      debouncedSave();
      return "ack";
    }
  }

  if (cmd.type === "DELETE_TASK") {
    if (!State.findTask(cmd.taskId)) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: `Task ${cmd.taskId} not found` });
      return "nack";
    }

    State.deleteTaskRecursive(cmd.taskId);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    runSchedulingAndEmitState();
    if (historyEntry) UndoHistory.pushEntry(historyEntry);
    debouncedSave();
    return "ack";
  }

  if (cmd.type === "DELETE_DEPENDENCY") {
    if (!State.findDependencyById(cmd.dependencyId)) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: `Dependency ${cmd.dependencyId} not found` });
      return "nack";
    }

    State.deleteDependency(cmd.dependencyId);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    runSchedulingAndEmitState();
    if (historyEntry) UndoHistory.pushEntry(historyEntry);
    debouncedSave();
    return "ack";
  }

  if (cmd.type === "UPDATE_DEPENDENCY") {
    if (!State.findDependencyById(cmd.dependencyId)) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: `Dependency ${cmd.dependencyId} not found` });
      return "nack";
    }

    const error = Validation.validateDependencyUpdate(cmd.updates);
    if (error) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error });
      return "nack";
    }

    const snapshot = State.createSnapshot();
    State.updateDependency(cmd.dependencyId, cmd.updates);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });

    const success = runSchedulingAndEmitState();
    if (!success) {
      State.restoreSnapshot(snapshot);
      runSchedulingAndEmitState();
      return "error";
    } else {
      if (historyEntry) UndoHistory.pushEntry(historyEntry);
      debouncedSave();
      return "ack";
    }
  }

  if (cmd.type === "SNAPSHOT_BASELINE") {
    const sr = State.getLatestScheduleResults();
    const newBaseline: BaselineMap = {};
    for (const taskId of Object.keys(sr)) {
      newBaseline[taskId] = { start: sr[taskId].earlyStart, finish: sr[taskId].earlyFinish };
    }
    State.setBaselineMap(newBaseline);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    runSchedulingAndEmitState();
    if (historyEntry) UndoHistory.pushEntry(historyEntry);
    debouncedSave();
    return "ack";
  }

  if (cmd.type === "CLEAR_BASELINE") {
    State.setBaselineMap({});
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    runSchedulingAndEmitState();
    if (historyEntry) UndoHistory.pushEntry(historyEntry);
    debouncedSave();
    return "ack";
  }

  // ---- Resource commands ----

  if (cmd.type === "ADD_RESOURCE") {
    const error = Validation.validateResource(cmd.payload);
    if (error) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error });
      return "nack";
    }
    State.addResource(cmd.payload);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    runSchedulingAndEmitState();
    if (historyEntry) UndoHistory.pushEntry(historyEntry);
    debouncedSave();
    return "ack";
  }

  if (cmd.type === "UPDATE_RESOURCE") {
    if (!State.findResource(cmd.resourceId)) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: `Resource ${cmd.resourceId} not found` });
      return "nack";
    }
    const error = Validation.validateResourceUpdate(cmd.updates);
    if (error) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error });
      return "nack";
    }
    State.updateResource(cmd.resourceId, cmd.updates);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    runSchedulingAndEmitState();
    if (historyEntry) UndoHistory.pushEntry(historyEntry);
    debouncedSave();
    return "ack";
  }

  if (cmd.type === "DELETE_RESOURCE") {
    if (!State.findResource(cmd.resourceId)) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: `Resource ${cmd.resourceId} not found` });
      return "nack";
    }
    State.deleteResource(cmd.resourceId);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    runSchedulingAndEmitState();
    if (historyEntry) UndoHistory.pushEntry(historyEntry);
    debouncedSave();
    return "ack";
  }

  // ---- Assignment commands ----

  if (cmd.type === "ADD_ASSIGNMENT") {
    const error = Validation.validateAssignment(cmd.payload);
    if (error) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error });
      return "nack";
    }
    State.addAssignment(cmd.payload);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    runSchedulingAndEmitState();
    if (historyEntry) UndoHistory.pushEntry(historyEntry);
    debouncedSave();
    return "ack";
  }

  if (cmd.type === "UPDATE_ASSIGNMENT") {
    if (!State.findAssignment(cmd.assignmentId)) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: `Assignment ${cmd.assignmentId} not found` });
      return "nack";
    }
    const error = Validation.validateAssignmentUpdate(cmd.updates);
    if (error) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error });
      return "nack";
    }
    State.updateAssignment(cmd.assignmentId, cmd.updates);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    runSchedulingAndEmitState();
    if (historyEntry) UndoHistory.pushEntry(historyEntry);
    debouncedSave();
    return "ack";
  }

  if (cmd.type === "DELETE_ASSIGNMENT") {
    if (!State.findAssignment(cmd.assignmentId)) {
      emit({ type: "NACK", v: 1, reqId: cmd.reqId, error: `Assignment ${cmd.assignmentId} not found` });
      return "nack";
    }
    State.deleteAssignment(cmd.assignmentId);
    emit({ type: "ACK", v: 1, reqId: cmd.reqId });
    runSchedulingAndEmitState();
    if (historyEntry) UndoHistory.pushEntry(historyEntry);
    debouncedSave();
    return "ack";
  }

  // Unrecognized command type — should not happen with typed protocol.
  return "nack";
};

// ---- Debounced persistence ----
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const saveState = (): void => {
  const persisted: PersistedState = {
    version: 1,
    lastModified: Date.now(),
    state: {
      projectStartDate: State.getProjectStartDate(),
      excludeWeekends: State.getExcludeWeekends(),
      tasks: State.getTasks().map(t => ({ ...t })),
      dependencies: State.getDependencies().map(d => ({ ...d })),
      baselines: { ...State.getBaselineMap() },
      resources: State.getResources().map(r => ({ ...r })),
      assignments: State.getAssignments().map(a => ({ ...a })),
    },
  };
  savePersistedState(persisted);
};

const debouncedSave = (): void => {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 2000);
};

/**
 * Initialize worker: load WASM, hydrate persisted state, and emit WORKER_READY.
 */
const initializeWorker = async (): Promise<void> => {
  try {
    await loadCpmWasm();

    // Attempt hydration from IndexedDB
    const raw = await loadPersistedState();
    const persisted = raw ? migratePersistedState(raw) : null;
    if (persisted?.state) {
      State.hydrateState(persisted.state);
      console.log("[Persistence] Hydrated", persisted.state.tasks.length, "tasks",
        persisted.state.dependencies.length, "deps");
    }

    isReady = true;
    emit({ type: "WORKER_READY", v: 1 });

    // Recompute schedule from hydrated state and emit initial DIFF_STATE
    runSchedulingAndEmitState();
  } catch (error) {
    console.error("Failed to initialize worker:", error);
    // Worker remains not ready
  }
};

// Set up message handler — all UI commands enter through the envelope spine.
ctx.onmessage = (event: MessageEvent<Command>) => {
  dispatchCommand(event.data);
};

// Start initialization
initializeWorker();

export { };
