import type {
    Assignment,
    BaseCalendarDefinition,
    BaselineMap,
    CalendarConfig,
    CalendarId,
    Dependency,
    PlannerCalendar,
    Resource,
    ScheduleLifecycleState,
    SourceCalculatedVarianceReport,
    SourceImportFidelityState,
    SourceImportRecord,
    SourceProjectSettings,
    SourceTaskDates,
    Task,
} from "@planner/protocol";

const DB_NAME = "PlannerStudioDB";
const STORE_NAME = "workspaces";
const SESSION_KEY = "active-session";
const CURRENT_SCHEMA_VERSION = 1;

export interface PersistedState {
  version: number;
  lastModified: number;
  state: {
    projectStartDate: string;
    /** @deprecated Phase B: kept for backward-compat migration. Use projectCalendar instead. */
    excludeWeekends: boolean;
    /** Phase B: calendar identity for forward-compatible persistence. Optional; defaults to "default". */
    calendarId?: CalendarId;
    /** Phase B: full project calendar configuration. Optional for backward compat; synthesized from excludeWeekends if absent. */
    projectCalendar?: CalendarConfig;
    /** Phase C: calendar dictionary. Optional; defaults to empty if absent. */
    calendars?: Record<string, CalendarConfig>;
    tasks: Task[];
    dependencies: Dependency[];
    baselines: BaselineMap;
    resources?: Resource[];
    assignments?: Assignment[];
    scheduleLifecycle?: ScheduleLifecycleState;
    sourceImportRecord?: SourceImportRecord | null;
    sourceImportFidelityState?: SourceImportFidelityState;
    sourceDatesByTaskId?: Record<string, SourceTaskDates>;
    varianceReport?: SourceCalculatedVarianceReport | null;
    /** W3A: Rich calendar definitions from imports (Track A Step 1). */
    calendarDefinitions?: Record<string, BaseCalendarDefinition>;
    /** W3C: Resolved calendar definitions after inheritance resolution. */
    resolvedCalendarDefinitions?: Record<string, BaseCalendarDefinition>;
    /** W4.3: Project-level default settings preserved from source import (informational). */
    sourceProjectSettings?: SourceProjectSettings;
    /** C1A/C1B: editable planner calendars. */
    plannerCalendars?: Record<string, PlannerCalendar>;
  };
}

const FORBIDDEN_PERSISTENCE_KEYS = new Set([
  "scheduleResults",
  "nonWorkingDays",
  "resourceHistogram",
  "diagnosticsMap",
  "lastTemporalCandidateProjection",
  "lastTemporalCandidateComparisonSummary",
  "temporalCandidateProjection",
  "temporalCandidateComparison",
  "temporalCandidateComparisonSummary",
  "temporalAuthorityDiagnostics",
  "currentAuthorityEngineMode",
  "previousAuthorityEngineMode",
  "lastTemporalAuthorityRunId",
  "lastTemporalAuthorityDecision",
  "lastTemporalAuthorityAuditPreview",
  "lastTemporalAuthorityFallbackReason",
  "lastTemporalAuthorityAppliedEngine",
  "lastTemporalAuthorityApplyMode",
  "lastTemporalAuthorityApplied",
  "lastSlotAuthoritativeSnapshot",
  "lastTemporalWasmValidationGateResult",
  "lastTemporalWasmValidationGateReqId",
  "temporalAuthorityPersistenceStatus",
  "visibleRows",
  "collapsedIds",
  "canUndo",
  "canRedo",
  "variances",
  "normalized",
  "rawResult",
]);

const FORBIDDEN_TASK_KEYS = new Set([
  "earlyStartMinutes",
  "earlyFinishMinutes",
  "lateStartMinutes",
  "lateFinishMinutes",
  "totalFloatMinutes",
  "isCritical",
]);

export function validatePersistedStatePurity(persisted: PersistedState): string[] {
  const violations: string[] = [];

  const stateEntries = Object.keys(persisted.state as Record<string, unknown>);
  for (const key of stateEntries) {
    if (FORBIDDEN_PERSISTENCE_KEYS.has(key)) {
      violations.push(`state.${key}`);
    }
  }

  persisted.state.tasks.forEach((task, idx) => {
    for (const key of Object.keys(task as Record<string, unknown>)) {
      if (FORBIDDEN_TASK_KEYS.has(key)) {
        violations.push(`state.tasks[${idx}].${key}`);
      }
    }
  });

  return violations;
}

function stripForbiddenPersistenceArtifacts(persisted: PersistedState): PersistedState {
  let didChange = false;
  const nextState: Record<string, unknown> = {
    ...(persisted.state as Record<string, unknown>),
  };

  for (const key of Object.keys(nextState)) {
    if (FORBIDDEN_PERSISTENCE_KEYS.has(key)) {
      delete nextState[key];
      didChange = true;
    }
  }

  const tasksRaw = nextState.tasks;
  if (Array.isArray(tasksRaw)) {
    const cleanedTasks = tasksRaw.map((task) => {
      if (!task || typeof task !== "object") return task;
      const cleanedTask: Record<string, unknown> = {
        ...(task as Record<string, unknown>),
      };
      let taskChanged = false;
      for (const key of Object.keys(cleanedTask)) {
        if (FORBIDDEN_TASK_KEYS.has(key)) {
          delete cleanedTask[key];
          taskChanged = true;
        }
      }
      if (taskChanged) {
        didChange = true;
        return cleanedTask;
      }
      return task;
    });
    nextState.tasks = cleanedTasks;
  }

  if (!didChange) {
    return persisted;
  }

  return {
    ...persisted,
    state: nextState as PersistedState["state"],
  };
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadPersistedState(): Promise<PersistedState | null> {
  try {
    const db = await openDB();
    return await new Promise<PersistedState | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(SESSION_KEY);
      req.onsuccess = () => {
        const data = req.result as PersistedState | undefined;
        if (!data || typeof data.version !== "number") {
          resolve(null);
        } else if (data.version > CURRENT_SCHEMA_VERSION) {
          console.warn("[Persistence] Schema version", data.version, "is newer than supported", CURRENT_SCHEMA_VERSION);
          resolve(null);
        } else {
          resolve(data);
        }
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  } catch (err) {
    console.warn("[Persistence] Failed to load state:", err);
    return null;
  }
}

export function migratePersistedState(persisted: PersistedState): PersistedState {
  const sanitized = stripForbiddenPersistenceArtifacts(persisted);
  if (sanitized.version === CURRENT_SCHEMA_VERSION) return sanitized;
  // Future migrations go here (e.g. version 1 → 2)
  return sanitized;
}

export async function savePersistedState(persisted: PersistedState): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(persisted, SESSION_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch (err) {
    console.warn("[Persistence] Failed to save state:", err);
  }
}
