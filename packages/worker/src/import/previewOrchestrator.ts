/**
 * @module previewOrchestrator
 *
 * Import Preview Orchestrator — W.2 + W.3
 *
 * Coordinates the PREVIEW_IMPORT flow:
 *   1. Validate format and size gate.
 *   2. Run the appropriate parser.
 *   3. Collect parse-level diagnostics.
 *   4. Run canonical mapper (W.3) — if no parse errors.
 *   5. Merge parse + mapper diagnostics.
 *   6. Build summary from mapped entity counts.
 *   7. Build and store an ImportCandidate (with mapped data).
 *   8. Return the IMPORT_PREVIEW message payload.
 *
 * ⚠️ Read-only — no canonical state mutation.
 */

import type {
    Assignment,
    Dependency,
    ImportDiagnostic,
    ImportDiagnosticsSummary,
    ImportFormat,
    ImportPreviewMessage,
    ImportSummary,
    Resource,
    Task,
} from "protocol";
import type { ImportCandidate } from "./importCandidate.js";
import { setPendingCandidate } from "./importCandidate.js";
import { mapMspToCanonical } from "./mappers/mspMapper.js";
import { mapXerToCanonical } from "./mappers/xerMapper.js";
import { parseMspXml } from "./parsers/mspParser.js";
import { parseXer } from "./parsers/xerParser.js";

// ─── Size Gate ──────────────────────────────────────────────────────

/** Maximum file content length in characters (~50 MB of text). */
const MAX_CONTENT_LENGTH = 50 * 1024 * 1024;

// ─── Preview Result ─────────────────────────────────────────────────

export type PreviewResult =
  | { ok: true; message: ImportPreviewMessage }
  | { ok: false; error: string };

// ─── Orchestrator ───────────────────────────────────────────────────

/**
 * Run the full preview pipeline for a PREVIEW_IMPORT command.
 *
 * @param reqId   The request ID for correlation.
 * @param format  The declared source format.
 * @param content The raw file content string.
 * @returns Either an IMPORT_PREVIEW message or an error string for NACK.
 */
export function runImportPreview(
  reqId: string,
  format: ImportFormat,
  content: string,
): PreviewResult {
  // ── Size gate ─────────────────────────────────────────────────
  if (content.length > MAX_CONTENT_LENGTH) {
    return { ok: false, error: "FILE_TOO_LARGE" };
  }

  // ── Format dispatch ───────────────────────────────────────────
  if (format === "msp-xml") {
    return runMspXmlPreview(reqId, format, content);
  }

  // ── XER parse ─────────────────────────────────────────────────
  const parseResult = parseXer(content);

  // Convert parse errors/warnings into ImportDiagnostic entries
  const diagnostics: ImportDiagnostic[] = [];

  for (const err of parseResult.errors) {
    diagnostics.push({
      code: "PARSE_INVALID_ROW",
      severity: "error",
      message: `Line ${err.line}: ${err.message}`,
    });
  }
  for (const warn of parseResult.warnings) {
    diagnostics.push({
      code: "PARSE_MISSING_TABLE",
      severity: "info",
      message: `Line ${warn.line}: ${warn.message}`,
    });
  }

  // Check for fatal: no ERMHDR → parse errors contain the header error
  const hasFatalErrors = parseResult.errors.length > 0;

  // ── Canonical mapping (W.3) ───────────────────────────────────
  const { data } = parseResult;
  let projectName: string;
  let projectStartDate: string;
  let summary: ImportSummary;
  let mappedTasks: readonly Task[] | undefined;
  let mappedDependencies: readonly Dependency[] | undefined;
  let mappedResources: readonly Resource[] | undefined;
  let mappedAssignments: readonly Assignment[] | undefined;

  if (!hasFatalErrors) {
    // Run mapper — produces canonical entities + mapping diagnostics
    const mapResult = mapXerToCanonical(data);
    diagnostics.push(...mapResult.diagnostics);

    projectName = mapResult.projectName;
    projectStartDate = mapResult.projectStartDate;
    mappedTasks = mapResult.tasks;
    mappedDependencies = mapResult.dependencies;
    mappedResources = mapResult.resources;
    mappedAssignments = mapResult.assignments;

    // Summary from mapped counts (may differ from raw due to WBS→summary tasks, TT_WBS skipping)
    summary = {
      taskCount: mapResult.tasks.length,
      dependencyCount: mapResult.dependencies.length,
      resourceCount: mapResult.resources.length,
      assignmentCount: mapResult.assignments.length,
      calendarInfo: data.calendars.length > 0
        ? `${data.calendars.length} calendar(s) found`
        : "No calendar data",
    };
  } else {
    // Fallback to raw counts when parsing had fatal errors
    const project = data.projects[0];
    projectName = project?.proj_short_name ?? "(unknown)";
    projectStartDate = project?.plan_start_date ?? "";
    summary = {
      taskCount: data.tasks.length,
      dependencyCount: data.taskPreds.length,
      resourceCount: data.resources.length,
      assignmentCount: data.taskRsrcs.length,
      calendarInfo: data.calendars.length > 0
        ? `${data.calendars.length} calendar(s) found`
        : "No calendar data",
    };
  }

  // ── Diagnostic summary ────────────────────────────────────────
  const diagnosticsSummary: ImportDiagnosticsSummary = {
    errors: diagnostics.filter(d => d.severity === "error").length,
    warnings: diagnostics.filter(d => d.severity === "warning").length,
    infos: diagnostics.filter(d => d.severity === "info").length,
  };

  const canCommit = diagnosticsSummary.errors === 0;

  // ── Store candidate (staleness guard: replaces any previous) ──
  const candidate: ImportCandidate = {
    format,
    projectName,
    projectStartDate,
    summary,
    diagnostics,
    diagnosticsSummary,
    canCommit,
    rawData: data,
    mappedTasks,
    mappedDependencies,
    mappedResources,
    mappedAssignments,
  };
  setPendingCandidate(candidate);

  // ── Build IMPORT_PREVIEW message ──────────────────────────────
  const message: ImportPreviewMessage = {
    type: "IMPORT_PREVIEW",
    v: 1,
    reqId,
    payload: {
      projectName,
      projectStartDate,
      format,
      summary,
      diagnostics,
      diagnosticsSummary,
      canCommit,
    },
  };

  return { ok: true, message };
}

// ─── MSP XML Preview Pipeline ───────────────────────────────────────

function runMspXmlPreview(
  reqId: string,
  format: ImportFormat,
  content: string,
): PreviewResult {
  // ── Parse XML ─────────────────────────────────────────────────
  const parseResult = parseMspXml(content);

  const diagnostics: ImportDiagnostic[] = [];

  for (const err of parseResult.errors) {
    diagnostics.push({
      code: "PARSE_XML_STRUCTURE",
      severity: "error",
      message: err.message,
    });
  }
  for (const warn of parseResult.warnings) {
    diagnostics.push({
      code: "PARSE_INVALID_ROW",
      severity: "info",
      message: warn.message,
    });
  }

  const hasFatalErrors = parseResult.errors.length > 0;

  // ── Canonical mapping ─────────────────────────────────────────
  const { data } = parseResult;
  let projectName: string;
  let projectStartDate: string;
  let summary: ImportSummary;
  let mappedTasks: readonly Task[] | undefined;
  let mappedDependencies: readonly Dependency[] | undefined;
  let mappedResources: readonly Resource[] | undefined;
  let mappedAssignments: readonly Assignment[] | undefined;

  if (!hasFatalErrors) {
    const mapResult = mapMspToCanonical(data);
    diagnostics.push(...mapResult.diagnostics);

    projectName = mapResult.projectName;
    projectStartDate = mapResult.projectStartDate;
    mappedTasks = mapResult.tasks;
    mappedDependencies = mapResult.dependencies;
    mappedResources = mapResult.resources;
    mappedAssignments = mapResult.assignments;

    summary = {
      taskCount: mapResult.tasks.length,
      dependencyCount: mapResult.dependencies.length,
      resourceCount: mapResult.resources.length,
      assignmentCount: mapResult.assignments.length,
      calendarInfo: "Project-level calendar (simplified)",
    };
  } else {
    projectName = data.project.name?.trim() || "(unknown)";
    projectStartDate = "";
    summary = {
      taskCount: data.tasks.length,
      dependencyCount: 0,
      resourceCount: data.resources.length,
      assignmentCount: data.assignments.length,
      calendarInfo: "Project-level calendar (simplified)",
    };
  }

  // ── Diagnostic summary ────────────────────────────────────────
  const diagnosticsSummary: ImportDiagnosticsSummary = {
    errors: diagnostics.filter(d => d.severity === "error").length,
    warnings: diagnostics.filter(d => d.severity === "warning").length,
    infos: diagnostics.filter(d => d.severity === "info").length,
  };

  const canCommit = diagnosticsSummary.errors === 0;

  // ── Store candidate ───────────────────────────────────────────
  const candidate: ImportCandidate = {
    format,
    projectName,
    projectStartDate,
    summary,
    diagnostics,
    diagnosticsSummary,
    canCommit,
    rawData: data,
    mappedTasks,
    mappedDependencies,
    mappedResources,
    mappedAssignments,
  };
  setPendingCandidate(candidate);

  // ── Build IMPORT_PREVIEW message ──────────────────────────────
  const message: ImportPreviewMessage = {
    type: "IMPORT_PREVIEW",
    v: 1,
    reqId,
    payload: {
      projectName,
      projectStartDate,
      format,
      summary,
      diagnostics,
      diagnosticsSummary,
      canCommit,
    },
  };

  return { ok: true, message };
}
