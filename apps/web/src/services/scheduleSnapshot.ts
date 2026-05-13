/**
 * Schedule Snapshot Builder — AI-1
 *
 * Pure, read-only projection of the current web-app state into a
 * safe, serialisable shape for the AI advisory layer.
 *
 * HARD CONSTRAINTS:
 * - No imports from packages/worker/**
 * - No worker postMessage
 * - No command dispatch
 * - No mutation of input data
 * - No persistence of output
 */

import type {
    BaselineMap,
    Dependency,
    DiagnosticsMap,
    ScheduleResultMap,
    Task,
    VarianceMap,
    VisibleRow,
} from "@planner/protocol";
import { MINUTES_PER_DAY } from "@planner/protocol";

// ─── Public snapshot types ────────────────────────────────────────────────────

export type AIWbsSummary = {
  readonly id: string;
  readonly name: string;
  readonly wbsCode: string;
  readonly depth: number;
  readonly isSummary: boolean;
  readonly rollupStartMinutes: number | null;
  readonly rollupFinishMinutes: number | null;
  readonly rollupDurationMinutes: number | null;
  readonly rollupPercentComplete: number | null;
};

export type AITaskSummary = {
  readonly id: string;
  readonly name: string;
  readonly wbsCode: string;
  readonly parentId: string | null;
  readonly durationWorkMinutes: number;
  readonly durationDays: number;
  readonly isMilestone: boolean;
  readonly isSummary: boolean;
  readonly constraintType: string | null;
  readonly constraintDateMinutes: number | null;
  readonly sourceActivityId: string | null;
  readonly activityCode: string | null;
  /** null when task is unscheduled */
  readonly earlyStartMinutes: number | null;
  readonly earlyFinishMinutes: number | null;
  readonly lateStartMinutes: number | null;
  readonly lateFinishMinutes: number | null;
  readonly totalFloatMinutes: number | null;
  readonly isCritical: boolean;
  readonly diagnosticCodes: readonly string[];
  /** null when no baseline has been captured */
  readonly startVarianceMinutes: number | null;
  readonly finishVarianceMinutes: number | null;
};

export type AIMilestone = {
  readonly id: string;
  readonly name: string;
  readonly wbsCode: string;
  readonly earlyFinishMinutes: number | null;
  readonly isCritical: boolean;
};

export type AICriticalTask = {
  readonly id: string;
  readonly name: string;
  readonly wbsCode: string;
  readonly totalFloatMinutes: number;
  /** true = zero float; false = near-critical (float ≤ NEAR_CRITICAL_THRESHOLD) */
  readonly isCritical: boolean;
};

export type AIConstrainedTask = {
  readonly id: string;
  readonly name: string;
  readonly wbsCode: string;
  readonly constraintType: string;
  readonly constraintDateMinutes: number | null;
  readonly isCritical: boolean;
  readonly diagnosticCodes: readonly string[];
};

export type AIDependencySummary = {
  readonly id: string;
  readonly predId: string;
  readonly predName: string;
  readonly succId: string;
  readonly succName: string;
  readonly type: string;
  readonly lagWorkMinutes: number;
};

export type AIMissingLogicCandidate = {
  readonly id: string;
  readonly name: string;
  readonly wbsCode: string;
  readonly hasPredecessor: boolean;
  readonly hasSuccessor: boolean;
};

export type AILongDurationCandidate = {
  readonly id: string;
  readonly name: string;
  readonly wbsCode: string;
  readonly durationWorkMinutes: number;
  readonly durationDays: number;
};

export type AIDiagnosticEntry = {
  readonly taskId: string;
  readonly taskName: string;
  readonly codes: readonly string[];
};

export type AIScheduleSnapshot = {
  /** ISO date string — project start. */
  readonly projectStartDate: string;
  readonly taskCount: number;
  readonly dependencyCount: number;
  /** Tasks that have a schedule result (early/late times computed). */
  readonly scheduledCount: number;
  readonly criticalCount: number;
  /** Summary/WBS rows only — leaf activities excluded. */
  readonly wbsSummary: readonly AIWbsSummary[];
  /** All tasks including summaries and leaves. */
  readonly tasks: readonly AITaskSummary[];
  /** Zero-duration non-summary tasks. */
  readonly milestones: readonly AIMilestone[];
  /** Critical and near-critical leaf activities (float ≤ 2 working days). */
  readonly criticalTasks: readonly AICriticalTask[];
  /** Non-ASAP constrained tasks. */
  readonly constrainedTasks: readonly AIConstrainedTask[];
  /** All dependencies with resolved predecessor/successor names. */
  readonly dependencies: readonly AIDependencySummary[];
  /** Leaf activities (non-milestone) with no predecessor or no successor. */
  readonly missingLogicCandidates: readonly AIMissingLogicCandidate[];
  /** Non-summary tasks with duration ≥ 20 working days. */
  readonly longDurationCandidates: readonly AILongDurationCandidate[];
  /** Tasks with at least one diagnostic code. */
  readonly diagnosticsSummary: readonly AIDiagnosticEntry[];
};

// ─── Thresholds ───────────────────────────────────────────────────────────────

/** Float at or below this value (minutes) qualifies a task as near-critical. */
const NEAR_CRITICAL_FLOAT_THRESHOLD = 2 * MINUTES_PER_DAY; // 2 working days = 960 min

/** Duration at or above this value (minutes) flags a task as a long-duration candidate. */
const LONG_DURATION_THRESHOLD = 20 * MINUTES_PER_DAY; // 20 working days = 9600 min

// ─── Builder ──────────────────────────────────────────────────────────────────

/**
 * Build a read-only, serialisable AI schedule snapshot from the current
 * web-app state.
 *
 * Pure function — no side effects, no worker contact, no mutations.
 *
 * @param tasks          Canonical task list from DIFF_STATE.
 * @param visibleRows    Worker-projected rows (supply wbsCode, depth, rollup fields).
 * @param dependencies   Canonical dependency list from DIFF_STATE.
 * @param scheduleResults Per-task schedule results from DIFF_STATE.
 * @param diagnosticsMap  Per-task diagnostic codes from DIFF_STATE.
 * @param projectStartDate ISO project start date string.
 * @param variances      Per-task baseline variances from DIFF_STATE.
 * @param _baselines     Accepted but not included in snapshot (baseline entries are
 *                       summarised via variances instead to avoid bloat).
 */
export function buildScheduleSnapshot(
  tasks: readonly Task[],
  visibleRows: readonly VisibleRow[],
  dependencies: readonly Dependency[],
  scheduleResults: ScheduleResultMap,
  diagnosticsMap: DiagnosticsMap,
  projectStartDate: string,
  variances: VarianceMap,
  _baselines?: BaselineMap,
): AIScheduleSnapshot {
  // ── Lookup maps (read-only access only) ─────────────────────────────────────
  const taskById = new Map<string, Task>(tasks.map((t) => [t.id, t]));
  const rowByTaskId = new Map<string, VisibleRow>(visibleRows.map((r) => [r.id, r]));

  // ── Predecessor / successor presence for missing-logic detection ─────────────
  const hasPred = new Set<string>(dependencies.map((d) => d.succId));
  const hasSucc = new Set<string>(dependencies.map((d) => d.predId));

  const scheduledCount = Object.keys(scheduleResults).length;
  const criticalCount = Object.values(scheduleResults).filter((r) => r.isCritical).length;

  // ── WBS summary (summary rows only) ──────────────────────────────────────────
  const wbsSummary: AIWbsSummary[] = visibleRows
    .filter((r) => r.isSummary)
    .map((r) => ({
      id: r.id,
      name: r.name,
      wbsCode: r.wbsCode,
      depth: r.depth,
      isSummary: r.isSummary,
      rollupStartMinutes: r.rollupStartMinutes ?? null,
      rollupFinishMinutes: r.rollupFinishMinutes ?? null,
      rollupDurationMinutes: r.rollupDurationMinutes ?? null,
      rollupPercentComplete: r.rollupPercentComplete ?? null,
    }));

  // ── Full task list ────────────────────────────────────────────────────────────
  const taskList: AITaskSummary[] = tasks.map((t) => {
    const row = rowByTaskId.get(t.id);
    const result = scheduleResults[t.id] ?? null;
    const variance = variances[t.id] ?? null;
    // A milestone is a zero-duration non-summary activity.
    const isMilestone = !(row?.isSummary ?? false) && t.durationWorkMinutes === 0;

    return {
      id: t.id,
      name: t.name,
      wbsCode: row?.wbsCode ?? "",
      parentId: t.parentId ?? null,
      durationWorkMinutes: t.durationWorkMinutes,
      durationDays: t.durationWorkMinutes / MINUTES_PER_DAY,
      isMilestone,
      isSummary: row?.isSummary ?? false,
      constraintType: t.constraintType ?? null,
      constraintDateMinutes: t.constraintDateMinutes ?? null,
      sourceActivityId: t.sourceActivityId ?? null,
      activityCode: t.activityCode ?? null,
      earlyStartMinutes: result?.earlyStartMinutes ?? null,
      earlyFinishMinutes: result?.earlyFinishMinutes ?? null,
      lateStartMinutes: result?.lateStartMinutes ?? null,
      lateFinishMinutes: result?.lateFinishMinutes ?? null,
      totalFloatMinutes: result?.totalFloatMinutes ?? null,
      isCritical: result?.isCritical ?? false,
      diagnosticCodes: diagnosticsMap[t.id] ?? [],
      startVarianceMinutes: variance?.startVarianceMinutes ?? null,
      finishVarianceMinutes: variance?.finishVarianceMinutes ?? null,
    };
  });

  // ── Milestones ────────────────────────────────────────────────────────────────
  const milestones: AIMilestone[] = taskList
    .filter((t) => t.isMilestone)
    .map((t) => ({
      id: t.id,
      name: t.name,
      wbsCode: t.wbsCode,
      earlyFinishMinutes: t.earlyFinishMinutes,
      isCritical: t.isCritical,
    }));

  // ── Critical / near-critical leaf activities ──────────────────────────────────
  const criticalTasks: AICriticalTask[] = taskList
    .filter(
      (t) =>
        !t.isSummary &&
        t.totalFloatMinutes !== null &&
        t.totalFloatMinutes <= NEAR_CRITICAL_FLOAT_THRESHOLD,
    )
    .map((t) => ({
      id: t.id,
      name: t.name,
      wbsCode: t.wbsCode,
      totalFloatMinutes: t.totalFloatMinutes as number,
      isCritical: t.isCritical,
    }));

  // ── Constrained tasks (non-ASAP) ──────────────────────────────────────────────
  const constrainedTasks: AIConstrainedTask[] = taskList
    .filter((t) => t.constraintType !== null && t.constraintType !== "ASAP")
    .map((t) => ({
      id: t.id,
      name: t.name,
      wbsCode: t.wbsCode,
      constraintType: t.constraintType as string,
      constraintDateMinutes: t.constraintDateMinutes,
      isCritical: t.isCritical,
      diagnosticCodes: t.diagnosticCodes,
    }));

  // ── Dependencies with resolved names ─────────────────────────────────────────
  const depsWithNames: AIDependencySummary[] = dependencies.map((d) => ({
    id: d.id,
    predId: d.predId,
    predName: taskById.get(d.predId)?.name ?? d.predId,
    succId: d.succId,
    succName: taskById.get(d.succId)?.name ?? d.succId,
    type: d.type,
    lagWorkMinutes: d.lagWorkMinutes,
  }));

  // ── Missing-logic candidates (leaf, non-milestone, with open predecessor or successor) ──
  const missingLogicCandidates: AIMissingLogicCandidate[] = taskList
    .filter((t) => !t.isSummary && !t.isMilestone)
    .filter((t) => !hasPred.has(t.id) || !hasSucc.has(t.id))
    .map((t) => ({
      id: t.id,
      name: t.name,
      wbsCode: t.wbsCode,
      hasPredecessor: hasPred.has(t.id),
      hasSuccessor: hasSucc.has(t.id),
    }));

  // ── Long-duration candidates ──────────────────────────────────────────────────
  const longDurationCandidates: AILongDurationCandidate[] = taskList
    .filter((t) => !t.isSummary && t.durationWorkMinutes >= LONG_DURATION_THRESHOLD)
    .map((t) => ({
      id: t.id,
      name: t.name,
      wbsCode: t.wbsCode,
      durationWorkMinutes: t.durationWorkMinutes,
      durationDays: t.durationDays,
    }));

  // ── Diagnostics summary ───────────────────────────────────────────────────────
  const diagnosticsSummary: AIDiagnosticEntry[] = Object.entries(diagnosticsMap)
    .filter(([, codes]) => codes.length > 0)
    .map(([taskId, codes]) => ({
      taskId,
      taskName: taskById.get(taskId)?.name ?? taskId,
      codes,
    }));

  return {
    projectStartDate,
    taskCount: tasks.length,
    dependencyCount: dependencies.length,
    scheduledCount,
    criticalCount,
    wbsSummary,
    tasks: taskList,
    milestones,
    criticalTasks,
    constrainedTasks,
    dependencies: depsWithNames,
    missingLogicCandidates,
    longDurationCandidates,
    diagnosticsSummary,
  };
}
