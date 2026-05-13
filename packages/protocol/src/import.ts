/**
 * @module import
 *
 * Import / Export Protocol Contracts — Phase W
 *
 * Type-only definitions for the import preview, commit, and cancel flow.
 * These contracts define the Worker ↔ UI message shapes for importing
 * external schedules (P6 XER, MS Project XML) into the canonical model.
 *
 * ⚠️ CONTRACT FILE — No parsing, mapping, or mutation logic belongs here.
 * Implementation of parsers and mappers is deferred to W.2+.
 *
 * Design decisions (see W-import-export-architecture.md):
 * - Import diagnostics are separate from runtime constraint diagnostics.
 * - Import diagnostics are derived, non-persisted data.
 * - PREVIEW_IMPORT is read-only (no state mutation, no undo entry).
 * - IMPORT_SCHEDULE is atomic (one undo entry, full state replace).
 * - CANCEL_IMPORT_PREVIEW discards pending preview with no side effects.
 */

import type { BaseCalendarDefinition, CalendarId, DiagnosticSeverity, WorkMinutes } from "./types.js";

// ─── Import Source Format ───────────────────────────────────────────

/** Supported external schedule formats. Extend this union for future formats. */
export type ImportFormat = "xer" | "msp-xml";

// ─── Import Diagnostic Codes ────────────────────────────────────────

/**
 * Import-specific diagnostic codes.
 *
 * Intentionally separate from ConstraintDiagnosticCode (runtime diagnostics).
 * These codes describe what happened during parse + map, not during scheduling.
 *
 * Organized into three categories:
 * - PARSE_*   — structural parse errors (severity: error)
 * - Mapping warnings (severity: warning)
 * - UNSUPPORTED_* — features absent from canonical model (severity: info)
 */
export type ImportDiagnosticCode =
  // ── Parse errors ──────────────────────────────────────────────────
  | "PARSE_MALFORMED_HEADER"
  | "PARSE_MISSING_TABLE"
  | "PARSE_INVALID_ROW"
  | "PARSE_XML_STRUCTURE"
  // ── Mapping warnings ──────────────────────────────────────────────
  | "CONSTRAINT_APPROXIMATED"
  | "DURATION_FRACTIONAL_ROUNDED"
  | "LAG_FRACTIONAL_ROUNDED"
  | "DEPENDENCY_TYPE_UNKNOWN"
  | "CALENDAR_SIMPLIFIED"
  | "MULTI_PROJECT_XER"
  // ── Calendar preservation notices (W3A) ──────────────────────────
  | "CALENDAR_IMPORTED_RICH"
  | "CALENDAR_SIMPLIFIED_FOR_ENGINE"
  | "UNRESOLVED_BASE_CALENDAR"
  | "UNSUPPORTED_EXCEPTION_PATTERN"
  | "TASK_CALENDAR_IGNORED_BY_ENGINE"
  | "RESOURCE_CALENDAR_PRESERVED_INACTIVE"
  | "LAG_CALENDAR_PRESERVED_INACTIVE"
  | "CALENDAR_HOURS_MISMATCH"
  // ── Calendar inheritance (W3C) ──────────────────────────────
  | "CALENDAR_INHERITANCE_LOOP"
  // ── Project settings preservation (W4.3) ───────────────────
  | "PROJECT_DEFAULT_CALENDAR_PRESERVED_INACTIVE"
  | "SCHEDOPTIONS_PRESERVED_INACTIVE"
  | "PROJECT_HOURS_PER_PERIOD_PRESERVED_INACTIVE"
  | "CRITICAL_PATH_SETTING_PRESERVED_INACTIVE"
  | "OUT_OF_SEQUENCE_PROGRESS_SETTING_PRESERVED_INACTIVE"
  // ── Unsupported feature notices ───────────────────────────────────
  | "UNSUPPORTED_ACTUALS"
  | "UNSUPPORTED_COST"
  | "UNSUPPORTED_TASK_CALENDAR"
  | "UNSUPPORTED_RESOURCE_CALENDAR"
  | "UNSUPPORTED_CUSTOM_FIELDS"
  | "UNSUPPORTED_LEVELING"
  | "UNSUPPORTED_TASK_SPLITS"
  | "UNSUPPORTED_RECURRING"
  | "UNSUPPORTED_DEADLINE";

// ─── Import Diagnostic ─────────────────────────────────────────────

/**
 * A single import diagnostic entry.
 *
 * Richer than runtime ConstraintDiagnosticCode — carries context about
 * the external source field, the original value, and what it mapped to.
 * These are surfaced in the preview panel and never persisted.
 */
export type ImportDiagnostic = {
  readonly code: ImportDiagnosticCode;
  readonly severity: DiagnosticSeverity;
  /** Human-readable explanation of the diagnostic. */
  readonly message: string;
  /** External ID of the affected entity in the source file. */
  readonly sourceEntityId?: string;
  /** Canonical ID of the mapped entity (present only if mapping succeeded). */
  readonly canonicalEntityId?: string;
  /** Specific field name that triggered the diagnostic. */
  readonly field?: string;
  /** The original value in the external file before mapping. */
  readonly originalValue?: string;
  /** The canonical value after mapping (present only if mapping produced a value). */
  readonly mappedValue?: string;
};

// ─── Import Summary ─────────────────────────────────────────────────

/**
 * Calendar fidelity summary — counts and status of calendar preservation in import.
 * Shown in preview panel to inform user of calendar-aware import handling (W3A).
 */
export type CalendarFidelitySummary = {
  readonly totalCalendars: number;
  readonly taskCalendarAssignments: number;
  readonly resourceCalendarAssignments: number;
  readonly exceptionCount: number;
  readonly calendarsWithInheritance: number;
  readonly calendarsSimplifiedForEngine: number;
  /** W3C: Number of calendars whose parent/base calendar could not be resolved. */
  readonly unresolvedInheritanceCount?: number;
};

/**
 * Aggregate counts of entities found in the imported file.
 * Shown in the preview panel before the user commits the import.
 */
export type ImportSummary = {
  readonly taskCount: number;
  readonly dependencyCount: number;
  readonly resourceCount: number;
  readonly assignmentCount: number;
  /** Human-readable calendar description, e.g. "5-day workweek, 3 holidays". */
  readonly calendarInfo: string;
  /** Optional import-fidelity counts (W.2). */
  readonly activitiesWithActuals?: number;
  readonly activitiesWithProgress?: number;
  readonly activitiesWithRemainingDuration?: number;
  readonly hasProjectDataDate?: boolean;
  readonly hasProjectStatusDate?: boolean;
  readonly sourceDataDate?: string;
  readonly sourceStatusDate?: string;
  /** Optional calendar fidelity summary (W3A). */
  readonly calendarFidelity?: CalendarFidelitySummary;
};

/**
 * W4.3: Project-level default settings preserved from the imported source file.
 * Informational only — the scheduling engine does not consume these values yet.
 * Surfaced in the import preview and retained in SourceImportRecord so the UI
 * can explain why Planner-Studio recalculation may differ from the source schedule.
 */
export type SourceProjectSettings = {
  /** External project identifier (e.g. P6 proj_id, MSP Name). */
  readonly sourceProjectId?: string;
  /** Default calendar identifier in the source system (e.g. P6 clndr_id). */
  readonly defaultCalendarId?: string;
  /** Human-readable name of the default calendar. */
  readonly defaultCalendarName?: string;
  /** Project planned start date (ISO string). */
  readonly planStartDate?: string;
  /** Source data date (ISO string) — represents schedule cut-off for progress. */
  readonly dataDate?: string;
  /** Source status date (ISO string). */
  readonly statusDate?: string;
  /** Must-finish-by date, if specified in the source (ISO string). */
  readonly mustFinishBy?: string;
  /** XER: day_hr_cnt — hours per working day as reported by the source. */
  readonly hoursPerDay?: number;
  /** XER: week_hr_cnt — hours per working week as reported by the source. */
  readonly hoursPerWeek?: number;
  /** XER: month_hr_cnt — hours per working month as reported by the source. */
  readonly hoursPerMonth?: number;
  /** MSP: MinutesPerDay. */
  readonly minutesPerDay?: number;
  /** MSP: MinutesPerWeek. */
  readonly minutesPerWeek?: number;
  /** MSP: DaysPerMonth. */
  readonly daysPerMonth?: number;
  /** Whether scheduling is from project start ("Start") or finish ("Finish"). */
  readonly scheduleFrom?: string;
  /** Critical path method identifier (e.g. "CPM"). */
  readonly criticalPathMethod?: string;
  /** Total float threshold (days) for critical path designation. */
  readonly criticalFloatThreshold?: number;
  /** Out-of-sequence progress handling mode (e.g. "retained logic", "progress override"). */
  readonly outOfSequenceProgressMode?: string;
  /** Whether the source uses expected finish dates. */
  readonly useExpectedFinishDates?: boolean;
  /** MSP: CalendarUID for the project's default calendar. */
  readonly defaultCalendarUID?: string;
  /** Raw SCHEDOPTIONS rows from XER (key=option_name, value=option_value). */
  readonly rawScheduleOptions?: Readonly<Record<string, unknown>>;
  /** List of setting names that were found but cannot be surfaced in canonical types. */
  readonly unsupportedSettings?: readonly string[];
};

/** Source-system project status/date metadata retained from imported files. */
export type SourceProjectStatus = {
  readonly dataDate?: string;
  readonly statusDate?: string;
  readonly sourceRawDate?: string;
  readonly sourceSystem?: "XER" | "MSP_XML" | "MPP";
};

/** Source actual/date sidecar fields retained per canonical task id. */
export type SourceTaskActuals = {
  readonly actualStartMinutes?: number;
  readonly actualFinishMinutes?: number;
  readonly actualDurationWorkMinutes?: WorkMinutes;
  readonly remainingDurationWorkMinutes?: WorkMinutes;
  readonly remainingStartMinutes?: number;
  readonly remainingFinishMinutes?: number;
  readonly suspendDateMinutes?: number;
  readonly resumeDateMinutes?: number;
  readonly raw?: Readonly<Record<string, unknown>>;
};

/** Source progress sidecar fields retained per canonical task id. */
export type SourceTaskProgress = {
  readonly physicalPercentComplete?: number;
  readonly durationPercentComplete?: number;
  readonly unitsPercentComplete?: number;
  readonly percentComplete?: number;
  readonly percentWorkComplete?: number;
  readonly percentCompleteType?: string;
  readonly raw?: Readonly<Record<string, unknown>>;
};

/** Import fidelity sidecar state (W.2). Scheduling engine must not consume this yet. */
export type SourceImportFidelityState = {
  readonly projectStatus?: SourceProjectStatus;
  readonly actualsByTaskId: Readonly<Record<string, SourceTaskActuals>>;
  readonly progressByTaskId: Readonly<Record<string, SourceTaskProgress>>;
  /** W4: Source-system planned dates keyed by canonical task id. */
  readonly sourceDatesByTaskId?: Readonly<Record<string, SourceTaskDates>>;
};

/** W4: Source-system planned dates sidecar — preserved from the imported schedule, never overwritten. */
export type SourceTaskDates = {
  readonly sourceStartMinutes?: number;
  readonly sourceFinishMinutes?: number;
  readonly sourceRawStart?: string;
  readonly sourceRawFinish?: string;
};

/** W4: Variance severity for a single task date comparison. */
export type VarianceSeverity = "none" | "minor" | "moderate" | "major";

/** W4: Per-task variance between source-system planned dates and Planner-Studio calculated dates. */
export type TaskDateVariance = {
  readonly taskId: string;
  readonly sourceActivityId?: string;
  readonly taskName: string;
  readonly sourceStartMinutes?: number;
  readonly sourceFinishMinutes?: number;
  readonly calculatedStartMinutes?: number;
  readonly calculatedFinishMinutes?: number;
  readonly startVarianceMinutes?: number;
  readonly finishVarianceMinutes?: number;
  readonly varianceSeverity: VarianceSeverity;
  readonly possibleReasons: readonly string[];
  readonly calendarRiskRelated?: boolean;
  readonly constraintRiskRelated?: boolean;
};

/** W4: Full source-vs-planner-calculated variance report. */
export type SourceCalculatedVarianceReport = {
  readonly totalCompared: number;
  readonly noVarianceCount: number;
  readonly startVarianceCount: number;
  readonly finishVarianceCount: number;
  readonly majorVarianceCount: number;
  readonly taskVariances: readonly TaskDateVariance[];
  readonly generatedAt: string;
};

/**
 * Import/scheduling lifecycle shown by the Worker.
 * "sourceImportedNotCalculated" is authoritative for accepted imports
 * until a future explicit recalculation command transitions it.
 */
export type ScheduleLifecycleState =
  | "empty"
  | "importPreview"
  | "sourceImportedNotCalculated"
  | "plannerCalculated"
  | "plannerCalculatedWithVariance";

/** Source-import status retained after an import is committed. */
export type SourceImportStatus =
  | "sourceImportedNotCalculated"
  | "plannerCalculated"
  | "plannerCalculatedWithVariance";

/**
 * Metadata describing the most recently committed source import.
 * Persisted as canonical state so React can truthfully represent source status.
 */
export type SourceImportRecord = {
  readonly format: ImportFormat;
  readonly summary: ImportSummary;
  readonly diagnostics: readonly ImportDiagnostic[];
  readonly sourceFileName?: string;
  readonly status: SourceImportStatus;
  readonly sourceImportFidelityState?: SourceImportFidelityState;
  /** W3A: Preserved rich calendar definitions by ID (not yet active in scheduling). */
  readonly calendarDefinitions?: Readonly<Record<CalendarId, BaseCalendarDefinition>>;
  /** W3C: Resolved/flattened calendar definitions after inheritance resolution. Source definitions preserved above. */
  readonly resolvedCalendarDefinitions?: Readonly<Record<CalendarId, BaseCalendarDefinition>>;
  /** W4.3: Project-level default settings preserved from the source file (informational). */
  readonly sourceProjectSettings?: SourceProjectSettings;
  /** ISO timestamp when the import was committed. */
  readonly importedAt: string;
};

/**
 * Aggregate counts of diagnostics by severity.
 */
export type ImportDiagnosticsSummary = {
  readonly errors: number;
  readonly warnings: number;
  readonly infos: number;
};

// ─── Commands: UI → Worker ──────────────────────────────────────────

/**
 * Request the Worker to parse and preview an external schedule file.
 *
 * This is a **read-only** command:
 * - Does NOT mutate canonical state.
 * - Does NOT enter the undo stack.
 * - Does NOT trigger scheduling.
 *
 * The Worker parses the file, maps fields, collects diagnostics,
 * and responds with an IMPORT_PREVIEW message.
 *
 * If the file is too large or structurally unparseable, the Worker
 * responds with a NACK instead.
 */
export type PreviewImportCommand = {
  readonly type: "PREVIEW_IMPORT";
  readonly v: 1;
  readonly reqId: string;
  readonly payload: {
    /** Which external format this file is in. */
    readonly format: ImportFormat;
    /** Raw file content as a string (text-read by React via FileReader). */
    readonly content: string;
    /** Optional source file name (for retained source metadata after commit). */
    readonly sourceFileName?: string;
  };
};

/**
 * Commit the pending import preview into canonical state.
 *
 * This is an **atomic mutation** command:
 * - Replaces all canonical state (tasks, dependencies, resources, assignments).
 * - Produces one undo entry (full state snapshot).
 * - Triggers scheduling after state replacement.
 * - On scheduling failure, rolls back atomically and NACKs.
 *
 * Carries no payload — the Worker commits the ImportCandidate
 * it is holding from the most recent PREVIEW_IMPORT cycle.
 * This avoids re-transmitting the full file across postMessage.
 *
 * If no pending ImportCandidate exists (stale or never previewed),
 * the Worker responds with a NACK.
 */
export type ImportScheduleCommand = {
  readonly type: "IMPORT_SCHEDULE";
  readonly v: 1;
  readonly reqId: string;
};

/**
 * Explicitly run Planner-Studio scheduling after a source import commit.
 *
 * W4: This transitions lifecycle to plannerCalculatedWithVariance and emits
 * a source-vs-calculated variance report while preserving imported source dates.
 */
export type RunImportedScheduleRecalculationCommand = {
  readonly type: "RUN_IMPORTED_SCHEDULE_RECALCULATION";
  readonly v: 1;
  readonly reqId: string;
};

/**
 * Cancel and discard the pending import preview.
 *
 * The Worker discards the held ImportCandidate (if any) and ACKs.
 * No state change occurs. Safe to call even if no preview is pending.
 */
export type CancelImportPreviewCommand = {
  readonly type: "CANCEL_IMPORT_PREVIEW";
  readonly v: 1;
  readonly reqId: string;
};

// ─── Messages: Worker → UI ──────────────────────────────────────────

/**
 * Worker response to a successful PREVIEW_IMPORT command.
 *
 * Contains the parsed summary, diagnostics, and a readiness flag.
 * The UI renders this in a preview panel for user review before commit.
 *
 * If parsing fails entirely, the Worker sends a NACK instead of this message.
 */
export type ImportPreviewMessage = {
  readonly type: "IMPORT_PREVIEW";
  readonly v: 1;
  readonly reqId: string;
  readonly payload: {
    /** Display name of the project from the imported file. */
    readonly projectName: string;
    /** Project start date extracted from the imported file (ISO 8601 date string). */
    readonly projectStartDate: string;
    /** Source format that was parsed. */
    readonly format: ImportFormat;
    /** Optional source file name provided by the UI. */
    readonly sourceFileName?: string;
    /** Aggregate entity counts. */
    readonly summary: ImportSummary;
    /** Individual diagnostic entries from parse + map. */
    readonly diagnostics: readonly ImportDiagnostic[];
    /** Aggregate diagnostic counts by severity. */
    readonly diagnosticsSummary: ImportDiagnosticsSummary;
    /**
     * Whether the import is safe to commit.
     * false if any error-severity diagnostics exist.
     * UI should disable the "Import" button when false.
     */
    readonly canCommit: boolean;
    /** W4.3: Project-level default settings preserved from the source file (informational). */
    readonly sourceProjectSettings?: SourceProjectSettings;
  };
};
