/**
 * @module xerMapper
 *
 * XER → Canonical Mapper — W.3
 *
 * Transforms parsed XerData into canonical Task[], Dependency[],
 * Resource[], Assignment[] with rich ImportDiagnostic entries.
 *
 * Pure function — no state mutation, no side effects.
 * Per spec §3.1, semantic translation decisions live here, not in the parser.
 *
 * Key mapping decisions (spec §3.2):
 * - All canonical IDs are fresh UUIDs (external IDs in diagnostics only)
 * - PROJWBS → summary tasks; TT_WBS activities skipped (avoid duplicates)
 * - Duration: target_drtn_hr_cnt / hoursPerDay → WorkMinutes (×MINUTES_PER_DAY)
 * - Constraint types: lookup table with lossy approximation diagnostics
 * - Dependency types: PR_FS/SS/FF/SF → canonical; unknown → FS + warning
 * - Lag: lag_hr_cnt / hoursPerDay → WorkMinutes (×MINUTES_PER_DAY)
 * - Resources: max_qty_per_hr * hoursPerDay → maxUnitsPerDay
 * - Assignments: target_qty_per_hr * hoursPerDay → unitsPerDay
 * - Calendar: simplified to project-level default (info diagnostic)
 */

import type {
    Assignment,
    BaseCalendarDefinition,
    CalendarFidelitySummary,
    CalendarId,
    ConstraintType,
    Dependency,
    DependencyType,
    ImportDiagnostic,
    Resource,
    SourceImportFidelityState,
    SourceProjectSettings,
    SourceTaskActuals,
    SourceTaskDates,
    SourceTaskProgress,
    Task,
    WorkMinutes,
} from "@planner/protocol";
import { MINUTES_PER_DAY } from "@planner/protocol";
import { generateMigrationKey } from "../../ordering.js";
import type { XerData, XerWbs } from "../types/xerTypes.js";
import { resolveCalendarInheritance } from "./calendarInheritance.js";
import { buildCalendarFidelitySummary, mapXerCalendars } from "./calendarMapper.js";

// ─── Result Type ────────────────────────────────────────────────────

export type XerMapperResult = {
  readonly tasks: readonly Task[];
  readonly dependencies: readonly Dependency[];
  readonly resources: readonly Resource[];
  readonly assignments: readonly Assignment[];
  readonly diagnostics: readonly ImportDiagnostic[];
  readonly projectName: string;
  readonly projectStartDate: string;
  readonly sourceImportFidelityState: SourceImportFidelityState;
  /** Calendar definitions extracted from XER calendars (sidecar, not used by engine). */
  readonly calendarDefinitions: Readonly<Record<CalendarId, BaseCalendarDefinition>>;
  /** W3C: Resolved (flattened) calendar definitions after inheritance resolution. */
  readonly resolvedCalendarDefinitions: Readonly<Record<CalendarId, BaseCalendarDefinition>>;
  /** Calendar fidelity counts for ImportSummary. */
  readonly calendarFidelity: CalendarFidelitySummary;
  /** W4.3: Project-level default settings preserved from XER (informational). */
  readonly sourceProjectSettings: SourceProjectSettings;
};

// ─── Constraint Mapping Table (spec §3.2.1) ─────────────────────────

type ConstraintMapping = { canonical: ConstraintType; lossless: boolean };

const CONSTRAINT_MAP: Record<string, ConstraintMapping> = {
  CS_ASAP:  { canonical: "ASAP", lossless: true },
  CS_ALAP:  { canonical: "ALAP", lossless: true },
  CS_SNET:  { canonical: "SNET", lossless: true },
  CS_SNEDT: { canonical: "SNET", lossless: true },
  CS_FNLT:  { canonical: "FNLT", lossless: true },
  CS_FNLDT: { canonical: "FNLT", lossless: true },
  CS_MSO:   { canonical: "MSO",  lossless: true },
  CS_MSODT: { canonical: "MSO",  lossless: true },
  CS_MFO:   { canonical: "MFO",  lossless: true },
  CS_MFODT: { canonical: "MFO",  lossless: true },
  CS_FNET:  { canonical: "SNET", lossless: false },
  CS_SNLT:  { canonical: "FNLT", lossless: false },
};

// ─── Dependency Type Mapping ────────────────────────────────────────

const DEP_TYPE_MAP: Record<string, DependencyType> = {
  PR_FS: "FS",
  PR_SS: "SS",
  PR_FF: "FF",
  PR_SF: "SF",
};

// ─── Helpers ────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

function generateId(): string {
  return crypto.randomUUID();
}

function parseOffsetMinutes(sourceDate: string | undefined, projectStartMs: number): number | undefined {
  if (!sourceDate || Number.isNaN(projectStartMs)) return undefined;
  const ms = Date.parse(sourceDate);
  if (Number.isNaN(ms)) return undefined;
  return Math.round((ms - projectStartMs) / 60_000);
}

function parseHoursToWorkMinutes(rawHours: string | undefined, hoursPerDay: number): WorkMinutes | undefined {
  if (!rawHours) return undefined;
  const hours = parseFloat(rawHours);
  if (Number.isNaN(hours) || hours < 0 || hoursPerDay <= 0) return undefined;
  const minutes = Math.round((hours / hoursPerDay) * MINUTES_PER_DAY);
  return minutes as WorkMinutes;
}

function parsePercent(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = parseFloat(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** Compute the depth of a WBS node in the hierarchy (0-based). */
function computeWbsDepth(
  wbsId: string,
  wbsMap: ReadonlyMap<string, XerWbs>,
  cache: Map<string, number>,
): number {
  const cached = cache.get(wbsId);
  if (cached !== undefined) return cached;

  const wbs = wbsMap.get(wbsId);
  if (
    !wbs ||
    !wbs.parent_wbs_id ||
    wbs.parent_wbs_id === wbsId ||
    !wbsMap.has(wbs.parent_wbs_id)
  ) {
    cache.set(wbsId, 0);
    return 0;
  }

  const depth = computeWbsDepth(wbs.parent_wbs_id, wbsMap, cache) + 1;
  cache.set(wbsId, depth);
  return depth;
}

// ─── Main Mapper ────────────────────────────────────────────────────

export function mapXerToCanonical(data: XerData): XerMapperResult {
  const diagnostics: ImportDiagnostic[] = [];

  // ── Project metadata ──────────────────────────────────────────
  if (data.projects.length > 1) {
    diagnostics.push({
      code: "MULTI_PROJECT_XER",
      severity: "warning",
      message: `XER contains ${data.projects.length} projects — using first project, others skipped`,
    });
  }

  const project = data.projects[0];
  const hoursPerDay = parseFloat(project?.day_hr_cnt || "8") || 8;
  const projectName = project?.proj_short_name?.trim() || "(unknown)";
  const projectStartDate = project?.plan_start_date || "";
  const projectStartMs = Date.parse(projectStartDate);
  const projectStatus = {
    dataDate: project?.data_date || undefined,
    statusDate: project?.status_date || undefined,
    sourceRawDate: project?.last_recalc_date || project?.data_date || project?.status_date || undefined,
    sourceSystem: "XER" as const,
  };

  // ── Build WBS hierarchy ───────────────────────────────────────
  const wbsMap = new Map<string, XerWbs>();
  for (const w of data.wbs) {
    wbsMap.set(w.wbs_id, w);
  }

  const wbsDepthCache = new Map<string, number>();
  const wbsIdToCanonical = new Map<string, string>();
  const tasks: Task[] = [];
  let taskIndex = 0;

  // ── Calendar extraction ───────────────────────────────────────
  const clndrIdToCanonical = new Map<string, CalendarId>();
  const { calendarDefinitions, diagnostics: calDiagnostics, calendarsWithInheritance, calendarsSimplifiedForEngine } =
    mapXerCalendars(data.calendars, clndrIdToCanonical);
  diagnostics.push(...calDiagnostics);

  // Sort WBS by depth so parents are created before children
  const wbsSorted = [...data.wbs].sort(
    (a, b) =>
      computeWbsDepth(a.wbs_id, wbsMap, wbsDepthCache) -
      computeWbsDepth(b.wbs_id, wbsMap, wbsDepthCache),
  );

  for (const wbs of wbsSorted) {
    const canonicalId = generateId();
    wbsIdToCanonical.set(wbs.wbs_id, canonicalId);

    let parentId: string | undefined;
    if (wbs.parent_wbs_id && wbs.parent_wbs_id !== wbs.wbs_id) {
      parentId = wbsIdToCanonical.get(wbs.parent_wbs_id);
    }

    tasks.push({
      id: canonicalId,
      isStructuralSummary: true,
      name: (wbs.wbs_name || wbs.wbs_short_name || "WBS").trim(),
      durationWorkMinutes: 0 as WorkMinutes,
      parentId,
      siblingOrder: generateMigrationKey(taskIndex++),
    });
  }

  // ── Map activities (non-WBS tasks) ────────────────────────────
  const xerTaskIdToCanonical = new Map<string, string>();
  const actualsByTaskId: Record<string, SourceTaskActuals> = {};
  const progressByTaskId: Record<string, SourceTaskProgress> = {};
  const sourceDatesByTaskId: Record<string, SourceTaskDates> = {};

  for (const xt of data.tasks) {
    // Skip WBS summary tasks — represented by PROJWBS-derived summaries
    if (xt.task_type === "TT_WBS") continue;

    const canonicalId = generateId();
    xerTaskIdToCanonical.set(xt.task_id, canonicalId);

    // Name
    const name = xt.task_name?.trim() || "(unnamed)";

    // Duration: hours → working days → WorkMinutes
    const rawDuration = parseFloat(xt.target_drtn_hr_cnt || "0") / hoursPerDay;
    const durationDays = Math.max(1, Math.round(rawDuration));
    const durationWorkMinutes = (durationDays * MINUTES_PER_DAY) as WorkMinutes;
    if (rawDuration > 0 && Math.abs(rawDuration - Math.round(rawDuration)) > 0.01) {
      diagnostics.push({
        code: "DURATION_FRACTIONAL_ROUNDED",
        severity: "warning",
        message: `Duration rounded from ${rawDuration.toFixed(2)} to ${durationDays} days`,
        sourceEntityId: xt.task_id,
        canonicalEntityId: canonicalId,
        field: "target_drtn_hr_cnt",
        originalValue: xt.target_drtn_hr_cnt,
        mappedValue: String(durationDays),
      });
    }

    // Constraint type
    let constraintType: ConstraintType | undefined;
    let constraintDateMinutes: WorkMinutes | null | undefined;

    if (xt.cstr_type && xt.cstr_type !== "" && xt.cstr_type !== "CS_ASAP") {
      const mapping = CONSTRAINT_MAP[xt.cstr_type];
      if (mapping) {
        constraintType = mapping.canonical;
        if (!mapping.lossless) {
          diagnostics.push({
            code: "CONSTRAINT_APPROXIMATED",
            severity: "warning",
            message: `Constraint "${xt.cstr_type}" approximated as "${mapping.canonical}"`,
            sourceEntityId: xt.task_id,
            canonicalEntityId: canonicalId,
            field: "cstr_type",
            originalValue: xt.cstr_type,
            mappedValue: mapping.canonical,
          });
        }
      } else {
        constraintType = "ASAP";
        diagnostics.push({
          code: "CONSTRAINT_APPROXIMATED",
          severity: "warning",
          message: `Unknown constraint type "${xt.cstr_type}" mapped to ASAP`,
          sourceEntityId: xt.task_id,
          canonicalEntityId: canonicalId,
          field: "cstr_type",
          originalValue: xt.cstr_type,
          mappedValue: "ASAP",
        });
      }

      // Constraint date → day-offset from project start → WorkMinutes
      if (xt.cstr_date && !isNaN(projectStartMs)) {
        const cstrMs = Date.parse(xt.cstr_date);
        if (!isNaN(cstrMs)) {
          const dayOffset = Math.round((cstrMs - projectStartMs) / MS_PER_DAY);
          constraintDateMinutes = (dayOffset * MINUTES_PER_DAY) as WorkMinutes;
        }
      }
    }

    // Parent from WBS lookup
    const parentId = wbsIdToCanonical.get(xt.wbs_id);

    tasks.push({
      id: canonicalId,
      sourceActivityId: xt.task_code?.trim() || undefined,
      name,
      durationWorkMinutes,
      parentId,
      constraintType,
      constraintDateMinutes,
      siblingOrder: generateMigrationKey(taskIndex++),
      assignedCalendarId: xt.clndr_id ? clndrIdToCanonical.get(xt.clndr_id) : undefined,
    });

    const actuals: SourceTaskActuals = {
      actualStartMinutes: parseOffsetMinutes(xt.act_start_date, projectStartMs),
      actualFinishMinutes: parseOffsetMinutes(xt.act_end_date, projectStartMs),
      actualDurationWorkMinutes: parseHoursToWorkMinutes(xt.act_drtn_hr_cnt, hoursPerDay),
      remainingDurationWorkMinutes: parseHoursToWorkMinutes(xt.remain_drtn_hr_cnt, hoursPerDay),
      remainingStartMinutes: parseOffsetMinutes(xt.remain_start_date, projectStartMs),
      remainingFinishMinutes: parseOffsetMinutes(xt.remain_end_date, projectStartMs),
      suspendDateMinutes: parseOffsetMinutes(xt.suspend_date, projectStartMs),
      resumeDateMinutes: parseOffsetMinutes(xt.resume_date, projectStartMs),
      raw: {
        act_start_date: xt.act_start_date,
        act_end_date: xt.act_end_date,
        act_drtn_hr_cnt: xt.act_drtn_hr_cnt,
        remain_drtn_hr_cnt: xt.remain_drtn_hr_cnt,
      },
    };
    const hasAnyActual = Object.entries(actuals).some(([key, value]) => key !== "raw" && value !== undefined);
    if (hasAnyActual) {
      actualsByTaskId[canonicalId] = actuals;
    }

    const progress: SourceTaskProgress = {
      physicalPercentComplete: parsePercent(xt.phys_complete_pct),
      durationPercentComplete: parsePercent(xt.duration_pct_complete),
      unitsPercentComplete: parsePercent(xt.units_pct_complete),
      percentComplete: parsePercent(xt.task_complete_pct),
      percentCompleteType: xt.complete_pct_type || undefined,
      raw: {
        phys_complete_pct: xt.phys_complete_pct,
        task_complete_pct: xt.task_complete_pct,
        duration_pct_complete: xt.duration_pct_complete,
        units_pct_complete: xt.units_pct_complete,
        complete_pct_type: xt.complete_pct_type,
      },
    };
    const hasAnyProgress = Object.entries(progress).some(([key, value]) => key !== "raw" && value !== undefined);
    if (hasAnyProgress) {
      progressByTaskId[canonicalId] = progress;
    }

    const sourceDates: SourceTaskDates = {
      sourceStartMinutes: parseOffsetMinutes(xt.target_start_date, projectStartMs),
      sourceFinishMinutes: parseOffsetMinutes(xt.target_end_date, projectStartMs),
      sourceRawStart: xt.target_start_date || undefined,
      sourceRawFinish: xt.target_end_date || undefined,
    };
    if (
      sourceDates.sourceStartMinutes !== undefined
      || sourceDates.sourceFinishMinutes !== undefined
      || sourceDates.sourceRawStart !== undefined
      || sourceDates.sourceRawFinish !== undefined
    ) {
      sourceDatesByTaskId[canonicalId] = sourceDates;
    }
  }

  // ── Map dependencies ──────────────────────────────────────────
  const dependencies: Dependency[] = [];

  for (const xp of data.taskPreds) {
    const predId = xerTaskIdToCanonical.get(xp.pred_task_id);
    const succId = xerTaskIdToCanonical.get(xp.task_id);

    if (!predId || !succId) {
      diagnostics.push({
        code: "PARSE_INVALID_ROW",
        severity: "warning",
        message: `Dependency references unknown task — pred:${xp.pred_task_id} succ:${xp.task_id}`,
        sourceEntityId: xp.task_pred_id,
        field: !predId ? "pred_task_id" : "task_id",
      });
      continue;
    }

    // Type mapping
    let type: DependencyType;
    const mapped = DEP_TYPE_MAP[xp.pred_type];
    if (mapped) {
      type = mapped;
    } else {
      type = "FS";
      diagnostics.push({
        code: "DEPENDENCY_TYPE_UNKNOWN",
        severity: "warning",
        message: `Unknown dependency type "${xp.pred_type}" mapped to FS`,
        sourceEntityId: xp.task_pred_id,
        field: "pred_type",
        originalValue: xp.pred_type,
        mappedValue: "FS",
      });
    }

    // Lag: hours → days → WorkMinutes
    const rawLag = parseFloat(xp.lag_hr_cnt || "0") / hoursPerDay;
    const lagDays = Math.round(rawLag);
    if (Math.abs(rawLag - lagDays) > 0.01) {
      diagnostics.push({
        code: "LAG_FRACTIONAL_ROUNDED",
        severity: "warning",
        message: `Lag rounded from ${rawLag.toFixed(2)} to ${lagDays} days`,
        sourceEntityId: xp.task_pred_id,
        field: "lag_hr_cnt",
        originalValue: xp.lag_hr_cnt,
        mappedValue: String(lagDays),
      });
    }
    const lagWorkMinutes = (lagDays * MINUTES_PER_DAY) as WorkMinutes;

    dependencies.push({
      id: generateId(),
      predId,
      succId,
      type,
      lagWorkMinutes,
    });
  }

  // ── Map resources ─────────────────────────────────────────────
  const resources: Resource[] = [];
  const xerRsrcIdToCanonical = new Map<string, string>();

  for (const xr of data.resources) {
    const canonicalId = generateId();
    xerRsrcIdToCanonical.set(xr.rsrc_id, canonicalId);

    const rawMaxUnits = parseFloat(xr.max_qty_per_hr || "0") * hoursPerDay;
    const maxUnitsPerDay = rawMaxUnits > 0 ? rawMaxUnits : 1;

    resources.push({
      id: canonicalId,
      name: xr.rsrc_name?.trim() || "(unnamed resource)",
      maxUnitsPerDay,
    });
  }

  // ── Map assignments ───────────────────────────────────────────
  const assignments: Assignment[] = [];

  for (const xa of data.taskRsrcs) {
    const taskId = xerTaskIdToCanonical.get(xa.task_id);
    const resourceId = xerRsrcIdToCanonical.get(xa.rsrc_id);

    if (!taskId || !resourceId) {
      diagnostics.push({
        code: "PARSE_INVALID_ROW",
        severity: "warning",
        message: `Assignment references unknown entity — task:${xa.task_id} resource:${xa.rsrc_id}`,
        sourceEntityId: xa.taskrsrc_id,
      });
      continue;
    }

    const rawUnits = parseFloat(xa.target_qty_per_hr || "0") * hoursPerDay;
    const unitsPerDay = rawUnits > 0 ? rawUnits : 1;

    assignments.push({
      id: generateId(),
      taskId,
      resourceId,
      unitsPerDay,
    });
  }

  // ── Calendar diagnostics and fidelity ─────────────────────────
  const taskCalendarAssignments = tasks.filter(t => t.assignedCalendarId !== undefined).length;
  if (taskCalendarAssignments > 0) {
    diagnostics.push({
      code: "TASK_CALENDAR_IGNORED_BY_ENGINE",
      severity: "info",
      message: `${taskCalendarAssignments} task(s) have assigned calendars — preserved in sidecar data, engine uses project default`,
    });
  }

  // W3C: Resolve calendar inheritance
  const { resolvedDefinitions, diagnostics: inheritanceDiags, unresolvedCount } =
    resolveCalendarInheritance(calendarDefinitions);
  diagnostics.push(...inheritanceDiags);

  const calendarFidelity = buildCalendarFidelitySummary({
    totalCalendars: data.calendars.length,
    taskCalendarAssignments,
    resourceCalendarAssignments: 0, // XER resource calendars not exposed in XerResource yet
    exceptionCount: 0, // XER exception parsing deferred
    calendarsWithInheritance,
    calendarsSimplifiedForEngine,
    unresolvedInheritanceCount: unresolvedCount,
  });

  // ── W4.3: Build source project settings (informational) ───────
  const rawSchedOptions = (data.schedoptions?.length ?? 0) > 0
    ? Object.fromEntries(data.schedoptions!.map(o => [o.option_name, o.option_value]))
    : undefined;

  // Resolve default calendar name from the project's clndr_id
  const defaultCalendarId = project?.clndr_id || undefined;
  const defaultCalendarEntry = defaultCalendarId
    ? data.calendars.find(c => c.clndr_id === defaultCalendarId)
    : undefined;
  const defaultCalendarName = defaultCalendarEntry?.clndr_name || undefined;

  const hoursPerWeek = project?.week_hr_cnt ? parseFloat(project.week_hr_cnt) : undefined;
  const hoursPerMonth = project?.month_hr_cnt ? parseFloat(project.month_hr_cnt) : undefined;

  // Extract SCHEDOPTIONS settings when available
  const schedOpt = rawSchedOptions ?? {};
  const criticalFloatThresholdRaw = schedOpt["sched_float_thr_cnt"];
  const criticalFloatThreshold = criticalFloatThresholdRaw != null && criticalFloatThresholdRaw !== ""
    ? parseFloat(String(criticalFloatThresholdRaw))
    : undefined;
  const outOfSequenceProgressMode = schedOpt["sched_progress_override"] != null
    ? (String(schedOpt["sched_progress_override"]) === "Y" ? "progress override" : "retained logic")
    : undefined;
  const useExpectedFinishDates = schedOpt["sched_use_expect_end_flag"] != null
    ? String(schedOpt["sched_use_expect_end_flag"]) === "Y"
    : undefined;

  const sourceProjectSettings: SourceProjectSettings = {
    sourceProjectId: project?.proj_id || undefined,
    defaultCalendarId,
    defaultCalendarName,
    planStartDate: projectStartDate || undefined,
    dataDate: projectStatus.dataDate,
    statusDate: projectStatus.statusDate,
    mustFinishBy: project?.scd_end_date || undefined,
    hoursPerDay,
    hoursPerWeek: Number.isFinite(hoursPerWeek) ? hoursPerWeek : undefined,
    hoursPerMonth: Number.isFinite(hoursPerMonth) ? hoursPerMonth : undefined,
    criticalFloatThreshold: Number.isFinite(criticalFloatThreshold) ? criticalFloatThreshold : undefined,
    outOfSequenceProgressMode,
    useExpectedFinishDates,
    rawScheduleOptions: rawSchedOptions,
  };

  // ── W4.3: Emit preservation diagnostics ───────────────────────
  if (defaultCalendarId) {
    diagnostics.push({
      code: "PROJECT_DEFAULT_CALENDAR_PRESERVED_INACTIVE",
      severity: "info",
      message: `Project default calendar "${defaultCalendarName ?? defaultCalendarId}" preserved — not yet active in scheduling engine`,
      field: "clndr_id",
      originalValue: defaultCalendarId,
    });
  }
  if (hoursPerWeek !== undefined && Number.isFinite(hoursPerWeek)) {
    diagnostics.push({
      code: "PROJECT_HOURS_PER_PERIOD_PRESERVED_INACTIVE",
      severity: "info",
      message: `Project hours/week (${hoursPerWeek}h) and hours/day (${hoursPerDay}h) preserved — engine uses fixed ${hoursPerDay}h/day`,
      field: "week_hr_cnt",
      originalValue: project?.week_hr_cnt,
    });
  }
  if ((data.schedoptions?.length ?? 0) > 0) {
    const noteableOptions: string[] = [];
    if (outOfSequenceProgressMode) noteableOptions.push(`out-of-sequence: ${outOfSequenceProgressMode}`);
    if (criticalFloatThreshold !== undefined) noteableOptions.push(`critical float threshold: ${criticalFloatThreshold}d`);
    diagnostics.push({
      code: "SCHEDOPTIONS_PRESERVED_INACTIVE",
      severity: "info",
      message: `SCHEDOPTIONS table preserved (${data.schedoptions?.length ?? 0} option(s))${noteableOptions.length > 0 ? ` — ${noteableOptions.join(", ")}` : ""} — not yet active in scheduling engine`,
    });
    if (criticalFloatThreshold !== undefined) {
      diagnostics.push({
        code: "CRITICAL_PATH_SETTING_PRESERVED_INACTIVE",
        severity: "info",
        message: `Critical path total float threshold (${criticalFloatThreshold}d) preserved — engine uses its own critical path logic`,
        field: "sched_float_thr_cnt",
        originalValue: String(criticalFloatThresholdRaw),
      });
    }
    if (outOfSequenceProgressMode) {
      diagnostics.push({
        code: "OUT_OF_SEQUENCE_PROGRESS_SETTING_PRESERVED_INACTIVE",
        severity: "info",
        message: `Out-of-sequence progress mode "${outOfSequenceProgressMode}" preserved — not yet active in scheduling engine`,
        field: "sched_progress_override",
      });
    }
  }

  return {
    tasks,
    dependencies,
    resources,
    assignments,
    diagnostics,
    projectName,
    projectStartDate,
    calendarDefinitions,
    resolvedCalendarDefinitions: resolvedDefinitions,
    calendarFidelity,
    sourceProjectSettings,
    sourceImportFidelityState: {
      projectStatus: (projectStatus.dataDate || projectStatus.statusDate || projectStatus.sourceRawDate)
        ? projectStatus
        : undefined,
      actualsByTaskId,
      progressByTaskId,
      sourceDatesByTaskId,
    },
  };
}
