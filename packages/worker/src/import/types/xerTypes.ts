/**
 * @module xerTypes
 *
 * Raw XER Row Types — Parser Output
 *
 * These types represent the raw rows parsed from a Primavera P6 XER file.
 * They are format-specific and carry no canonical semantics.
 *
 * ⚠️ ISOLATED — zero imports from protocol, state, or kernel.
 * Parsers operate on raw strings and return these plain objects.
 * Canonical mapping from these types is done by the mapper (W.3).
 *
 * XER format reference:
 * - Tab-delimited text file with table headers marked by %T
 * - Field names marked by %F
 * - Row data marked by %R
 * - End marker %E
 */

// ─── Project Table ──────────────────────────────────────────────────

export type XerProject = {
  readonly proj_id: string;
  readonly proj_short_name: string;
  readonly plan_start_date: string;
  readonly day_hr_cnt: string;
};

// ─── WBS Table ──────────────────────────────────────────────────────

export type XerWbs = {
  readonly wbs_id: string;
  readonly proj_id: string;
  readonly parent_wbs_id: string;
  readonly wbs_short_name: string;
  readonly wbs_name: string;
};

// ─── Task / Activity Table ──────────────────────────────────────────

export type XerTask = {
  readonly task_id: string;
  readonly proj_id: string;
  readonly wbs_id: string;
  readonly task_name: string;
  readonly task_type: string;
  readonly target_drtn_hr_cnt: string;
  readonly cstr_type: string;
  readonly cstr_date: string;
};

// ─── Predecessor (Dependency) Table ─────────────────────────────────

export type XerTaskPred = {
  readonly task_pred_id: string;
  readonly task_id: string;
  readonly pred_task_id: string;
  readonly pred_type: string;
  readonly lag_hr_cnt: string;
};

// ─── Resource Table ─────────────────────────────────────────────────

export type XerResource = {
  readonly rsrc_id: string;
  readonly rsrc_name: string;
  readonly max_qty_per_hr: string;
};

// ─── Task Resource Assignment Table ─────────────────────────────────

export type XerTaskRsrc = {
  readonly taskrsrc_id: string;
  readonly task_id: string;
  readonly rsrc_id: string;
  readonly target_qty_per_hr: string;
};

// ─── Calendar Table (simplified) ────────────────────────────────────

export type XerCalendar = {
  readonly clndr_id: string;
  readonly clndr_name: string;
  readonly clndr_data: string;
};

// ─── Aggregate XER Data ─────────────────────────────────────────────

/**
 * All parsed tables from a single XER file.
 * Absent tables are represented as empty arrays.
 */
export type XerData = {
  readonly projects: readonly XerProject[];
  readonly wbs: readonly XerWbs[];
  readonly tasks: readonly XerTask[];
  readonly taskPreds: readonly XerTaskPred[];
  readonly resources: readonly XerResource[];
  readonly taskRsrcs: readonly XerTaskRsrc[];
  readonly calendars: readonly XerCalendar[];
};

// ─── Parse Result ───────────────────────────────────────────────────

export type XerParseError = {
  readonly line: number;
  readonly message: string;
};

export type XerParseWarning = {
  readonly line: number;
  readonly message: string;
};

/**
 * Result of parsing a raw XER string.
 * Contains structured data plus any parse-level errors/warnings.
 */
export type XerParseResult = {
  readonly data: XerData;
  readonly errors: readonly XerParseError[];
  readonly warnings: readonly XerParseWarning[];
};
