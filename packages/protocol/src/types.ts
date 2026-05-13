// ─── Y.0: Branded Temporal Types ────────────────────────────────────
// Phase Y — Granularity Migration foundation.
// Canonical schedule math is now minute-native (1 working day = 480 minutes).
// UI/import/export conversions happen at system edges.
// Branded types prevent accidental day/minute confusion at compile time.

declare const __workMinutesBrand: unique symbol;
/** Branded integer type for all schedule time quantities (durations, offsets, float). */
export type WorkMinutes = number & { readonly __brand: typeof __workMinutesBrand };

/** Standard working day = 480 minutes (8 hours × 60 minutes). */
export const MINUTES_PER_DAY = 480 as WorkMinutes;

// ─── Phase B: Calendar Configuration Types ─────────────────────────
// Calendar identity, provenance, and configuration types.
// Phase B: single project calendar with workingWeekPattern + holidays.

declare const __calendarIdBrand: unique symbol;
/**
 * Branded string identifying a calendar entity.
 * In Phase B, only the DEFAULT_CALENDAR_ID value is used.
 * Future phases introduce task/resource calendars.
 */
export type CalendarId = string & { readonly __brand: typeof __calendarIdBrand };

/** The default (project-level) calendar identifier. Phase B: the only active calendar. */
export const DEFAULT_CALENDAR_ID = "default" as CalendarId;

/**
 * Working-week pattern for a project calendar.
 * Phase B: MON_FRI (skip weekends) or ALL_DAYS (no recurring non-working days).
 */
export type WorkingWeekPattern = "MON_FRI" | "ALL_DAYS";

/**
 * Calendar configuration — a named calendar with working-week pattern and holidays.
 * Phase B: single project calendar with weekday pattern + holiday exception dates.
 * Phase D+: may vary per-calendar to support non-standard day lengths.
 */
export type CalendarConfig = {
  readonly id: CalendarId;
  readonly name: string;
  /**
   * Working minutes in one day for this calendar.
   * Phase B: always 480 (8 × 60). Consulted by KernelTemporalAdapter.
   * Phase D+: may vary per-calendar to support non-standard day lengths.
   */
  readonly minutesPerDay: WorkMinutes;
  /** Recurring weekly non-working pattern. */
  readonly workingWeekPattern: WorkingWeekPattern;
  /** Exception non-working dates as ISO strings (YYYY-MM-DD). */
  readonly holidays: readonly string[];
};

/**
 * Calendar provenance metadata — attached to projection/debug output
 * to trace which calendar identity was applied.
 * Phase A: always resolves to DEFAULT_CALENDAR_ID.
 */
export type CalendarProvenance = {
  readonly calendarId: CalendarId;
};

// ─── Track A Step 1: Calendar Domain Types ─────────────────────────
// Rich calendar definitions for future temporal-engine integration.
// Step 1: types and canonical state shape only — no scheduling behavior change.
// No resolver, no kernel, no pipeline reads these yet.

/**
 * A contiguous working-time interval within a single day.
 * Values are minutes since midnight (0–1440).
 */
export type TimeInterval = {
  /** Minute-of-day for interval start (e.g. 480 = 08:00). */
  readonly startMinute: number;
  /** Minute-of-day for interval end (e.g. 1020 = 17:00). Must be > startMinute. */
  readonly endMinute: number;
};

/**
 * Day-of-week index following JavaScript Date.getDay() convention.
 * 0 = Sunday, 1 = Monday, …, 6 = Saturday.
 */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Weekly recurring work pattern — working-time intervals for each day.
 * Missing day key or empty array = non-working day.
 * Present key with intervals = working day with those hours.
 */
export type WeeklyWorkPattern = Partial<Readonly<Record<DayOfWeek, readonly TimeInterval[]>>>;

/**
 * Date-specific calendar exception (holiday or non-standard working day).
 * Overrides the weekly pattern for the specified date.
 */
export type CalendarDateException = {
  /** ISO date string (YYYY-MM-DD). */
  readonly date: string;
  /** Working intervals for this date. Empty array = non-working day override. */
  readonly workIntervals: readonly TimeInterval[];
  /** Optional human-readable label (e.g. "Christmas Day", "Half Day Friday"). */
  readonly name?: string;
};

/**
 * Full calendar definition — authoritative working-time specification.
 * Richer than Phase B CalendarConfig: structured per-day intervals,
 * typed date exceptions with optional labels.
 *
 * Track A Step 1: stored in canonical state only.
 * No resolver, no temporal engine, no scheduling pipeline reads this yet.
 */
export type BaseCalendarDefinition = {
  readonly id: CalendarId;
  readonly name: string;
  /** Source calendar type when known (P6: 0=global, 1=resource, 2=project). */
  readonly sourceCalendarType?: "global" | "project" | "resource" | "unknown";
  /** Source-reported hours per period (if provided by import source). */
  readonly sourceHoursPerDay?: number;
  readonly sourceHoursPerWeek?: number;
  readonly sourceHoursPerMonth?: number;
  readonly sourceHoursPerYear?: number;
  /**
   * Origin of weeklyPattern in import sidecar data.
   * - parsed: detailed source periods parsed from source calendar data
   * - inferred-hours: derived conservatively from hours/day + hours/week
   * - inferred-name: fallback derived from calendar name hints (5d/6d/7d)
   * - none: no usable weekly pattern information available
   */
  readonly workingPatternSource?: "parsed" | "inferred-hours" | "inferred-name" | "none";
  /** Recurring weekly work pattern with per-day time intervals. */
  readonly weeklyPattern: WeeklyWorkPattern;
  /** Date-specific exceptions (holidays, special working days). */
  readonly exceptions: readonly CalendarDateException[];
  /**
   * W3C: Optional reference to parent/base calendar ID for inheritance.
   * Preserved from source (XER base_clndr_id / MSP BaseCalendarUID).
   * Not resolved by the engine — sidecar metadata only.
   */
  readonly parentCalendarId?: CalendarId;
};

/**
 * Maps entity IDs to their assigned CalendarId.
 * Used for task→calendar and resource→calendar canonical state.
 *
 * Track A Step 1: placeholder maps in Worker state. Not yet read by any pipeline.
 */
export type CalendarAssignmentMap = Readonly<Record<string, CalendarId>>;

/**
 * Composite calendar assignment state for the project.
 * Bundles the project-level calendar ID with per-entity assignment maps.
 *
 * Track A Step 1: canonical shape only. No pipeline reads this yet.
 */
export type CalendarAssignmentState = {
  readonly projectCalendarId: CalendarId;
  readonly taskCalendarIds: CalendarAssignmentMap;
  readonly resourceCalendarIds: CalendarAssignmentMap;
};

/** Planner-Studio calendar classification. */
export type PlannerCalendarType = "Global" | "Project" | "Resource";

/** Provenance and editability of a calendar shown in Calendar Settings. */
export type PlannerCalendarSource = "imported-readonly" | "planner-editable" | "cloned-from-import";

/** Date exception classification for calendar customization. */
export type PlannerCalendarExceptionType = "non-working" | "working-exception" | "half-day" | "custom";

/** Editable Planner-Studio exception row for a specific date. */
export type PlannerCalendarException = {
  readonly date: string;
  readonly type: PlannerCalendarExceptionType;
  readonly workIntervals: readonly TimeInterval[];
  readonly name?: string;
};

/**
 * Planner-Studio editable calendar model (C1A/C1B foundation).
 * Imported source calendars remain read-only source truth and are not mutated.
 */
export type PlannerCalendar = {
  readonly calendarId: CalendarId;
  readonly name: string;
  readonly type: PlannerCalendarType;
  readonly source: PlannerCalendarSource;
  readonly parentCalendarId?: CalendarId;
  readonly isDefaultProjectCalendar: boolean;
  readonly hoursPerDay: number;
  readonly hoursPerWeek: number;
  readonly hoursPerMonth: number;
  readonly hoursPerYear: number;
  readonly weeklyHours: Readonly<Record<DayOfWeek, number>>;
  readonly weeklyWorkPeriods: WeeklyWorkPattern;
  readonly exceptions: readonly PlannerCalendarException[];
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ConstraintType =
  | "ASAP"
  | "ALAP"
  | "SNET"
  | "FNLT"
  | "MSO"
  | "MFO";

/* ------------------------------------------------------------------ */
/*  Constraint Diagnostics (V.10b)                                     */
/* ------------------------------------------------------------------ */

/** Constraint diagnostic codes — input-only and result-derived. */
export type ConstraintDiagnosticCode =
  | "MISSING_DATE_FOR_CONSTRAINT"
  | "DATE_IGNORED_BY_MODE"
  | "GENERATING_NEGATIVE_FLOAT"
  | "SUPERSEDED_BY_LOGIC"
  | "SUPERSEDED_BY_CALENDAR";

/** Diagnostics keyed by task id. Codes only — React maps to UI. Derived — never persisted. */
export type DiagnosticsMap = Record<string, ConstraintDiagnosticCode[]>;

/** Severity levels for constraint diagnostics — ordered by priority. */
export type DiagnosticSeverity = "error" | "warning" | "info";

/** Numeric rank for severity comparison — higher = more severe. */
export const SEVERITY_RANK: Record<DiagnosticSeverity, number> = { error: 2, warning: 1, info: 0 };

export type Task = {
  id: string;
  /** Optional original activity identifier from imported source files (e.g., XER task_code, MSP <ID>). */
  sourceActivityId?: string;
  /** Optional planner-facing manual activity identifier for non-imported tasks. */
  activityCode?: string;
  /** Optional structural marker for imported summary/WBS rows, even when they currently have zero children. */
  isStructuralSummary?: boolean;
  name: string;
  durationWorkMinutes: WorkMinutes;
  minEarlyStartMinutes?: WorkMinutes;
  parentId?: string;
  /** Lexicographic ordering key among siblings sharing the same parentId. */
  siblingOrder: string;
  constraintType?: ConstraintType;
  constraintDateMinutes?: WorkMinutes | null;
  /**
   * Phase C: optional assigned calendar for this task.
   * undefined → inherits project calendar (do not write project calendar ID here).
   * Before Phase D, scheduling always uses the project calendar regardless.
   */
  assignedCalendarId?: CalendarId;
};

/**
 * Enriched row projected by the Worker for UI rendering.
 * Contains hierarchy metadata + all display fields.
 * UI must never compute these — they come pre-computed from the Worker.
 */
export type VisibleRow = Task & {
  /** Hierarchy depth (0 = root). Derived from parentId chain. */
  depth: number;
  /** True if the row is structural summary (by source marker or by having children). */
  isSummary: boolean;
  isCollapsed: boolean;
  canExpand: boolean;
  /** Computed WBS code, e.g. "1.2.3". Never persisted. */
  wbsCode: string;
  // ── Phase 3: Summary rollup fields (derived, never persisted) ─────
  /** Rolled-up start (min child ES for summaries, own ES for leaves). null if unscheduled. */
  rollupStartMinutes: WorkMinutes | null;
  /** Rolled-up finish (max child EF for summaries, own EF for leaves). null if unscheduled. */
  rollupFinishMinutes: WorkMinutes | null;
  /** Rolled-up duration (finish − start). null if unscheduled. */
  rollupDurationMinutes: WorkMinutes | null;

  // ── Phase 3B: Business rollup fields (derived, never persisted) ───
  /** Rolled-up cost (sum of children for summaries, own cost for leaves). null if no cost data. */
  rollupCost: number | null;
  /** Rolled-up work (sum of children for summaries, own durationWorkMinutes for leaves). null if no data. */
  rollupWorkMinutes: WorkMinutes | null;
  /** Rolled-up percent complete (weighted by work for summaries, own value for leaves). null if no progress data. */
  rollupPercentComplete: number | null;

  // ── Phase B: Calendar provenance (derived, never persisted) ───────
  /** Calendar identity applied to this row. Phase B: always DEFAULT_CALENDAR_ID. */
  calendarId?: CalendarId;

  // ── Phase C: Task calendar metadata (derived, never persisted) ────
  /** Assigned calendar for this task. undefined = inherits project calendar. */
  assignedCalendarId?: CalendarId;
  /** Calendar actually used for scheduling. Phase C: always project calendar. */
  computationalCalendarId?: CalendarId;
  /** Calendar warnings (e.g. CALENDAR_DIVERGENCE). Empty/undefined = no warnings. */
  calendarWarnings?: readonly string[];
};

export type DependencyType = "FS" | "SS" | "FF" | "SF";

export type Dependency = {
  id: string;
  predId: string;
  succId: string;
  type: DependencyType;
  lagWorkMinutes: WorkMinutes;
};

export type Resource = {
  id: string;
  name: string;
  maxUnitsPerDay: number;
};

export type Assignment = {
  id: string;
  taskId: string;
  resourceId: string;
  unitsPerDay: number;
};

export type AddTaskCommand = {
  type: "ADD_TASK";
  v: 1;
  reqId: string;
  payload: Task;
};

export type UpdateTaskCommand = {
  type: "UPDATE_TASK";
  v: 1;
  reqId: string;
  taskId: string;
  updates: {
    name?: string;
    durationWorkMinutes?: WorkMinutes;
    minEarlyStartMinutes?: WorkMinutes;
    parentId?: string | null;
    constraintType?: ConstraintType;
    constraintDateMinutes?: WorkMinutes | null;
    /** Phase C: assign a calendar to this task. null → clear (inherit project calendar). */
    assignedCalendarId?: CalendarId | null;
  };
};

export type AddDependencyCommand = {
  type: "ADD_DEPENDENCY";
  v: 1;
  reqId: string;
  payload: Dependency;
};

export type DeleteTaskCommand = {
  type: "DELETE_TASK";
  v: 1;
  reqId: string;
  taskId: string;
};

export type DeleteDependencyCommand = {
  type: "DELETE_DEPENDENCY";
  v: 1;
  reqId: string;
  dependencyId: string;
};

export type UpdateDependencyCommand = {
  type: "UPDATE_DEPENDENCY";
  v: 1;
  reqId: string;
  dependencyId: string;
  updates: {
    type?: DependencyType;
    lagWorkMinutes?: WorkMinutes;
  };
};

export type SnapshotBaselineCommand = {
  type: "SNAPSHOT_BASELINE";
  v: 1;
  reqId: string;
};

export type ClearBaselineCommand = {
  type: "CLEAR_BASELINE";
  v: 1;
  reqId: string;
};

export type AddResourceCommand = {
  type: "ADD_RESOURCE";
  v: 1;
  reqId: string;
  payload: Resource;
};

export type UpdateResourceCommand = {
  type: "UPDATE_RESOURCE";
  v: 1;
  reqId: string;
  resourceId: string;
  updates: {
    name?: string;
    maxUnitsPerDay?: number;
  };
};

export type DeleteResourceCommand = {
  type: "DELETE_RESOURCE";
  v: 1;
  reqId: string;
  resourceId: string;
};

export type AddAssignmentCommand = {
  type: "ADD_ASSIGNMENT";
  v: 1;
  reqId: string;
  payload: Assignment;
};

export type UpdateAssignmentCommand = {
  type: "UPDATE_ASSIGNMENT";
  v: 1;
  reqId: string;
  assignmentId: string;
  updates: {
    unitsPerDay?: number;
  };
};

export type DeleteAssignmentCommand = {
  type: "DELETE_ASSIGNMENT";
  v: 1;
  reqId: string;
  assignmentId: string;
};

export type UndoCommand = {
  type: "UNDO";
  v: 1;
  reqId: string;
};

export type RedoCommand = {
  type: "REDO";
  v: 1;
  reqId: string;
};

/**
 * Toggle collapse/expand on a hierarchy node.
 * Worker-only hierarchy operation — no scheduling needed.
 */
export type ToggleNodeCommand = {
  type: "TOGGLE_NODE";
  v: 1;
  reqId: string;
  /** The task id to toggle collapse/expand. */
  id: string;
  /** The task currently at the top of the viewport (for anchor preservation). */
  anchorTaskId?: string;
};

// ── Phase 2: Structural Mutation Commands ────────────────────────────

/** Indent a task: make it a child of its previous sibling at the same level. */
export type IndentTaskCommand = {
  type: "INDENT_TASK";
  v: 1;
  reqId: string;
  taskId: string;
};

/** Outdent a task: move it up one level to be a sibling after its current parent. */
export type OutdentTaskCommand = {
  type: "OUTDENT_TASK";
  v: 1;
  reqId: string;
  taskId: string;
};

/** Move a task to a new parent, optionally positioned after a sibling. */
export type MoveTaskCommand = {
  type: "MOVE_TASK";
  v: 1;
  reqId: string;
  taskId: string;
  /** New parent id, or null/undefined for root. */
  newParentId?: string | null;
  /** Place after this sibling under the new parent. Omit to place first. */
  afterTaskId?: string;
};

/** Reorder a task among its siblings without changing parent. */
export type ReorderTaskCommand = {
  type: "REORDER_TASK";
  v: 1;
  reqId: string;
  taskId: string;
  /** Place after this sibling. Omit to place first among siblings. */
  afterTaskId?: string;
};

/** Expand all collapsed nodes — clears collapsedIds, no scheduling. */
export type ExpandAllCommand = {
  type: "EXPAND_ALL";
  v: 1;
  reqId: string;
  anchorTaskId?: string;
};

/** Collapse all summary nodes — adds all summaries to collapsedIds, no scheduling. */
export type CollapseAllCommand = {
  type: "COLLAPSE_ALL_NODES";
  v: 1;
  reqId: string;
  anchorTaskId?: string;
};

// AI-FPA.3E: read-only float path query command.
import type { FloatPathMvpError, FloatPathMvpResponse } from "./kernel.js";

/**
 * Request read-only float path analysis from the worker.
 * Consumes the latest solved schedule results + current dependencies.
 * Does not mutate canonical state.
 */
export type AnalyzeFloatPathsCommand = {
  type: "ANALYZE_FLOAT_PATHS";
  v: 1;
  reqId: string;
  targetTaskId: string;
  maxPaths: number;
  nearCriticalThresholdMinutes: number;
};

/** Create or update an editable Planner-Studio calendar. */
export type UpsertPlannerCalendarCommand = {
  type: "UPSERT_PLANNER_CALENDAR";
  v: 1;
  reqId: string;
  payload: PlannerCalendar;
};

/** Clone a read-only imported calendar into an editable Planner-Studio calendar. */
export type CloneImportedCalendarCommand = {
  type: "CLONE_IMPORTED_CALENDAR";
  v: 1;
  reqId: string;
  sourceCalendarId: CalendarId;
  newName?: string;
};

/** Set project default calendar ID (project calendar remains computationally active). */
export type SetProjectDefaultCalendarCommand = {
  type: "SET_PROJECT_DEFAULT_CALENDAR";
  v: 1;
  reqId: string;
  calendarId: CalendarId;
};

/** Assign calendar to multiple activities (stored metadata; scheduling remains project-calendar only). */
export type AssignCalendarToActivitiesCommand = {
  type: "ASSIGN_CALENDAR_TO_ACTIVITIES";
  v: 1;
  reqId: string;
  calendarId: CalendarId;
  taskIds: readonly string[];
};

/**
 * W5B-B2.3C: Request real WASM validation diagnostic (diagnostic-only, no state mutation).
 * Runs 7 controlled temporal scheduling scenarios to validate WASM availability and correctness.
 * Never applies temporal results; authorityApplied always false.
 */
export type RunTemporalWasmValidationGateCommand = {
  type: "RUN_TEMPORAL_WASM_VALIDATION_GATE";
  v: 1;
  reqId: string;
  /** If true, only allow command in internal/test mode. */
  internalOnly?: boolean;
};

/**
 * W5B-B2.4A: Request temporal candidate projection (diagnostic-only skeleton).
 * This command must not mutate canonical state or apply temporal authority.
 */
export type RunTemporalCandidateProjectionCommand = {
  type: "RUN_TEMPORAL_CANDIDATE_PROJECTION";
  v: 1;
  reqId: string;
  /** If true, only allow command in internal/test mode. */
  internalOnly?: boolean;
  /**
   * Dev/test-only diagnostic gate overrides for manual evidence runs.
   * These must never flip authority or apply temporal results.
   */
  devOverrides?: {
    temporalCandidateProjectionEnabled?: boolean;
    temporalAuthorityRolloutRing?: TemporalAuthorityRolloutRing;
    temporalAuthorityEmergencyRollback?: boolean;
    realWasmValidationPassed?: boolean;
    sourceProtectionStatus?: "ok" | "blocked" | "not_evaluated_wasm_unavailable" | "violated";
    temporalEngineAvailable?: boolean;
    useLastSuccessfulWasmGate?: boolean;
  };
};

/**
 * W5B-B2.5B: Request temporal authority cutover decision (diagnostic-only).
 * This command evaluates runtime gate state and returns decision diagnostics.
 * It must never apply temporal authority or mutate canonical state.
 */
export type RunTemporalAuthorityCutoverDecisionCommand = {
  type: "RUN_TEMPORAL_AUTHORITY_CUTOVER_DECISION";
  v: 1;
  reqId: string;
  /** If true, only allow dev/test input overrides when internal guards permit. */
  internalOnly?: boolean;
  /** Internal diagnostic overrides for gate input evaluation (never authority apply). */
  inputOverrides?: Partial<TemporalAuthorityCutoverGateInput>;
};

/**
 * W5B-B2.5C: Request temporal authority apply path (stub-only, slot fallback).
 * Evaluates cutover gates and returns an apply audit preview without applying authority.
 */
export type RunTemporalAuthorityApplyCommand = {
  type: "RUN_TEMPORAL_AUTHORITY_APPLY";
  v: 1;
  reqId: string;
  /** If true, only allow dev/test input overrides when internal guards permit. */
  internalOnly?: boolean;
  /** Internal diagnostic overrides for gate input evaluation (never authority apply in B2.5C). */
  inputOverrides?: Partial<TemporalAuthorityCutoverGateInput>;
  /**
   * W5B-B2.9: Explicit operator acknowledgement for the dogfood ring.
   * Required when `inputOverrides.temporalAuthorityRolloutRing === "dogfood"`.
   * MUST NOT be inferred from evidence count or any other state.
   * Provides no effect for other rings.
   */
  dogfoodAcknowledgement?: TemporalDogfoodOperatorAcknowledgement;
  /**
   * W5B-B2.10A: Optional cmd-level dogfood master-switch override for the
   * dev/test hook path. Honoured ONLY when `internalOnly === true` AND
   * internal diagnostic overrides are allowed by the runtime guard (localhost
   * or `__PLANNER_ALLOW_INTERNAL_DIAGNOSTIC_OVERRIDES === true`).
   *
   * Default posture is unchanged: if absent or `false`, the dogfood master
   * switch is taken from the worker-scope runtime flag
   * `__PLANNER_TEMPORAL_DOGFOOD_AUTHORITY_ENABLED`, which itself defaults
   * `false`. UAT and production rings ignore this field.
   */
  dogfoodAuthorityEnabled?: boolean;
};

/**
 * W5B-B2.9: Explicit operator acknowledgement payload required for the dogfood
 * apply path. Acknowledgement confirms the operator has read the dogfood
 * runbook and accepts that:
 *   - dogfood is experimental;
 *   - rollback is available and understood;
 *   - source dates remain separate from temporal-calculated dates;
 *   - persistence is disabled;
 *   - UAT / production remain disabled;
 *   - unsupported features must block or fallback;
 *   - evidence package must be captured.
 */
export type TemporalDogfoodOperatorAcknowledgement = {
  acknowledged: boolean;
  operatorId?: string;
  acknowledgedAt?: number;
  acknowledgementTextVersion: 1;
};

/**
 * W5B-B2.5D: Explicit rollback command for runtime-only temporal authority apply.
 * Restores the last slot-authoritative snapshot for the current session.
 */
export type RunTemporalAuthorityRollbackCommand = {
  type: "RUN_TEMPORAL_AUTHORITY_ROLLBACK";
  v: 1;
  reqId: string;
  internalOnly?: boolean;
};

/**
 * W5B-B2.5E: Read-only temporal authority diagnostics snapshot.
 * Returns runtime authority state for internal/dev diagnostics UI.
 */
export type RunTemporalAuthorityDiagnosticsCommand = {
  type: "RUN_TEMPORAL_AUTHORITY_DIAGNOSTICS";
  v: 1;
  reqId: string;
  internalOnly?: boolean;
};

// W.1: Import command types are defined in import.ts and joined here.
import type {
    CancelImportPreviewCommand,
    ImportScheduleCommand,
    PreviewImportCommand,
    RunImportedScheduleRecalculationCommand,
    ScheduleLifecycleState,
    SourceCalculatedVarianceReport,
    SourceImportFidelityState,
    SourceImportRecord,
} from "./import.js";

  export type Command = AddTaskCommand | UpdateTaskCommand | AddDependencyCommand | DeleteTaskCommand | DeleteDependencyCommand | UpdateDependencyCommand | SnapshotBaselineCommand | ClearBaselineCommand | AddResourceCommand | UpdateResourceCommand | DeleteResourceCommand | AddAssignmentCommand | UpdateAssignmentCommand | DeleteAssignmentCommand | UndoCommand | RedoCommand | ToggleNodeCommand | IndentTaskCommand | OutdentTaskCommand | MoveTaskCommand | ReorderTaskCommand | ExpandAllCommand | CollapseAllCommand | AnalyzeFloatPathsCommand | UpsertPlannerCalendarCommand | CloneImportedCalendarCommand | SetProjectDefaultCalendarCommand | AssignCalendarToActivitiesCommand | RunTemporalWasmValidationGateCommand | RunTemporalCandidateProjectionCommand | RunTemporalAuthorityCutoverDecisionCommand | RunTemporalAuthorityApplyCommand | RunTemporalAuthorityRollbackCommand | RunTemporalAuthorityDiagnosticsCommand | RunTemporalDogfoodReadinessCheckCommand | PreviewImportCommand | ImportScheduleCommand | RunImportedScheduleRecalculationCommand | CancelImportPreviewCommand;

export type AckMessage = {
  type: "ACK";
  v: 1;
  reqId: string;
};

export type NackMessage = {
  type: "NACK";
  v: 1;
  reqId: string;
  error: string;
};

export type BaselineEntry = {
  startMinutes: WorkMinutes;
  finishMinutes: WorkMinutes;
};

export type BaselineMap = {
  [taskId: string]: BaselineEntry;
};

export type ScheduleResultMap = {
  [taskId: string]: {
    earlyStartMinutes: WorkMinutes;
    earlyFinishMinutes: WorkMinutes;
    lateStartMinutes: WorkMinutes;
    lateFinishMinutes: WorkMinutes;
    totalFloatMinutes: WorkMinutes;
    isCritical: boolean;
  };
};

export type TaskVariance = {
  startVarianceMinutes: WorkMinutes;
  finishVarianceMinutes: WorkMinutes;
  durationVarianceMinutes: WorkMinutes;
};

export type VarianceMap = Record<string, TaskVariance>;

export type ResourceHistogram = Record<string, Record<number, number>>;

/**
 * Per-dependency driving diagnostic computed by the worker after each RESCHEDULE.
 * isDriving is undefined when data is unavailable (missing schedule results, summary tasks).
 */
export type DependencyDiagnostic = {
  dependencyId: string;
  isDriving?: boolean;
  linkSlackMinutes?: number;
  controllingDate?: "ES" | "EF";
};

/** Keyed by dependency id. */
export type DependencyDiagnosticsMap = Record<string, DependencyDiagnostic>;

export type DiffStateMessage = {
  type: "DIFF_STATE";
  v: 1;
  payload: {
    tasks: Task[];
    dependencies: Dependency[];
    scheduleResults: ScheduleResultMap;
    baselines: BaselineMap;
    variances: VarianceMap;
    projectStartDate: string;
    nonWorkingDays: number[];
    resources: Resource[];
    assignments: Assignment[];
    resourceHistogram: ResourceHistogram;
    diagnosticsMap?: DiagnosticsMap;
    dependencyDiagnostics?: DependencyDiagnosticsMap;
    canUndo: boolean;
    canRedo: boolean;
    /** Worker-generated visible rows — pre-filtered for collapse state. */
    visibleRows: VisibleRow[];
    /** IDs of currently collapsed nodes. */
    collapsedIds: string[];
    /** Worker-authoritative import/scheduling lifecycle state. */
    scheduleLifecycle: ScheduleLifecycleState;
    /** Metadata for the most recently committed source import (if any). */
    sourceImportRecord: SourceImportRecord | null;
    /** Sidecar preserved source actuals/progress/project-status (W.2). */
    sourceImportFidelityState: SourceImportFidelityState;
    /** W4: source-system vs planner-calculated variance report (if generated). */
    sourceCalculatedVarianceReport?: SourceCalculatedVarianceReport;
    /** C1A/C1B: Editable Planner-Studio calendars. Imported calendars remain read-only. */
    plannerCalendars?: Record<string, PlannerCalendar>;
  };
};

/**
 * Lightweight response for TOGGLE_NODE — no scheduling was needed.
 * Carries the new visible rows and anchor index for scroll preservation.
 */
export type VisibleRowsUpdateMessage = {
  type: "VISIBLE_ROWS_UPDATE";
  v: 1;
  reqId: string;
  payload: {
    visibleRows: VisibleRow[];
    totalVisibleRowCount: number;
    newAnchorIndex: number;
    collapsedIds: string[];
  };
};

export type WorkerReadyMessage = {
  type: "WORKER_READY";
  v: 1;
};

/**
 * Read-only float path analysis success payload.
 */
export type FloatPathResultMessage = {
  type: "FLOAT_PATH_RESULT";
  v: 1;
  reqId: string;
  payload: FloatPathMvpResponse;
};

/**
 * Read-only float path analysis error payload.
 */
export type FloatPathErrorMessage = {
  type: "FLOAT_PATH_ERROR";
  v: 1;
  reqId: string;
  error: FloatPathMvpError;
};

export type ScheduleErrorMessage = {
  type: "SCHEDULE_ERROR";
  v: 1;
  error: {
    type: "DuplicateTaskId" | "SelfDependency" | "TaskNotFound" | "CycleDetected";
    message: string;
    taskId?: string;
  };
};

/** W5B-B2.3C: Single validation scenario result within gate result. */
export type TemporalWasmValidationScenarioResult = {
  readonly name: string;
  readonly status: "passed" | "failed" | "blocked";
  readonly expectedDivergenceTaskIds: readonly string[];
  readonly unexplainedDivergenceTaskIds: readonly string[];
  readonly error?: string;
};

/** W5B-B2.3C: Result payload for real WASM validation gate diagnostic. */
export type TemporalWasmValidationGatePayload = {
  readonly realWasmValidationPassed: boolean;
  readonly wasmLoadMode: "real" | "unavailable" | "mocked";
  readonly scenariosPlanned: number;
  readonly scenariosExecuted: number;
  readonly scenariosPassed: number;
  readonly scenariosFailed: number;
  readonly scenariosBlocked: number;
  readonly blockerReason?: string;
  readonly temporalExecutionErrors: readonly string[];
  readonly unexplainedDivergenceTaskIds: readonly string[];
  readonly expectedDivergenceTaskIds: readonly string[];
  readonly sourceProtectionStatus: "ok" | "blocked" | "not_evaluated_wasm_unavailable" | "violated";
  readonly authorityApplied: false;
  readonly performanceMs: number | null;
  readonly scenarioResults: readonly TemporalWasmValidationScenarioResult[];
};

/** W5B-B2.3C: Worker response for real WASM validation gate diagnostic. */
export type TemporalWasmValidationGateMessage = {
  type: "TEMPORAL_WASM_VALIDATION_GATE_RESULT";
  v: 1;
  reqId: string;
  payload: TemporalWasmValidationGatePayload;
};

export type TemporalAuthorityRolloutRing =
  | "off"
  | "internal_test"
  | "dogfood"
  | "uat"
  | "production";

export type TemporalAuthorityEngineMode =
  | "slot_authoritative"
  | "temporal_candidate_only"
  | "temporal_authoritative"
  | "slot_fallback";

export type TemporalAuthorityRequestedEngineMode =
  | "slot_authoritative"
  | "temporal_candidate_only"
  | "temporal_authoritative";

export type TemporalAuthorityCutoverFallbackReason =
  | "rollout_ring_off"
  | "temporal_authority_disabled"
  | "emergency_rollback_active"
  | "real_wasm_gate_not_passed"
  | "candidate_projection_unavailable"
  | "candidate_comparison_missing"
  | "candidate_authority_precondition_failed"
  | "temporal_execution_error"
  | "unexplained_divergence_over_threshold"
  | "source_protection_not_ok"
  | "unsupported_feature_detected"
  | "unsupported_project_profile"
  | "resource_calendar_not_supported"
  | "lag_calendar_not_supported"
  | "p6_semantics_not_supported"
  | "performance_threshold_exceeded"
  | "lifecycle_safety_failed";

export type TemporalAuthorityCutoverGatePassMatrix = {
  rolloutRingEnabled: boolean;
  temporalAuthorityEnabled: boolean;
  emergencyRollbackClear: boolean;
  realWasmGate: boolean;
  candidateProjectionAvailable: boolean;
  candidateComparisonPresent: boolean;
  candidateAuthorityPrecondition: boolean;
  temporalExecutionErrorFree: boolean;
  unexplainedDivergenceWithinTolerance: boolean;
  sourceProtectionValid: boolean;
  unsupportedFeatureFlagsAllowed: boolean;
  projectEligibilityProfileSupported: boolean;
  resourceCalendarRequirementSupported: boolean;
  lagCalendarRequirementSupported: boolean;
  p6SemanticsRequirementSupported: boolean;
  performanceWithinThreshold: boolean;
  lifecycleSafetyValid: boolean;
};

export type TemporalAuthorityCutoverGateInput = {
  temporalAuthorityEnabled: boolean;
  temporalCandidateProjectionEnabled: boolean;
  temporalAuthorityRolloutRing: TemporalAuthorityRolloutRing;
  temporalAuthorityEmergencyRollback: boolean;
  requestedAuthorityEngineMode: TemporalAuthorityRequestedEngineMode;
  candidateComparisonRequired: boolean;
  realWasmGateRequired: boolean;
  unexplainedDivergenceTolerance: number;
  supportedProjectProfileRequired: boolean;
  temporalAuthorityPersistenceEnabled: boolean;
  realWasmValidationPassed: boolean;
  wasmLoadMode: "real" | "unavailable" | "mocked";
  candidateProjectionAvailable: boolean;
  candidateComparisonPresent: boolean;
  candidateAuthorityAppliedPreApply: boolean;
  temporalExecutionErrors: string[];
  unexplainedDivergenceCount: number;
  sourceProtectionStatus: "ok" | "blocked" | "not_evaluated_wasm_unavailable" | "violated";
  unsupportedFeatureFlags: string[];
  projectEligibilityProfileSupported: boolean;
  resourceCalendarRequirementDetected: boolean;
  lagCalendarRequirementDetected: boolean;
  p6SemanticsRequirementDetected: boolean;
  performanceMs: number | null;
  performanceThresholdMs: number | null;
  lifecycleSafetyPassed?: boolean;
};

export type TemporalAuthorityCutoverDecision = {
  authorityEngineMode: TemporalAuthorityEngineMode;
  requestedAuthorityEngineMode: TemporalAuthorityRequestedEngineMode;
  rolloutRing: TemporalAuthorityRolloutRing;
  allowed: boolean;
  fallbackRequired: boolean;
  fallbackReason: TemporalAuthorityCutoverFallbackReason | null;
  blockedReasons: TemporalAuthorityCutoverFallbackReason[];
  gatePassMatrix: TemporalAuthorityCutoverGatePassMatrix;
  emergencyRollbackActive: boolean;
  sourceProtectionStatus: "ok" | "blocked" | "not_evaluated_wasm_unavailable" | "violated";
  realWasmGateStatus: {
    required: boolean;
    passed: boolean;
    wasmLoadMode: "real" | "unavailable" | "mocked";
  };
  candidateProjectionStatus: {
    candidateProjectionEnabled: boolean;
    available: boolean;
  };
  comparisonStatus: {
    required: boolean;
    present: boolean;
  };
  unsupportedFeatureFlags: string[];
  unexplainedDivergenceCount: number;
  performanceMs: number | null;
  authorityApplied: false;
};

export type TemporalCandidateProjectionBlockedReason =
  | "candidate_projection_flag_disabled"
  | "emergency_rollback_active"
  | "real_wasm_gate_not_passed"
  | "source_protection_not_ok"
  | "unexplained_divergence_present"
  | "unsupported_project_feature_profile"
  | "temporal_engine_unavailable"
  | "candidate_execution_failed"
  | "candidate_execution_not_implemented";

export type TemporalCandidateTaskResult = {
  taskId: string;
  earlyStart: WorkMinutes | null;
  earlyFinish: WorkMinutes | null;
  lateStart: WorkMinutes | null;
  lateFinish: WorkMinutes | null;
  totalFloat: WorkMinutes | null;
  freeFloat: WorkMinutes | null;
  critical: boolean;
  calendarIdUsed: CalendarId | null;
};

export type TemporalCandidateSummary = {
  projectStart: WorkMinutes | null;
  projectFinish: WorkMinutes | null;
  criticalCount: number;
  totalTaskCount: number;
  scheduledTaskCount: number;
};

export type TemporalCandidateDiagnostics = {
  candidateProjectionAvailable: boolean;
  candidateProjectionBlockedReason: TemporalCandidateProjectionBlockedReason | null;
  unsupportedFeatureFlags: string[];
  temporalExecutionErrors: string[];
  unexplainedDivergenceTaskIds: string[];
  expectedDivergenceTaskIds: string[];
};

export type TemporalCandidateDivergenceSummary = {
  comparedTaskCount: number;
  identicalTaskCount: number;
  expectedCalendarDivergenceCount: number;
  unsupportedFeatureDivergenceCount: number;
  /**
   * W5B-B2.6.2B: summary/WBS rows whose only difference is `isCritical`.
   * These are reclassified out of `unexplainedDivergenceCount` because the
   * apply path discards summary candidate entries (see B2.5H.3 mapper) and
   * recomputes summary critical via `rollupSummarySchedules` (ANY-child rule),
   * so a kernel-vs-rollup mismatch on a summary critical flag is cosmetic.
   * Leaf critical-flag-only divergences remain `unexplained_divergence`.
   */
  expectedSummaryCriticalRollupDivergenceCount: number;
  unexplainedDivergenceCount: number;
  criticalFlagVarianceCount: number;
  maxAbsStartVarianceMinutes: WorkMinutes;
  maxAbsFinishVarianceMinutes: WorkMinutes;
  maxAbsTotalFloatVarianceMinutes: WorkMinutes;
  taskComparisons: TemporalCandidateTaskComparison[];
};

export type TemporalCandidateTaskDivergenceClass =
  | "no_difference"
  | "expected_calendar_related_divergence"
  | "unsupported_feature_divergence"
  | "expected_summary_critical_rollup_divergence"
  | "unexplained_divergence";

/**
 * W5B-B2.12A: read-only diagnostic classification ("bucket") for rows whose
 * `classification === "unexplained_divergence"`. Buckets are HYPOTHESIS-grade
 * heuristics intended only to help operators triage where the slot vs temporal
 * candidate divergence is coming from. They MUST NOT influence gate decisions,
 * the unexplained-divergence count, the cutover fallback reason, the apply
 * path, schedule outputs, or the `unsupportedFeatureFlags` set.
 *
 * Buckets are mutually exclusive — the classifier returns the first matching
 * bucket using a documented priority order. When `classification` is not
 * `"unexplained_divergence"` the field is omitted (or null).
 */
export type TemporalCandidateUnexplainedDivergenceBucket =
  | "calendar_boundary_candidate"
  | "lag_semantics_candidate"
  | "constraint_semantics_candidate"
  | "relationship_chain_candidate"
  | "summary_or_wbs_rollup_candidate"
  | "missing_calendar_metadata_candidate"
  | "unknown_unclassified";

export type TemporalCandidateTaskComparison = {
  taskId: string;
  classification: TemporalCandidateTaskDivergenceClass;
  /**
   * W5B-B2.12A: diagnostic bucket, set only when
   * `classification === "unexplained_divergence"`. Optional/absent on
   * non-unexplained rows. Read-only: does not change counts, gates, or
   * schedule outputs. See `TemporalCandidateUnexplainedDivergenceBucket`.
   */
  unexplainedDivergenceBucket?: TemporalCandidateUnexplainedDivergenceBucket | null;
  startVarianceMinutes: WorkMinutes | null;
  finishVarianceMinutes: WorkMinutes | null;
  lateStartVarianceMinutes: WorkMinutes | null;
  lateFinishVarianceMinutes: WorkMinutes | null;
  totalFloatVarianceMinutes: WorkMinutes | null;
  freeFloatVarianceMinutes: WorkMinutes | null;
  criticalVariance: boolean;
};

export type TemporalCandidateProjection = {
  candidateRunId: string;
  engine: "temporal";
  calculatedAt: number;
  performanceMs: number | null;
  realWasmGateReference: {
    gateReqId: string | null;
    gateVersion: 1;
    realWasmValidationPassedAtRun: boolean;
    wasmLoadModeAtRun: "real" | "unavailable" | "mocked";
  };
  candidateTasks: TemporalCandidateTaskResult[];
  candidateSummary: TemporalCandidateSummary | null;
  diagnostics: TemporalCandidateDiagnostics;
  comparison: TemporalCandidateDivergenceSummary | null;
};

export type TemporalCandidateProjectionGateInput = {
  temporalCandidateProjectionEnabled: boolean;
  temporalAuthorityEmergencyRollback: boolean;
  realWasmValidationPassed: boolean;
  sourceProtectionStatus: "ok" | "blocked" | "not_evaluated_wasm_unavailable" | "violated";
  unexplainedDivergenceTaskIds: readonly string[];
  unsupportedFeatureFlags: readonly string[];
  projectFeatureProfileSupported: boolean;
  rolloutRing: TemporalAuthorityRolloutRing;
  temporalEngineAvailable: boolean;
};

export type TemporalCandidateProjectionGateDecision = {
  allowed: boolean;
  blockedReason: TemporalCandidateProjectionBlockedReason | null;
  rolloutRingAllowed: boolean;
};

export type TemporalCandidateProjectionResultPayload = {
  projection: TemporalCandidateProjection;
  gateDecision: TemporalCandidateProjectionGateDecision;
  authorityApplied: false;
};

export type TemporalCandidateProjectionResultMessage = {
  type: "TEMPORAL_CANDIDATE_PROJECTION_RESULT";
  v: 1;
  reqId: string;
  payload: TemporalCandidateProjectionResultPayload;
};

export type TemporalAuthorityCutoverDecisionResultPayload = {
  decision: TemporalAuthorityCutoverDecision;
  evaluatedAt: number;
  reqId: string;
  authorityApplied: false;
};

export type TemporalAuthorityCutoverDecisionResultMessage = {
  type: "TEMPORAL_AUTHORITY_CUTOVER_DECISION_RESULT";
  v: 1;
  reqId: string;
  payload: TemporalAuthorityCutoverDecisionResultPayload;
};

export type TemporalAuthorityAuditPreview = {
  authorityRunId: string;
  timestamp: number;
  previousAuthorityEngine: string;
  requestedAuthorityEngine: string;
  effectiveAuthorityEngine: string;
  rolloutRing: string;
  realWasmGateReference: {
    gateReqId: string | null;
    gateVersion: 1;
    realWasmValidationPassedAtRun: boolean;
    wasmLoadModeAtRun: "real" | "unavailable" | "mocked";
  } | null;
  candidateRunId: string | null;
  comparisonSummary: TemporalCandidateDivergenceSummary | null;
  appliedTaskCount: number;
  fallbackReason: string | null;
  sourceProtectionStatus: string;
  unsupportedFeatureFlags: string[];
  unexplainedDivergenceCount: number;
  performanceMs: number | null;
  authorityApplied: false;
  persistenceApplied: false;
};

export type TemporalAuthorityApplyResultPayload = {
  decision: TemporalAuthorityCutoverDecision;
  evaluatedAt: number;
  authorityApplied: boolean;
  appliedEngine: "slot" | "temporal";
  fallbackReason: string | null;
  applyMode:
    | "slot_fallback"
    | "internal_runtime_temporal_authoritative"
    | "dogfood_runtime_temporal_authoritative";
  persistenceApplied: false;
  auditPreview: TemporalAuthorityAuditPreview;
  /** W5B-B2.9: rollout ring used for this apply decision. */
  rolloutRing: TemporalAuthorityRolloutRing;
  /** W5B-B2.9: dogfood master switch state at the time of evaluation. */
  dogfoodAuthorityEnabled: boolean;
  /** W5B-B2.9: operator acknowledgement gate state. */
  operatorAcknowledgementStatus: {
    required: boolean;
    provided: boolean;
    acknowledgementTextVersion: 1;
  };
};

export type TemporalAuthorityApplyResultMessage = {
  type: "TEMPORAL_AUTHORITY_APPLY_RESULT";
  v: 1;
  reqId: string;
  payload: TemporalAuthorityApplyResultPayload;
};

export type TemporalAuthorityRollbackResultPayload = {
  authorityRunId: string;
  rolledBack: boolean;
  restoredEngine: "slot_authoritative" | "slot_fallback";
  restoredTaskCount: number;
  fallbackReason: string | null;
  authorityApplied: false;
  persistenceApplied: false;
};

export type TemporalAuthorityRollbackResultMessage = {
  type: "TEMPORAL_AUTHORITY_ROLLBACK_RESULT";
  v: 1;
  reqId: string;
  payload: TemporalAuthorityRollbackResultPayload;
};

export type TemporalAuthorityDiagnosticsPayload = {
  currentAuthorityEngineMode: TemporalAuthorityEngineMode;
  previousAuthorityEngineMode: TemporalAuthorityEngineMode;
  appliedEngine: "slot" | "temporal" | "unknown";
  applyMode:
    | "slot_fallback"
    | "internal_runtime_temporal_authoritative"
    | "dogfood_runtime_temporal_authoritative"
    | "unknown";
  rolloutRing: TemporalAuthorityRolloutRing | "unknown";
  authorityApplied: boolean;
  fallbackReason: string | null;
  lastTemporalAuthorityRunId: string | null;
  lastTemporalAuthorityDecision: TemporalAuthorityCutoverDecision | null;
  lastTemporalAuthorityAuditPreview: TemporalAuthorityAuditPreview | null;
  lastTemporalCandidateRunId: string | null;
  candidateProjectionAvailable: boolean;
  comparisonPresent: boolean;
  unexplainedDivergenceCount: number | null;
  realWasmValidationPassed: boolean | null;
  wasmLoadMode: "real" | "unavailable" | "mocked" | "unknown";
  sourceProtectionStatus: "ok" | "blocked" | "not_evaluated_wasm_unavailable" | "violated" | "unknown";
  persistenceApplied: false;
};

export type TemporalAuthorityDiagnosticsMessage = {
  type: "TEMPORAL_AUTHORITY_DIAGNOSTICS_RESULT";
  v: 1;
  reqId: string;
  payload: TemporalAuthorityDiagnosticsPayload;
};

// W.1: Import preview message is defined in import.ts and joined here.
import type { ImportPreviewMessage } from "./import.js";

// ─── W5B-B2.7: Dogfood control model (DEFAULT OFF) ──────────────────────────
// Dogfood controls form a diagnostic eligibility layer above the existing
// authority apply guard (`canApplyInternalTemporalAuthority`). They never
// apply temporal authority and never persist. The dogfood ring remains
// authority-blocked unless `dogfoodAuthorityEnabled` is explicitly true AND a
// future approved milestone enables the apply path itself.

export type TemporalDogfoodBlockedReason =
  | "dogfood_authority_disabled"
  | "real_wasm_gate_not_passed"
  | "candidate_projection_unavailable"
  | "candidate_comparison_missing"
  | "unexplained_divergence_present"
  | "source_protection_not_ok"
  | "unsupported_feature_detected"
  | "temporal_execution_error"
  | "resource_calendar_not_supported"
  | "lag_calendar_not_supported"
  | "p6_semantics_not_supported"
  | "project_size_exceeds_dogfood_limit"
  | "rollback_not_available"
  | "persistence_not_disabled"
  | "operator_acknowledgement_missing"
  | "evidence_package_missing";

export type TemporalDogfoodEvidenceRequirements = {
  /** B2.6.2 §11 — three distinct clean recommendation-A internal_test runs. */
  requiredCleanRuns: number;
  acceptedCleanRuns: number;
  acceptedFixtures: readonly string[];
  latestEvidenceRecommendation:
    | "ready_for_dogfood_controls_default_off"
    | "evidence_incomplete"
    | "evidence_blocked";
};

export type TemporalDogfoodAllowedProfile = {
  realWasmGatePassed: boolean;
  candidateProjectionAvailable: boolean;
  candidateComparisonPresent: boolean;
  unexplainedDivergenceCount: number;
  unexplainedDivergenceTolerance: number;
  sourceProtectionStatus: "ok" | "blocked" | "not_evaluated_wasm_unavailable" | "violated";
  unsupportedFeatureFlags: readonly string[];
  temporalExecutionErrors: readonly string[];
  persistenceApplied: false;
  rollbackAvailable: boolean;
  projectActivityCount: number;
  projectActivityLimit: number;
  resourceCalendarRequirementDetected: boolean;
  lagCalendarRequirementDetected: boolean;
  p6SemanticsRequirementDetected: boolean;
};

export type TemporalDogfoodControls = {
  dogfoodControlsVersion: 1;
  dogfoodAuthorityEnabled: boolean;
  allowedProjectProfile: TemporalDogfoodAllowedProfile;
  evidenceRequirements: TemporalDogfoodEvidenceRequirements;
  operatorAcknowledgementRequired: boolean;
  operatorAcknowledgementProvided: boolean;
  rollbackRequired: boolean;
  persistencePolicy: "disabled_runtime_only";
};

export type TemporalDogfoodEligibilityDecision = {
  dogfoodControlsVersion: 1;
  eligible: boolean;
  dogfoodAuthorityEnabled: boolean;
  rolloutRing: TemporalAuthorityRolloutRing;
  blockedReasons: TemporalDogfoodBlockedReason[];
  warnings: string[];
  evidenceStatus: TemporalDogfoodEvidenceRequirements;
  allowedProjectProfileStatus: TemporalDogfoodAllowedProfile;
  rollbackStatus: { rollbackAvailable: boolean; rollbackRequired: boolean };
  persistenceStatus: { persistencePolicy: "disabled_runtime_only"; persistenceApplied: false };
  sourceProtectionStatus: "ok" | "blocked" | "not_evaluated_wasm_unavailable" | "violated";
  /** Always literal false — B2.7 never applies authority. */
  authorityApplied: false;
};

/**
 * W5B-B2.7: Dogfood readiness check command (diagnostic-only).
 * - Never applies temporal authority.
 * - Never emits DIFF_STATE.
 * - Never persists.
 * - Never mutates state.
 */
export type RunTemporalDogfoodReadinessCheckCommand = {
  type: "RUN_TEMPORAL_DOGFOOD_READINESS_CHECK";
  v: 1;
  reqId: string;
  internalOnly?: boolean;
};

export type TemporalDogfoodReadinessResultPayload = {
  decision: TemporalDogfoodEligibilityDecision;
  controls: TemporalDogfoodControls;
  evaluatedAt: number;
  evidenceRunCountRequired: number;
  evidenceRunCountAccepted: number;
  evidenceFixtureNames: readonly string[];
  realWasmGateStatus: {
    required: boolean;
    passed: boolean;
    wasmLoadMode: "real" | "unavailable" | "mocked";
  };
  candidateProjectionStatus: {
    candidateProjectionEnabled: boolean;
    available: boolean;
  };
  comparisonStatus: {
    required: boolean;
    present: boolean;
  };
  sourceProtectionStatus: "ok" | "blocked" | "not_evaluated_wasm_unavailable" | "violated";
  persistenceStatus: { persistencePolicy: "disabled_runtime_only"; persistenceApplied: false };
  rollbackStatus: { rollbackAvailable: boolean; rollbackRequired: boolean };
  unsupportedFeatureFlags: readonly string[];
  projectProfileStatus: TemporalDogfoodAllowedProfile;
  authorityApplied: false;
};

export type TemporalDogfoodReadinessResultMessage = {
  type: "TEMPORAL_DOGFOOD_READINESS_RESULT";
  v: 1;
  reqId: string;
  payload: TemporalDogfoodReadinessResultPayload;
};

export type WorkerMessage =
  | AckMessage
  | NackMessage
  | DiffStateMessage
  | WorkerReadyMessage
  | FloatPathResultMessage
  | FloatPathErrorMessage
  | ScheduleErrorMessage
  | VisibleRowsUpdateMessage
  | TemporalWasmValidationGateMessage
  | TemporalCandidateProjectionResultMessage
  | TemporalAuthorityCutoverDecisionResultMessage
  | TemporalAuthorityApplyResultMessage
  | TemporalAuthorityRollbackResultMessage
  | TemporalAuthorityDiagnosticsMessage
  | TemporalDogfoodReadinessResultMessage
  | ImportPreviewMessage;