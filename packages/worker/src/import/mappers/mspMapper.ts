/**
 * @module mspMapper
 *
 * MSP XML → Canonical Mapper — W.6
 *
 * Transforms parsed MspData into canonical Task[], Dependency[],
 * Resource[], Assignment[] with rich ImportDiagnostic entries.
 *
 * Pure function — no state mutation, no side effects.
 * Per spec §3.1, semantic translation decisions live here, not in the parser.
 *
 * Key mapping decisions (spec §3.2):
 * - All canonical IDs are fresh UUIDs (MSP UIDs in diagnostics only)
 * - OutlineLevel determines depth; Summary flag determines isSummary
 * - Duration: ISO 8601 duration string → integer working days
 * - Constraint types: numeric mapping table per spec §3.2.1
 * - Dependency types: 0→FF, 1→FS, 2→SF, 3→SS per MSP convention
 * - Lag: tenths of minutes → integer working days
 * - Resources: MaxUnits (percent) → decimal maxUnitsPerDay
 * - Assignments: Units (percent) → decimal unitsPerDay
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
import type { MspData } from "../types/mspTypes.js";

// ─── Result Type ────────────────────────────────────────────────────

export type MspMapperResult = {
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

const MSP_CONSTRAINT_MAP: Record<string, ConstraintMapping> = {
  "0": { canonical: "ASAP", lossless: true },
  "1": { canonical: "ALAP", lossless: true },
  "2": { canonical: "MSO",  lossless: true },
  "3": { canonical: "MFO",  lossless: true },
  "4": { canonical: "SNET", lossless: true },
  "5": { canonical: "FNLT", lossless: false },  // SNLT → FNLT approximation
  "6": { canonical: "SNET", lossless: false },  // FNET → SNET approximation
  "7": { canonical: "FNLT", lossless: true },
};

// ─── Dependency Type Mapping ────────────────────────────────────────

const MSP_DEP_TYPE_MAP: Record<string, DependencyType> = {
  "0": "FF",
  "1": "FS",
  "2": "SF",
  "3": "SS",
};

// ─── Helpers ────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Parse an ISO 8601 duration string (e.g. "PT40H0M0S") into hours.
 * Returns NaN if unparseable.
 */
function parseIso8601DurationHours(iso: string): number {
  if (!iso) return NaN;
  // MSP commonly uses formats like PT40H0M0S, PT8H0M0S, P5D, etc.
  const match = iso.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match) return NaN;
  const days = parseInt(match[1] || "0", 10);
  const hours = parseInt(match[2] || "0", 10);
  const minutes = parseInt(match[3] || "0", 10);
  // Convert everything to hours
  return days * 24 + hours + minutes / 60;
}

/**
 * Parse MSP StartDate or ConstraintDate.
 * MSP uses ISO 8601 datetime: "2026-01-15T08:00:00"
 * Returns the date portion as "YYYY-MM-DD", or "" if unparseable.
 */
function parseMspDate(dateStr: string): string {
  if (!dateStr) return "";
  // Take just the date portion before T
  const datePart = dateStr.split("T")[0];
  if (!datePart || isNaN(Date.parse(datePart))) return "";
  return datePart;
}

// ─── Main Mapper ────────────────────────────────────────────────────

export function mapMspToCanonical(data: MspData): MspMapperResult {
  const diagnostics: ImportDiagnostic[] = [];

  // ── Project metadata ──────────────────────────────────────────
  const minutesPerDay = parseFloat(data.project.minutesPerDay) || 480; // default 8h
  const hoursPerDay = minutesPerDay / 60;
  const projectName = data.project.name?.trim() || "(unknown)";
  const rawStartDate = parseMspDate(data.project.startDate);
  const projectStartDate = rawStartDate || "";
  const projectStartMs = Date.parse(projectStartDate);

  // ── Build UID → canonical ID lookup ───────────────────────────
  const taskUidToCanonical = new Map<string, string>();
  const resourceUidToCanonical = new Map<string, string>();

  // ── Map tasks ─────────────────────────────────────────────────
  const tasks: Task[] = [];

  // First pass: assign canonical IDs for all tasks
  for (const mt of data.tasks) {
    taskUidToCanonical.set(mt.uid, generateId());
  }

  // Track parent IDs by outline level for hierarchy reconstruction
  const parentStack: string[] = []; // stack of canonical IDs by depth

  for (const mt of data.tasks) {
    const canonicalId = taskUidToCanonical.get(mt.uid)!;
    const name = mt.name?.trim() || "(unnamed)";
    const outlineLevel = parseInt(mt.outlineLevel || "0", 10);
    const isSummary = mt.summary === "1";

    // MSP UID 0 is often the project summary — skip it
    if (mt.uid === "0") continue;

    // Duration: ISO 8601 → working days
    const rawHours = parseIso8601DurationHours(mt.duration);
    let duration: number;
    if (isNaN(rawHours)) {
      duration = isSummary ? 0 : 1;
      if (!isSummary && mt.duration) {
        diagnostics.push({
          code: "DURATION_FRACTIONAL_ROUNDED",
          severity: "warning",
          message: `Unparseable duration "${mt.duration}" defaulted to ${duration} day`,
          sourceEntityId: mt.uid,
          canonicalEntityId: canonicalId,
          field: "Duration",
          originalValue: mt.duration,
          mappedValue: String(duration),
        });
      }
    } else {
      const rawDays = rawHours / hoursPerDay;
      duration = isSummary ? 0 : Math.max(1, Math.round(rawDays));
      if (!isSummary && rawDays > 0 && Math.abs(rawDays - Math.round(rawDays)) > 0.01) {
        diagnostics.push({
          code: "DURATION_FRACTIONAL_ROUNDED",
          severity: "warning",
          message: `Duration rounded from ${rawDays.toFixed(2)} to ${duration} days`,
          sourceEntityId: mt.uid,
          canonicalEntityId: canonicalId,
          field: "Duration",
          originalValue: mt.duration,
          mappedValue: String(duration),
        });
      }
    }

    // Depth from outline level (MSP outline level is 1-based; our depth is 0-based)
    const depth = Math.max(0, outlineLevel - 1);

    // Parent: reconstruct from outline level hierarchy
    // Trim stack to current depth, then the last entry is parent
    parentStack.length = depth;
    const parentId = depth > 0 ? parentStack[depth - 1] : undefined;

    // Push current task as potential parent at this depth
    parentStack[depth] = canonicalId;

    // Constraint type
    let constraintType: ConstraintType | undefined;
    let constraintDate: number | null | undefined;

    if (mt.constraintType && mt.constraintType !== "" && mt.constraintType !== "0") {
      const mapping = MSP_CONSTRAINT_MAP[mt.constraintType];
      if (mapping) {
        constraintType = mapping.canonical;
        if (!mapping.lossless) {
          diagnostics.push({
            code: "CONSTRAINT_APPROXIMATED",
            severity: "warning",
            message: `MSP constraint type ${mt.constraintType} approximated as "${mapping.canonical}"`,
            sourceEntityId: mt.uid,
            canonicalEntityId: canonicalId,
            field: "ConstraintType",
            originalValue: mt.constraintType,
            mappedValue: mapping.canonical,
          });
        }
      } else {
        constraintType = "ASAP";
        diagnostics.push({
          code: "CONSTRAINT_APPROXIMATED",
          severity: "warning",
          message: `Unknown MSP constraint type "${mt.constraintType}" mapped to ASAP`,
          sourceEntityId: mt.uid,
          canonicalEntityId: canonicalId,
          field: "ConstraintType",
          originalValue: mt.constraintType,
          mappedValue: "ASAP",
        });
      }

      // Constraint date → day-offset from project start
      const cstrDate = parseMspDate(mt.constraintDate);
      if (cstrDate && !isNaN(projectStartMs)) {
        const cstrMs = Date.parse(cstrDate);
        if (!isNaN(cstrMs)) {
          constraintDate = Math.round((cstrMs - projectStartMs) / MS_PER_DAY);
        }
      }
    }

    tasks.push({
      id: canonicalId,
      name,
      duration,
      depth,
      isSummary,
      parentId,
      constraintType,
      constraintDate,
    });
  }

  // ── Map dependencies (from PredecessorLinks) ──────────────────
  const dependencies: Dependency[] = [];

  for (const mt of data.tasks) {
    if (mt.uid === "0") continue;
    const succId = taskUidToCanonical.get(mt.uid);
    if (!succId) continue;

    for (const link of mt.predecessorLinks) {
      const predId = taskUidToCanonical.get(link.predecessorUID);
      if (!predId) {
        diagnostics.push({
          code: "DEPENDENCY_TYPE_UNKNOWN",
          severity: "warning",
          message: `PredecessorLink references unknown task UID ${link.predecessorUID} — skipped`,
          sourceEntityId: mt.uid,
          field: "PredecessorUID",
          originalValue: link.predecessorUID,
        });
        continue;
      }

      // Dependency type
      const depType = MSP_DEP_TYPE_MAP[link.type];
      const canonicalDepType: DependencyType = depType ?? "FS";
      if (!depType) {
        diagnostics.push({
          code: "DEPENDENCY_TYPE_UNKNOWN",
          severity: "warning",
          message: `Unknown MSP dependency type "${link.type}" defaulted to FS`,
          sourceEntityId: mt.uid,
          field: "Type",
          originalValue: link.type,
          mappedValue: "FS",
        });
      }

      // Lag: MSP stores in tenths of minutes → convert to working days
      const lagTenthsOfMinutes = parseInt(link.linkLag || "0", 10);
      const lagMinutes = lagTenthsOfMinutes / 10;
      const lagDays = lagMinutes / (hoursPerDay * 60);
      const lag = Math.round(lagDays);
      if (lagDays !== 0 && Math.abs(lagDays - lag) > 0.01) {
        diagnostics.push({
          code: "LAG_FRACTIONAL_ROUNDED",
          severity: "warning",
          message: `Lag rounded from ${lagDays.toFixed(2)} to ${lag} days`,
          sourceEntityId: mt.uid,
          field: "LinkLag",
          originalValue: link.linkLag,
          mappedValue: String(lag),
        });
      }

      dependencies.push({
        id: generateId(),
        predId,
        succId,
        type: canonicalDepType,
        lag,
      });
    }
  }

  // ── Map resources ─────────────────────────────────────────────
  const resources: Resource[] = [];

  for (const mr of data.resources) {
    // MSP UID 0 is often a placeholder "Unassigned" resource — skip
    if (mr.uid === "0") continue;

    const canonicalId = generateId();
    resourceUidToCanonical.set(mr.uid, canonicalId);

    const maxUnitsPercent = parseFloat(mr.maxUnits || "100");
    const maxUnitsPerDay = maxUnitsPercent / 100 || 1;

    resources.push({
      id: canonicalId,
      name: mr.name?.trim() || "(unnamed)",
      maxUnitsPerDay,
    });
  }

  // ── Map assignments ───────────────────────────────────────────
  const assignments: Assignment[] = [];

  for (const ma of data.assignments) {
    const taskId = taskUidToCanonical.get(ma.taskUID);
    const resourceId = resourceUidToCanonical.get(ma.resourceUID);

    if (!taskId) {
      diagnostics.push({
        code: "PARSE_INVALID_ROW",
        severity: "warning",
        message: `Assignment UID ${ma.uid} references unknown task UID ${ma.taskUID} — skipped`,
        sourceEntityId: ma.uid,
        field: "TaskUID",
        originalValue: ma.taskUID,
      });
      continue;
    }

    if (!resourceId) {
      // MSP often has assignments with ResourceUID 0 (unassigned) — skip silently
      if (ma.resourceUID === "0") continue;
      diagnostics.push({
        code: "PARSE_INVALID_ROW",
        severity: "warning",
        message: `Assignment UID ${ma.uid} references unknown resource UID ${ma.resourceUID} — skipped`,
        sourceEntityId: ma.uid,
        field: "ResourceUID",
        originalValue: ma.resourceUID,
      });
      continue;
    }

    const unitsPercent = parseFloat(ma.units || "100");
    const unitsPerDay = unitsPercent / 100 || 1;

    assignments.push({
      id: generateId(),
      taskId,
      resourceId,
      unitsPerDay,
    });
  }

  // ── Unsupported feature diagnostics ───────────────────────────
  diagnostics.push({
    code: "UNSUPPORTED_ACTUALS",
    severity: "info",
    message: "Actual dates and percent complete are not imported — actuals tracking not yet supported",
  });
  diagnostics.push({
    code: "UNSUPPORTED_COST",
    severity: "info",
    message: "Cost and budget data are not imported — cost model not in scope",
  });
  diagnostics.push({
    code: "CALENDAR_SIMPLIFIED",
    severity: "info",
    message: "Calendar data simplified to project-level default — per-task and per-resource calendars not yet supported",
  });

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
