/**
 * @module xerParser
 *
 * Primavera P6 XER Text Parser
 *
 * Parses raw XER file content (tab-delimited text) into typed row objects.
 * Stateless, pure function. Zero imports from protocol, state, or kernel.
 *
 * XER structure:
 *   ERMHDR  ...          ← file header (first line)
 *   %T  TABLE_NAME       ← start of table
 *   %F  col1  col2  ...  ← field names
 *   %R  val1  val2  ...  ← data row (repeats)
 *   %E                   ← end of table
 *   ... (next table)
 *   %E                   ← final end marker
 *
 * Limitations (W.2 scope):
 * - Handles standard P6 export tables: PROJECT, PROJWBS, TASK, TASKPRED, RSRC, TASKRSRC, CALENDAR
 * - Unrecognized tables are skipped (with a warning).
 * - Fields beyond those defined in XerTypes are silently ignored per row.
 */

import type {
    XerCalendar,
    XerParseError,
    XerParseResult,
    XerParseWarning,
    XerProject,
    XerResource,
    XerTask,
    XerTaskPred,
    XerTaskRsrc,
    XerWbs
} from "../types/xerTypes.js";

// ─── Table name constants ───────────────────────────────────────────

const KNOWN_TABLES = new Set([
  "PROJECT", "PROJWBS", "TASK", "TASKPRED", "RSRC", "TASKRSRC", "CALENDAR",
]);

// ─── Helpers ────────────────────────────────────────────────────────

/** Split a line by tab delimiter, trimming the leading marker. */
function splitFields(line: string): string[] {
  // Remove leading %F or %R marker and split remaining by tab
  const withoutMarker = line.replace(/^%[A-Z]\s*/, "");
  return withoutMarker.split("\t");
}

/** Build a record from field names and row values. Missing values default to "". */
function buildRow(fields: readonly string[], values: readonly string[]): Record<string, string> {
  const row: Record<string, string> = {};
  for (let i = 0; i < fields.length; i++) {
    row[fields[i]] = i < values.length ? values[i] : "";
  }
  return row;
}

/** Safely extract typed fields from a generic row record for a specific table type. */
function pickFields<T>(row: Record<string, string>, keys: readonly string[]): T {
  const result: Record<string, string> = {};
  for (const key of keys) {
    result[key] = row[key] ?? "";
  }
  return result as T;
}

// ─── Field key lists per table ──────────────────────────────────────

const PROJECT_KEYS: readonly string[] = ["proj_id", "proj_short_name", "plan_start_date", "day_hr_cnt"];
const PROJWBS_KEYS: readonly string[] = ["wbs_id", "proj_id", "parent_wbs_id", "wbs_short_name", "wbs_name"];
const TASK_KEYS: readonly string[] = ["task_id", "proj_id", "wbs_id", "task_name", "task_type", "target_drtn_hr_cnt", "cstr_type", "cstr_date"];
const TASKPRED_KEYS: readonly string[] = ["task_pred_id", "task_id", "pred_task_id", "pred_type", "lag_hr_cnt"];
const RSRC_KEYS: readonly string[] = ["rsrc_id", "rsrc_name", "max_qty_per_hr"];
const TASKRSRC_KEYS: readonly string[] = ["taskrsrc_id", "task_id", "rsrc_id", "target_qty_per_hr"];
const CALENDAR_KEYS: readonly string[] = ["clndr_id", "clndr_name", "clndr_data"];

// ─── Main Parser ────────────────────────────────────────────────────

/**
 * Parse a raw XER file string into structured table data.
 *
 * @param raw  The full XER file content as a string.
 * @returns    Parsed data, errors, and warnings.
 */
export function parseXer(raw: string): XerParseResult {
  const errors: XerParseError[] = [];
  const warnings: XerParseWarning[] = [];

  const projects: XerProject[] = [];
  const wbs: XerWbs[] = [];
  const tasks: XerTask[] = [];
  const taskPreds: XerTaskPred[] = [];
  const resources: XerResource[] = [];
  const taskRsrcs: XerTaskRsrc[] = [];
  const calendars: XerCalendar[] = [];

  const lines = raw.split(/\r?\n/);

  // Validate header
  if (lines.length === 0 || !lines[0].startsWith("ERMHDR")) {
    errors.push({ line: 1, message: "Missing ERMHDR header — not a valid XER file" });
    return {
      data: { projects, wbs, tasks, taskPreds, resources, taskRsrcs, calendars },
      errors,
      warnings,
    };
  }

  let currentTable: string | null = null;
  let currentFields: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1; // 1-based

    // Skip empty lines
    if (line.trim() === "") continue;

    // Table start
    if (line.startsWith("%T\t") || line.startsWith("%T ")) {
      currentTable = line.replace(/^%T\s+/, "").trim();
      currentFields = [];
      if (!KNOWN_TABLES.has(currentTable)) {
        warnings.push({ line: lineNum, message: `Unrecognized table "${currentTable}" — skipping` });
        currentTable = null;
      }
      continue;
    }

    // Field definition
    if (line.startsWith("%F\t") || line.startsWith("%F ")) {
      if (currentTable !== null) {
        currentFields = splitFields(line);
      }
      continue;
    }

    // End of table
    if (line.startsWith("%E")) {
      currentTable = null;
      currentFields = [];
      continue;
    }

    // Data row
    if (line.startsWith("%R\t") || line.startsWith("%R ")) {
      if (currentTable === null) {
        // Row outside a recognized table — already warned, skip.
        continue;
      }

      if (currentFields.length === 0) {
        errors.push({ line: lineNum, message: `Data row in table "${currentTable}" before field definition` });
        continue;
      }

      const values = splitFields(line);
      const row = buildRow(currentFields, values);

      switch (currentTable) {
        case "PROJECT":
          projects.push(pickFields<XerProject>(row, PROJECT_KEYS));
          break;
        case "PROJWBS":
          wbs.push(pickFields<XerWbs>(row, PROJWBS_KEYS));
          break;
        case "TASK":
          tasks.push(pickFields<XerTask>(row, TASK_KEYS));
          break;
        case "TASKPRED":
          taskPreds.push(pickFields<XerTaskPred>(row, TASKPRED_KEYS));
          break;
        case "RSRC":
          resources.push(pickFields<XerResource>(row, RSRC_KEYS));
          break;
        case "TASKRSRC":
          taskRsrcs.push(pickFields<XerTaskRsrc>(row, TASKRSRC_KEYS));
          break;
        case "CALENDAR":
          calendars.push(pickFields<XerCalendar>(row, CALENDAR_KEYS));
          break;
      }
      continue;
    }

    // Lines that don't match any marker are ignored (e.g. ERMHDR continuation)
  }

  return {
    data: { projects, wbs, tasks, taskPreds, resources, taskRsrcs, calendars },
    errors,
    warnings,
  };
}
