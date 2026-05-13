import type { Assignment, Dependency, VisibleRow } from "@planner/protocol";

export function getSelectedActivityId(selectedTask: VisibleRow | null | undefined): string | null {
  if (!selectedTask || selectedTask.isSummary) return null;
  return selectedTask.id;
}

export function getSelectedTaskDependencies(
  dependencies: readonly Dependency[],
  selectedActivityId: string | null,
): Dependency[] {
  if (!selectedActivityId) return [];
  const predecessorRows = dependencies.filter((dep) => dep.succId === selectedActivityId);
  const successorRows = dependencies.filter((dep) => dep.predId === selectedActivityId);
  return [...predecessorRows, ...successorRows];
}

export function getSelectedTaskAssignments(
  assignments: readonly Assignment[],
  selectedActivityId: string | null,
): Assignment[] {
  if (!selectedActivityId) return [];
  return assignments.filter((assignment) => assignment.taskId === selectedActivityId);
}
