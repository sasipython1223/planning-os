import type { Assignment, BaselineMap, Command, Dependency, Task } from "protocol";
import * as State from "./state.js";

/** A transaction is an ordered list of commands to replay atomically. */
export type Transaction = Command[];

export type HistoryEntry = {
  undo: Transaction;
  redo: Transaction;
};

const MAX_HISTORY = 50;

let undoStack: HistoryEntry[] = [];
let redoStack: HistoryEntry[] = [];

export const getUndoStack = (): readonly HistoryEntry[] => undoStack;
export const getRedoStack = (): readonly HistoryEntry[] => redoStack;
export const canUndo = (): boolean => undoStack.length > 0;
export const canRedo = (): boolean => redoStack.length > 0;

export const clearHistory = (): void => {
  undoStack = [];
  redoStack = [];
};

export const pushEntry = (entry: HistoryEntry): void => {
  undoStack.push(entry);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
};

export const popUndo = (): HistoryEntry | undefined => {
  const entry = undoStack.pop();
  if (entry) redoStack.push(entry);
  return entry;
};

export const popRedo = (): HistoryEntry | undefined => {
  const entry = redoStack.pop();
  if (entry) undoStack.push(entry);
  return entry;
};

// ---- Inverse-command builder ----

const reqId = (): string => "__history__";

/** Build a HistoryEntry for a forward command using current canonical state. */
export function buildHistoryEntry(cmd: Command): HistoryEntry | null {
  switch (cmd.type) {
    case "ADD_TASK":
      return {
        undo: [{ type: "DELETE_TASK", v: 1, reqId: reqId(), taskId: cmd.payload.id }],
        redo: [{ ...cmd, reqId: reqId() }],
      };

    case "UPDATE_TASK": {
      const task = State.findTask(cmd.taskId);
      if (!task) return null;
      const prevUpdates: Record<string, unknown> = {};
      for (const key of Object.keys(cmd.updates) as (keyof typeof cmd.updates)[]) {
        if (key === "parentId") {
          prevUpdates[key] = task.parentId ?? null;
        } else if (key === "constraintDate") {
          prevUpdates[key] = task.constraintDate ?? null;
        } else {
          prevUpdates[key] = task[key];
        }
      }
      return {
        undo: [{ type: "UPDATE_TASK", v: 1, reqId: reqId(), taskId: cmd.taskId, updates: prevUpdates as typeof cmd.updates }],
        redo: [{ ...cmd, reqId: reqId() }],
      };
    }

    case "ADD_DEPENDENCY":
      return {
        undo: [{ type: "DELETE_DEPENDENCY", v: 1, reqId: reqId(), dependencyId: cmd.payload.id }],
        redo: [{ ...cmd, reqId: reqId() }],
      };

    case "DELETE_DEPENDENCY": {
      const dep = State.findDependencyById(cmd.dependencyId);
      if (!dep) return null;
      return {
        undo: [{ type: "ADD_DEPENDENCY", v: 1, reqId: reqId(), payload: { ...dep } }],
        redo: [{ ...cmd, reqId: reqId() }],
      };
    }

    case "UPDATE_DEPENDENCY": {
      const dep = State.findDependencyById(cmd.dependencyId);
      if (!dep) return null;
      const prevUpdates: Record<string, unknown> = {};
      for (const key of Object.keys(cmd.updates) as (keyof typeof cmd.updates)[]) {
        prevUpdates[key] = dep[key];
      }
      return {
        undo: [{ type: "UPDATE_DEPENDENCY", v: 1, reqId: reqId(), dependencyId: cmd.dependencyId, updates: prevUpdates as typeof cmd.updates }],
        redo: [{ ...cmd, reqId: reqId() }],
      };
    }

    case "DELETE_TASK": {
      const task = State.findTask(cmd.taskId);
      if (!task) return null;
      // Capture task + all descendants + incident dependencies + baselines + assignments
      const descendantIds = State.getDescendantIds(cmd.taskId);
      const allIds = new Set([cmd.taskId, ...descendantIds]);
      const tasksToRestore: Task[] = State.getTasks()
        .filter(t => allIds.has(t.id))
        .map(t => ({ ...t }));
      const depsToRestore: Dependency[] = State.getDependencies()
        .filter(d => allIds.has(d.predId) || allIds.has(d.succId))
        .map(d => ({ ...d }));
      const assignmentsToRestore: Assignment[] = State.getAssignments()
        .filter(a => allIds.has(a.taskId))
        .map(a => ({ ...a }));
      const baselineMap = State.getBaselineMap();
      const baselinesToRestore: BaselineMap = {};
      for (const id of allIds) {
        if (baselineMap[id]) baselinesToRestore[id] = { ...baselineMap[id] };
      }

      // Undo transaction: re-add tasks, deps, assignments, and baselines
      const undoTx: Transaction = [];
      for (const t of tasksToRestore) {
        undoTx.push({ type: "ADD_TASK", v: 1, reqId: reqId(), payload: t });
      }
      for (const d of depsToRestore) {
        undoTx.push({ type: "ADD_DEPENDENCY", v: 1, reqId: reqId(), payload: d });
      }
      for (const a of assignmentsToRestore) {
        undoTx.push({ type: "ADD_ASSIGNMENT", v: 1, reqId: reqId(), payload: a });
      }
      if (Object.keys(baselinesToRestore).length > 0) {
        undoTx.push({ type: "RESTORE_BASELINES", v: 1, reqId: reqId(), baselines: baselinesToRestore } as unknown as Command);
      }

      return {
        undo: undoTx,
        redo: [{ ...cmd, reqId: reqId() }],
      };
    }

    case "SNAPSHOT_BASELINE": {
      const prevBaselines = { ...State.getBaselineMap() };
      return {
        undo: [{ type: "RESTORE_BASELINES", v: 1, reqId: reqId(), baselines: prevBaselines } as unknown as Command],
        redo: [{ ...cmd, reqId: reqId() }],
      };
    }

    case "CLEAR_BASELINE": {
      const prevBaselines = { ...State.getBaselineMap() };
      if (Object.keys(prevBaselines).length === 0) return null;
      return {
        undo: [{ type: "RESTORE_BASELINES", v: 1, reqId: reqId(), baselines: prevBaselines } as unknown as Command],
        redo: [{ ...cmd, reqId: reqId() }],
      };
    }

    // ---- Resource commands ----

    case "ADD_RESOURCE":
      return {
        undo: [{ type: "DELETE_RESOURCE", v: 1, reqId: reqId(), resourceId: cmd.payload.id }],
        redo: [{ ...cmd, reqId: reqId() }],
      };

    case "UPDATE_RESOURCE": {
      const res = State.findResource(cmd.resourceId);
      if (!res) return null;
      const prevUpdates: Record<string, unknown> = {};
      for (const key of Object.keys(cmd.updates) as (keyof typeof cmd.updates)[]) {
        prevUpdates[key] = res[key];
      }
      return {
        undo: [{ type: "UPDATE_RESOURCE", v: 1, reqId: reqId(), resourceId: cmd.resourceId, updates: prevUpdates as typeof cmd.updates }],
        redo: [{ ...cmd, reqId: reqId() }],
      };
    }

    case "DELETE_RESOURCE": {
      const res = State.findResource(cmd.resourceId);
      if (!res) return null;
      // Capture resource + all linked assignments
      const linkedAssignments: Assignment[] = State.getAssignments()
        .filter(a => a.resourceId === cmd.resourceId)
        .map(a => ({ ...a }));
      const undoTxR: Transaction = [
        { type: "ADD_RESOURCE", v: 1, reqId: reqId(), payload: { ...res } },
      ];
      for (const a of linkedAssignments) {
        undoTxR.push({ type: "ADD_ASSIGNMENT", v: 1, reqId: reqId(), payload: a });
      }
      return {
        undo: undoTxR,
        redo: [{ ...cmd, reqId: reqId() }],
      };
    }

    // ---- Assignment commands ----

    case "ADD_ASSIGNMENT":
      return {
        undo: [{ type: "DELETE_ASSIGNMENT", v: 1, reqId: reqId(), assignmentId: cmd.payload.id }],
        redo: [{ ...cmd, reqId: reqId() }],
      };

    case "UPDATE_ASSIGNMENT": {
      const asgn = State.findAssignment(cmd.assignmentId);
      if (!asgn) return null;
      const prevUpdates: Record<string, unknown> = {};
      for (const key of Object.keys(cmd.updates) as (keyof typeof cmd.updates)[]) {
        prevUpdates[key] = asgn[key];
      }
      return {
        undo: [{ type: "UPDATE_ASSIGNMENT", v: 1, reqId: reqId(), assignmentId: cmd.assignmentId, updates: prevUpdates as typeof cmd.updates }],
        redo: [{ ...cmd, reqId: reqId() }],
      };
    }

    case "DELETE_ASSIGNMENT": {
      const asgn = State.findAssignment(cmd.assignmentId);
      if (!asgn) return null;
      return {
        undo: [{ type: "ADD_ASSIGNMENT", v: 1, reqId: reqId(), payload: { ...asgn } }],
        redo: [{ ...cmd, reqId: reqId() }],
      };
    }

    default:
      return null;
  }
}
