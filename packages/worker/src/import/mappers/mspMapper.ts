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
 * - Duration: ISO 8601 duration string → WorkMinutes (×MINUTES_PER_DAY)
 * - Constraint types: numeric mapping table per spec §3.2.1
 * - Dependency types: 0→FF, 1→FS, 2→SF, 3→SS per MSP convention
 * - Lag: tenths of minutes → WorkMinutes (×MINUTES_PER_DAY)
 * - Resources: MaxUnits (percent) → decimal maxUnitsPerDay
 * - Assignments: Units (percent) → decimal unitsPerDay
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
import type { MspData } from "../types/mspTypes.js";
import { resolveCalendarInheritance } from "./calendarInheritance.js";
import { buildCalendarFidelitySummary, mapMspCalendars } from "./calendarMapper.js";

// ─── Result Type ────────────────────────────────────────────────────

export type MspMapperResult = {
  readonly tasks: readonly Task[];
  readonly dependencies: readonly Dependency[];
  readonly resources: readonly Resource[];
  readonly assignments: readonly Assignment[];
  readonly diagnostics: readonly ImportDiagnostic[];
  readonly projectName: string;
  readonly projectStartDate: string;
  readonly sourceImportFidelityState: SourceImportFidelityState;
  /** Calendar definitions extracted from MSP calendars (sidecar, not used by engine). */
  readonly calendarDefinitions: Readonly<Record<CalendarId, BaseCalendarDefinition>>;
  /** W3C: Resolved (flattened) calendar definitions after inheritance resolution. */
  readonly resolvedCalendarDefinitions: Readonly<Record<CalendarId, BaseCalendarDefinition>>;
  /** Calendar fidelity counts for ImportSummary. */
  readonly calendarFidelity: CalendarFidelitySummary;
  /** W4.3: Project-level default settings preserved from MSP (informational). */
  readonly sourceProjectSettings: SourceProjectSettings;
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

function parseOffsetMinutes(sourceDate: string | undefined, projectStartMs: number): number | undefined {
  if (!sourceDate || Number.isNaN(projectStartMs)) return undefined;
  const ms = Date.parse(sourceDate);
  if (Number.isNaN(ms)) return undefined;
  return Math.round((ms - projectStartMs) / 60_000);
}

function parseIsoDurationToWorkMinutes(iso: string | undefined, hoursPerDay: number): WorkMinutes | undefined {
  if (!iso || hoursPerDay <= 0) return undefined;
  const hours = parseIso8601DurationHours(iso);
  if (Number.isNaN(hours) || hours < 0) return undefined;
  const minutes = Math.round((hours / hoursPerDay) * MINUTES_PER_DAY);
  return minutes as WorkMinutes;
}

function parsePercent(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = parseFloat(raw);
  return Number.isFinite(value) ? value : undefined;
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
  const projectStatusDate = data.project.statusDate || undefined;

  // ── Build UID → canonical ID lookup ───────────────────────────
  const taskUidToCanonical = new Map<string, string>();
  const resourceUidToCanonical = new Map<string, string>();
  // ── Calendar extraction ───────────────────────────────────────
  const {
    calendarDefinitions,
    calUidToCalendarId,
    diagnostics: calDiagnostics,
    calendarsWithInheritance,
    calendarsSimplifiedForEngine,
    totalExceptionCount,
  } = mapMspCalendars(data.calendars);
  diagnostics.push(...calDiagnostics);
  // ── Map tasks ─────────────────────────────────────────────────
  const tasks: Task[] = [];
  const actualsByTaskId: Record<string, SourceTaskActuals> = {};
  const progressByTaskId: Record<string, SourceTaskProgress> = {};
  const sourceDatesByTaskId: Record<string, SourceTaskDates> = {};
  let tasksWithRawActualFields = 0;
  let tasksWithRawProgressFields = 0;

  // First pass: assign canonical IDs for all tasks
  for (const mt of data.tasks) {
    taskUidToCanonical.set(mt.uid, generateId());
  }

  // Track parent IDs by outline level for hierarchy reconstruction
  const parentStack: string[] = []; // stack of canonical IDs by depth
  let taskIndex = 0;

  for (const mt of data.tasks) {
    const canonicalId = taskUidToCanonical.get(mt.uid)!;
    const name = mt.name?.trim() || "(unnamed)";
    const outlineLevel = parseInt(mt.outlineLevel || "0", 10);
    const isSummary = mt.summary === "1";

    // MSP UID 0 is often the project summary — skip it
    if (mt.uid === "0") continue;

    // Duration: ISO 8601 → working days → WorkMinutes
    const rawHours = parseIso8601DurationHours(mt.duration);
    let durationWorkMinutes: WorkMinutes;
    if (isNaN(rawHours)) {
      const durationDays = isSummary ? 0 : 1;
      durationWorkMinutes = (durationDays * MINUTES_PER_DAY) as WorkMinutes;
      if (!isSummary && mt.duration) {
        diagnostics.push({
          code: "DURATION_FRACTIONAL_ROUNDED",
          severity: "warning",
          message: `Unparseable duration "${mt.duration}" defaulted to ${durationDays} day`,
          sourceEntityId: mt.uid,
          canonicalEntityId: canonicalId,
          field: "Duration",
          originalValue: mt.duration,
          mappedValue: String(durationDays),
        });
      }
    } else {
      const rawDays = rawHours / hoursPerDay;
      const durationDays = isSummary ? 0 : Math.max(1, Math.round(rawDays));
      durationWorkMinutes = (durationDays * MINUTES_PER_DAY) as WorkMinutes;
      if (!isSummary && rawDays > 0 && Math.abs(rawDays - Math.round(rawDays)) > 0.01) {
        diagnostics.push({
          code: "DURATION_FRACTIONAL_ROUNDED",
          severity: "warning",
          message: `Duration rounded from ${rawDays.toFixed(2)} to ${durationDays} days`,
          sourceEntityId: mt.uid,
          canonicalEntityId: canonicalId,
          field: "Duration",
          originalValue: mt.duration,
          mappedValue: String(durationDays),
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
    let constraintDateMinutes: WorkMinutes | null | undefined;

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

      // Constraint date → day-offset from project start → WorkMinutes
      const cstrDate = parseMspDate(mt.constraintDate);
      if (cstrDate && !isNaN(projectStartMs)) {
        const cstrMs = Date.parse(cstrDate);
        if (!isNaN(cstrMs)) {
          const dayOffset = Math.round((cstrMs - projectStartMs) / MS_PER_DAY);
          constraintDateMinutes = (dayOffset * MINUTES_PER_DAY) as WorkMinutes;
        }
      }
    }

    tasks.push({
      id: canonicalId,
      sourceActivityId: mt.id?.trim() || undefined,
      name,
      durationWorkMinutes,
      parentId,
      constraintType,
      constraintDateMinutes,
      siblingOrder: generateMigrationKey(taskIndex++),
      assignedCalendarId: mt.calendarUID ? calUidToCalendarId.get(mt.calendarUID) : undefined,
    });

    const actuals: SourceTaskActuals = {
      actualStartMinutes: parseOffsetMinutes(mt.actualStart, projectStartMs),
      actualFinishMinutes: parseOffsetMinutes(mt.actualFinish, projectStartMs),
      actualDurationWorkMinutes: parseIsoDurationToWorkMinutes(mt.actualDuration, hoursPerDay),
      remainingDurationWorkMinutes: parseIsoDurationToWorkMinutes(mt.remainingDuration, hoursPerDay),
      remainingStartMinutes: parseOffsetMinutes(mt.remainingStart, projectStartMs),
      remainingFinishMinutes: parseOffsetMinutes(mt.remainingFinish, projectStartMs),
      suspendDateMinutes: parseOffsetMinutes(mt.stop, projectStartMs),
      resumeDateMinutes: parseOffsetMinutes(mt.resume, projectStartMs),
      raw: {
        actualStart: mt.actualStart,
        actualFinish: mt.actualFinish,
        actualDuration: mt.actualDuration,
        remainingDuration: mt.remainingDuration,
      },
    };
    const hasRawActual = Boolean(
      mt.actualStart || mt.actualFinish || mt.actualDuration || mt.remainingDuration || mt.remainingStart || mt.remainingFinish,
    );
    if (hasRawActual) tasksWithRawActualFields += 1;
    const hasAnyActual = Object.entries(actuals).some(([key, value]) => key !== "raw" && value !== undefined);
    if (hasAnyActual) {
      actualsByTaskId[canonicalId] = actuals;
    }

    const progress: SourceTaskProgress = {
      physicalPercentComplete: parsePercent(mt.physicalPercentComplete),
      durationPercentComplete: parsePercent(mt.durationPercentComplete),
      unitsPercentComplete: parsePercent(mt.unitsPercentComplete),
      percentComplete: parsePercent(mt.percentComplete),
      percentWorkComplete: parsePercent(mt.percentWorkComplete),
      percentCompleteType: mt.percentCompleteType || undefined,
      raw: {
        percentComplete: mt.percentComplete,
        percentWorkComplete: mt.percentWorkComplete,
        physicalPercentComplete: mt.physicalPercentComplete,
        durationPercentComplete: mt.durationPercentComplete,
        unitsPercentComplete: mt.unitsPercentComplete,
        percentCompleteType: mt.percentCompleteType,
      },
    };
    const hasRawProgress = Boolean(
      mt.physicalPercentComplete || mt.durationPercentComplete || mt.unitsPercentComplete || mt.percentComplete || mt.percentWorkComplete,
    );
    if (hasRawProgress) tasksWithRawProgressFields += 1;
    const hasAnyProgress = Object.entries(progress).some(([key, value]) => key !== "raw" && value !== undefined);
    if (hasAnyProgress) {
      progressByTaskId[canonicalId] = progress;
    }

    const sourceDates: SourceTaskDates = {
      sourceStartMinutes: parseOffsetMinutes(mt.start, projectStartMs),
      sourceFinishMinutes: parseOffsetMinutes(mt.finish, projectStartMs),
      sourceRawStart: mt.start || undefined,
      sourceRawFinish: mt.finish || undefined,
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

      // Lag: MSP stores in tenths of minutes → convert to working days → WorkMinutes
      const lagTenthsOfMinutes = parseInt(link.linkLag || "0", 10);
      const lagMinutes = lagTenthsOfMinutes / 10;
      const lagDays = lagMinutes / (hoursPerDay * 60);
      const lagDaysRounded = Math.round(lagDays);
      if (lagDays !== 0 && Math.abs(lagDays - lagDaysRounded) > 0.01) {
        diagnostics.push({
          code: "LAG_FRACTIONAL_ROUNDED",
          severity: "warning",
          message: `Lag rounded from ${lagDays.toFixed(2)} to ${lagDaysRounded} days`,
          sourceEntityId: mt.uid,
          field: "LinkLag",
          originalValue: link.linkLag,
          mappedValue: String(lagDaysRounded),
        });
      }
      const lagWorkMinutes = (lagDaysRounded * MINUTES_PER_DAY) as WorkMinutes;

      dependencies.push({
        id: generateId(),
        predId,
        succId,
        type: canonicalDepType,
        lagWorkMinutes,
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
  const preservedActualCount = Object.keys(actualsByTaskId).length;
  const preservedProgressCount = Object.keys(progressByTaskId).length;

  if (tasksWithRawActualFields > preservedActualCount) {
    diagnostics.push({
      code: "UNSUPPORTED_ACTUALS",
      severity: "warning",
      message: `Some MSP actual fields could not be preserved (${preservedActualCount}/${tasksWithRawActualFields} tasks).`,
    });
  } else if (preservedActualCount === 0 && tasksWithRawActualFields === 0) {
    diagnostics.push({
      code: "UNSUPPORTED_ACTUALS",
      severity: "info",
      message: "No MSP actuals were present in the source file.",
    });
  }

  if (tasksWithRawProgressFields > preservedProgressCount) {
    diagnostics.push({
      code: "UNSUPPORTED_ACTUALS",
      severity: "warning",
      message: `Some MSP progress fields could not be preserved (${preservedProgressCount}/${tasksWithRawProgressFields} tasks).`,
    });
  }
  diagnostics.push({
    code: "UNSUPPORTED_COST",
    severity: "info",
    message: "Cost and budget data are not imported — cost model not in scope",
  });

  // ── Calendar fidelity ────────────────────────────────────────
  const taskCalendarAssignments = tasks.filter(t => t.assignedCalendarId !== undefined).length;
  const resourceCalendarAssignments = data.resources.filter(r => r.calendarUID).length;

  if (taskCalendarAssignments > 0) {
    diagnostics.push({
      code: "TASK_CALENDAR_IGNORED_BY_ENGINE",
      severity: "info",
      message: `${taskCalendarAssignments} task(s) have assigned calendars — preserved in sidecar data, engine uses project default`,
    });
  }
  if (resourceCalendarAssignments > 0) {
    diagnostics.push({
      code: "RESOURCE_CALENDAR_PRESERVED_INACTIVE",
      severity: "info",
      message: `${resourceCalendarAssignments} resource(s) have assigned calendars — preserved in sidecar data, not yet active`,
    });
  }

  // W3C: Resolve calendar inheritance
  const { resolvedDefinitions, diagnostics: inheritanceDiags, unresolvedCount } =
    resolveCalendarInheritance(calendarDefinitions);
  diagnostics.push(...inheritanceDiags);

  const calendarFidelity = buildCalendarFidelitySummary({
    totalCalendars: data.calendars.length,
    taskCalendarAssignments,
    resourceCalendarAssignments,
    exceptionCount: totalExceptionCount,
    calendarsWithInheritance,
    calendarsSimplifiedForEngine,
    unresolvedInheritanceCount: unresolvedCount,
  });

  // ── W4.3: Build source project settings (informational) ──────
  const minutesPerDayNum = parseFloat(data.project.minutesPerDay) || undefined;
  const minutesPerWeekNum = data.project.minutesPerWeek ? parseFloat(data.project.minutesPerWeek) : undefined;
  const daysPerMonthNum = data.project.daysPerMonth ? parseFloat(data.project.daysPerMonth) : undefined;
  const criticalSlackLimitNum = data.project.criticalSlackLimit ? parseFloat(data.project.criticalSlackLimit) : undefined;
  const scheduleFrom = data.project.scheduleFromStart != null
    ? (data.project.scheduleFromStart === "1" ? "Start" : "Finish")
    : undefined;

  const sourceProjectSettings: SourceProjectSettings = {
    sourceProjectId: data.project.name || undefined,
    defaultCalendarUID: data.project.calendarUID || undefined,
    planStartDate: projectStartDate || undefined,
    statusDate: projectStatusDate || undefined,
    minutesPerDay: Number.isFinite(minutesPerDayNum) ? minutesPerDayNum : undefined,
    minutesPerWeek: Number.isFinite(minutesPerWeekNum) ? minutesPerWeekNum : undefined,
    daysPerMonth: Number.isFinite(daysPerMonthNum) ? daysPerMonthNum : undefined,
    scheduleFrom,
    criticalFloatThreshold: Number.isFinite(criticalSlackLimitNum) ? criticalSlackLimitNum : undefined,
  };

  // ── W4.3: Emit preservation diagnostics ──────────────────────
  if (data.project.calendarUID) {
    diagnostics.push({
      code: "PROJECT_DEFAULT_CALENDAR_PRESERVED_INACTIVE",
      severity: "info",
      message: `Project default calendar UID ${data.project.calendarUID} preserved — not yet active in scheduling engine`,
      field: "CalendarUID",
      originalValue: data.project.calendarUID,
    });
  }
  if (minutesPerWeekNum !== undefined && Number.isFinite(minutesPerWeekNum)) {
    diagnostics.push({
      code: "PROJECT_HOURS_PER_PERIOD_PRESERVED_INACTIVE",
      severity: "info",
      message: `Project minutes/week (${minutesPerWeekNum}) and minutes/day (${minutesPerDayNum}) preserved — engine uses fixed working time`,
      field: "MinutesPerWeek",
      originalValue: data.project.minutesPerWeek,
    });
  }
  if (criticalSlackLimitNum !== undefined && Number.isFinite(criticalSlackLimitNum)) {
    diagnostics.push({
      code: "CRITICAL_PATH_SETTING_PRESERVED_INACTIVE",
      severity: "info",
      message: `Critical slack limit (${criticalSlackLimitNum}d) preserved — engine uses its own critical path logic`,
      field: "CriticalSlackLimit",
      originalValue: data.project.criticalSlackLimit,
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
    calendarDefinitions,
    resolvedCalendarDefinitions: resolvedDefinitions,
    calendarFidelity,
    sourceProjectSettings,
    sourceImportFidelityState: {
      projectStatus: projectStatusDate
        ? {
            statusDate: projectStatusDate,
            sourceRawDate: projectStatusDate,
            sourceSystem: "MSP_XML",
          }
        : undefined,
      actualsByTaskId,
      progressByTaskId,
      sourceDatesByTaskId,
    },
  };
}
