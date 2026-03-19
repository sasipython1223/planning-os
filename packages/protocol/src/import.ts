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

import type { DiagnosticSeverity } from "./types.js";

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
  };
};
