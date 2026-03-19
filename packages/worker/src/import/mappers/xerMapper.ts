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
 * - Duration: target_drtn_hr_cnt / hoursPerDay → integer days
 * - Constraint types: lookup table with lossy approximation diagnostics
 * - Dependency types: PR_FS/SS/FF/SF → canonical; unknown → FS + warning
 * - Lag: lag_hr_cnt / hoursPerDay → integer days
 * - Resources: max_qty_per_hr * hoursPerDay → maxUnitsPerDay
 * - Assignments: target_qty_per_hr * hoursPerDay → unitsPerDay
 * - Calendar: simplified to project-level default (info diagnostic)
 */

import type {
    Assignment,
    ConstraintType,
    Dependency,
    DependencyType,
    ImportDiagnostic,
    Resource,
    Task,
} from "protocol";
import type { XerData, XerWbs } from "../types/xerTypes.js";

// ─── Result Type ────────────────────────────────────────────────────

export type XerMapperResult = {
  readonly tasks: readonly Task[];
  readonly dependencies: readonly Dependency[];
  readonly resources: readonly Resource[];
  readonly assignments: readonly Assignment[];
  readonly diagnostics: readonly ImportDiagnostic[];
  readonly projectName: string;
  readonly projectStartDate: string;
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

  // ── Build WBS hierarchy ───────────────────────────────────────
  const wbsMap = new Map<string, XerWbs>();
  for (const w of data.wbs) {
    wbsMap.set(w.wbs_id, w);
  }

  const wbsDepthCache = new Map<string, number>();
  const wbsIdToCanonical = new Map<string, string>();
  const tasks: Task[] = [];

  // Sort WBS by depth so parents are created before children
  const wbsSorted = [...data.wbs].sort(
    (a, b) =>
      computeWbsDepth(a.wbs_id, wbsMap, wbsDepthCache) -
      computeWbsDepth(b.wbs_id, wbsMap, wbsDepthCache),
  );

  for (const wbs of wbsSorted) {
    const canonicalId = generateId();
    wbsIdToCanonical.set(wbs.wbs_id, canonicalId);
    const depth = computeWbsDepth(wbs.wbs_id, wbsMap, wbsDepthCache);

    let parentId: string | undefined;
    if (wbs.parent_wbs_id && wbs.parent_wbs_id !== wbs.wbs_id) {
      parentId = wbsIdToCanonical.get(wbs.parent_wbs_id);
    }

    tasks.push({
      id: canonicalId,
      name: (wbs.wbs_name || wbs.wbs_short_name || "WBS").trim(),
      duration: 0,
      depth,
      isSummary: true,
      parentId,
    });
  }

  // ── Map activities (non-WBS tasks) ────────────────────────────
  const xerTaskIdToCanonical = new Map<string, string>();

  for (const xt of data.tasks) {
    // Skip WBS summary tasks — represented by PROJWBS-derived summaries
    if (xt.task_type === "TT_WBS") continue;

    const canonicalId = generateId();
    xerTaskIdToCanonical.set(xt.task_id, canonicalId);

    // Name
    const name = xt.task_name?.trim() || "(unnamed)";

    // Duration: hours → days, minimum 1
    const rawDuration = parseFloat(xt.target_drtn_hr_cnt || "0") / hoursPerDay;
    const duration = Math.max(1, Math.round(rawDuration));
    if (rawDuration > 0 && Math.abs(rawDuration - Math.round(rawDuration)) > 0.01) {
      diagnostics.push({
        code: "DURATION_FRACTIONAL_ROUNDED",
        severity: "warning",
        message: `Duration rounded from ${rawDuration.toFixed(2)} to ${duration} days`,
        sourceEntityId: xt.task_id,
        canonicalEntityId: canonicalId,
        field: "target_drtn_hr_cnt",
        originalValue: xt.target_drtn_hr_cnt,
        mappedValue: String(duration),
      });
    }

    // Constraint type
    let constraintType: ConstraintType | undefined;
    let constraintDate: number | null | undefined;

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

      // Constraint date → day-offset from project start
      if (xt.cstr_date && !isNaN(projectStartMs)) {
        const cstrMs = Date.parse(xt.cstr_date);
        if (!isNaN(cstrMs)) {
          constraintDate = Math.round((cstrMs - projectStartMs) / MS_PER_DAY);
        }
      }
    }

    // Parent from WBS lookup
    const parentId = wbsIdToCanonical.get(xt.wbs_id);
    const depth = parentId !== undefined
      ? computeWbsDepth(xt.wbs_id, wbsMap, wbsDepthCache) + 1
      : 0;

    tasks.push({
      id: canonicalId,
      name,
      duration,
      depth,
      isSummary: false,
      parentId,
      constraintType,
      constraintDate,
    });
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

    // Lag: hours → days
    const rawLag = parseFloat(xp.lag_hr_cnt || "0") / hoursPerDay;
    const lag = Math.round(rawLag);
    if (Math.abs(rawLag - lag) > 0.01) {
      diagnostics.push({
        code: "LAG_FRACTIONAL_ROUNDED",
        severity: "warning",
        message: `Lag rounded from ${rawLag.toFixed(2)} to ${lag} days`,
        sourceEntityId: xp.task_pred_id,
        field: "lag_hr_cnt",
        originalValue: xp.lag_hr_cnt,
        mappedValue: String(lag),
      });
    }

    dependencies.push({
      id: generateId(),
      predId,
      succId,
      type,
      lag,
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

  // ── Unsupported feature diagnostics ───────────────────────────
  if (data.calendars.length > 0) {
    diagnostics.push({
      code: "CALENDAR_SIMPLIFIED",
      severity: "info",
      message: `${data.calendars.length} calendar(s) found — mapped to project-level default calendar`,
    });
  }

  return {
    tasks,
    dependencies,
    resources,
    assignments,
    diagnostics,
    projectName,
    projectStartDate,
  };
}
