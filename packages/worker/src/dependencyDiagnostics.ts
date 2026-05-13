/**
 * TD-REL.6A — Worker-projected dependency driving diagnostics.
 *
 * Pure function. Consumes already-computed CPM schedule results and the
 * dependency list. Does NOT reschedule, does NOT touch calendar math.
 *
 * Driving definition (slot kernel, integer working-day-offset / minute unit):
 *   FS: pred.EF + lag == succ.ES  →  linkSlack = succ.ES − (pred.EF + lag)
 *   SS: pred.ES + lag == succ.ES  →  linkSlack = succ.ES − (pred.ES + lag)
 *   FF: pred.EF + lag == succ.EF  →  linkSlack = succ.EF − (pred.EF + lag)
 *   SF: pred.ES + lag == succ.EF  →  linkSlack = succ.EF − (pred.ES + lag)
 *
 * isDriving = linkSlack === 0.
 * isDriving is undefined (diagnostic exists, no value) when:
 *   - either activity is a known summary task, or
 *   - either activity's schedule result is missing.
 */

import type {
    Dependency,
    DependencyDiagnosticsMap,
    ScheduleResultMap
} from "@planner/protocol";

/**
 * Compute relationship-level driving diagnostics for every dependency.
 *
 * @param dependencies  Full dependency list (read-only, never mutated).
 * @param scheduleResults  Latest CPM results keyed by task id.
 * @param summaryTaskIds  Set of task ids that are summary/WBS rows.
 *                        Diagnostics for these are emitted with isDriving undefined.
 */
export function computeDependencyDiagnostics(
  dependencies: readonly Dependency[],
  scheduleResults: ScheduleResultMap,
  summaryTaskIds: ReadonlySet<string>,
): DependencyDiagnosticsMap {
  const out: DependencyDiagnosticsMap = {};

  for (const dep of dependencies) {
    const { id, predId, succId, type, lagWorkMinutes } = dep;
    const lag = lagWorkMinutes as number;

    // Summary tasks: unavailable
    if (summaryTaskIds.has(predId) || summaryTaskIds.has(succId)) {
      out[id] = { dependencyId: id };
      continue;
    }

    const pred = scheduleResults[predId];
    const succ = scheduleResults[succId];

    // Missing schedule result: unavailable
    if (!pred || !succ) {
      out[id] = { dependencyId: id };
      continue;
    }

    const predES = pred.earlyStartMinutes as number;
    const predEF = pred.earlyFinishMinutes as number;
    const succES = succ.earlyStartMinutes as number;
    const succEF = succ.earlyFinishMinutes as number;

    let linkSlack: number;
    let controllingDate: "ES" | "EF";

    switch (type) {
      case "FS":
        linkSlack = succES - (predEF + lag);
        controllingDate = "ES";
        break;
      case "SS":
        linkSlack = succES - (predES + lag);
        controllingDate = "ES";
        break;
      case "FF":
        linkSlack = succEF - (predEF + lag);
        controllingDate = "EF";
        break;
      case "SF":
        linkSlack = succEF - (predES + lag);
        controllingDate = "EF";
        break;
      default:
        // Unknown relationship type: unavailable
        out[id] = { dependencyId: id };
        continue;
    }

    out[id] = {
      dependencyId: id,
      isDriving: linkSlack === 0,
      linkSlackMinutes: linkSlack,
      controllingDate,
    };
  }

  return out;
}

/**
 * Build the set of summary task ids from the task list.
 * A task is considered a summary when:
 *   - its isStructuralSummary flag is true, OR
 *   - it appears as a parentId of at least one other task (has children).
 */
export function buildSummaryTaskIds(
  tasks: readonly { id: string; parentId?: string; isStructuralSummary?: boolean }[],
): Set<string> {
  const taskIdsWithChildren = new Set<string>();
  for (const t of tasks) {
    if (t.parentId) taskIdsWithChildren.add(t.parentId);
  }
  const result = new Set<string>();
  for (const t of tasks) {
    if (t.isStructuralSummary || taskIdsWithChildren.has(t.id)) {
      result.add(t.id);
    }
  }
  return result;
}
