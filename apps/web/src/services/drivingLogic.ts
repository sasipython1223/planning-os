/**
 * TD-TRACE.2B — Immediate driving logic derivation.
 *
 * Pure function. Reads precomputed dependencyDiagnostics.isDriving (TD-REL.6A).
 * Does NOT compute CPM, dates, link slack, float, or critical path.
 * Does NOT mutate any state.
 */

import type { Dependency, DependencyDiagnosticsMap } from "@planner/protocol";

export type ImmediateDrivingLogicResult = {
  sourceTaskId: string;
  drivingPredecessorIds: string[];
  drivenSuccessorIds: string[];
  involvedTaskIds: string[];
};

/**
 * Derive the immediate driving predecessors and driven successors of a task.
 *
 * A relationship is included only when dependencyDiagnosticsMap[dep.id]?.isDriving === true.
 * Missing diagnostics, undefined isDriving, or isDriving === false all result in exclusion.
 */
export function deriveImmediateDrivingLogic(input: {
  sourceTaskId: string;
  dependencies: readonly Dependency[];
  dependencyDiagnosticsMap: DependencyDiagnosticsMap;
}): ImmediateDrivingLogicResult {
  const { sourceTaskId, dependencies, dependencyDiagnosticsMap } = input;

  const drivingPredecessorIds: string[] = [];
  const drivenSuccessorIds: string[] = [];

  for (const dep of dependencies) {
    const isDriving = dependencyDiagnosticsMap[dep.id]?.isDriving;
    // Only include explicitly true — undefined/false/missing all excluded
    if (isDriving !== true) continue;

    if (dep.succId === sourceTaskId) {
      drivingPredecessorIds.push(dep.predId);
    } else if (dep.predId === sourceTaskId) {
      drivenSuccessorIds.push(dep.succId);
    }
  }

  const involvedTaskIds = [
    ...drivingPredecessorIds,
    sourceTaskId,
    ...drivenSuccessorIds,
  ];

  return {
    sourceTaskId,
    drivingPredecessorIds,
    drivenSuccessorIds,
    involvedTaskIds,
  };
}
