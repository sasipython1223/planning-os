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
  readonly data_date?: string;
  readonly status_date?: string;
  readonly last_recalc_date?: string;
  /** W4.3: Hours per working week from P6 PROJECT table. */
  readonly week_hr_cnt?: string;
  /** W4.3: Hours per working month from P6 PROJECT table. */
  readonly month_hr_cnt?: string;
  /** W4.3: Project must-finish-by date. */
  readonly scd_end_date?: string;
  /** W4.3: Default calendar ID assigned to this project in P6. */
  readonly clndr_id?: string;
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
  readonly task_code?: string;
  readonly proj_id: string;
  readonly wbs_id: string;
  readonly task_name: string;
  readonly task_type: string;
  readonly target_drtn_hr_cnt: string;
  readonly cstr_type: string;
  readonly cstr_date: string;
  /** Calendar ID assigned to this task (references XerCalendar.clndr_id). */
  readonly clndr_id?: string;
  readonly target_start_date?: string;
  readonly target_end_date?: string;
  readonly act_start_date?: string;
  readonly act_end_date?: string;
  readonly act_drtn_hr_cnt?: string;
  readonly remain_drtn_hr_cnt?: string;
  readonly remain_start_date?: string;
  readonly remain_end_date?: string;
  readonly suspend_date?: string;
  readonly resume_date?: string;
  readonly phys_complete_pct?: string;
  readonly task_complete_pct?: string;
  readonly duration_pct_complete?: string;
  readonly units_pct_complete?: string;
  readonly complete_pct_type?: string;
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

// ─── Calendar Table ────────────────────────────────────────────────

export type XerCalendar = {
  readonly clndr_id: string;
  readonly clndr_name: string;
  /** Raw calendar definition string (P6 clndr_data format). Preserved as-is. */
  readonly clndr_data: string;
  /** Calendar type: 0=global, 1=resource, 2=project. */
  readonly clndr_type?: string;
  /** Base/parent calendar ID for inheritance. */
  readonly base_clndr_id?: string;
  /** Reported hours per day from P6. */
  readonly day_hr_cnt?: string;
  /** Reported hours per week from P6 CALENDAR table (if exported). */
  readonly week_hr_cnt?: string;
  /** Reported hours per month from P6 CALENDAR table (if exported). */
  readonly month_hr_cnt?: string;
  /** Reported hours per year from P6 CALENDAR table (if exported). */
  readonly year_hr_cnt?: string;
};

// ─── SCHEDOPTIONS Table ────────────────────────────────────────────

/**
 * W4.3: A single row from the P6 SCHEDOPTIONS table.
 * Each row is a key-value pair of scheduling option settings.
 */
export type XerSchedOption = {
  readonly option_name: string;
  readonly option_value: string;
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
  /** W4.3: Scheduling options preserved from SCHEDOPTIONS table. Empty array if table absent. */
  readonly schedoptions?: readonly XerSchedOption[];
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
