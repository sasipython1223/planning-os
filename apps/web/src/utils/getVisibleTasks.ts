import type { Task } from "protocol";

/**
 * Pure flat projection: returns tasks visible after collapsing.
 * Hides descendants of any collapsed summary task.
 * Preserves original ordering from the Worker.
 */
export function getVisibleTasks(
  tasks: readonly Task[],
  collapsedIds: ReadonlySet<string>,
): Task[] {
  if (collapsedIds.size === 0) return tasks as Task[];

  // Build ancestor-set of collapsed IDs for efficient skipping
  const hiddenParents = new Set<string>();
  const result: Task[] = [];

  for (const task of tasks) {
    // If any ancestor is collapsed, skip this task
    if (task.parentId && hiddenParents.has(task.parentId)) {
      // Propagate: this task's children should also be hidden
      hiddenParents.add(task.id);
      continue;
    }
    result.push(task);
    // If this task is collapsed, its children will be hidden
    if (collapsedIds.has(task.id)) {
      hiddenParents.add(task.id);
    }
  }

  return result;
}
