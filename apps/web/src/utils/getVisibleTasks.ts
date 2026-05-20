import type { Task } from "protocol";

/**
 * Pure UI projection: order tasks by existing parentId hierarchy metadata.
 *
 * Imported XER data may arrive as all WBS summary rows first, followed by
 * activities. That is valid Worker/import state, but it is not readable as a
 * professional programme table. This helper does not infer hierarchy from
 * dependencies and does not calculate schedule data; it only projects existing
 * parentId/depth/isSummary metadata into parent-before-child display order.
 */
export function orderTasksForHierarchyDisplay(tasks: readonly Task[]): Task[] {
  const childrenByParentId = new Map<string | null, Task[]>();
  const taskIds = new Set(tasks.map((task) => task.id));

  for (const task of tasks) {
    const parentKey = task.parentId && taskIds.has(task.parentId) ? task.parentId : null;
    const siblings = childrenByParentId.get(parentKey) ?? [];
    siblings.push(task);
    childrenByParentId.set(parentKey, siblings);
  }

  const ordered: Task[] = [];
  const emittedIds = new Set<string>();

  const visit = (task: Task) => {
    if (emittedIds.has(task.id)) return;
    emittedIds.add(task.id);
    ordered.push(task);

    for (const child of childrenByParentId.get(task.id) ?? []) {
      visit(child);
    }
  };

  for (const rootTask of childrenByParentId.get(null) ?? []) {
    visit(rootTask);
  }

  // Defensive fallback for malformed parent cycles or missing roots.
  // Preserves original Worker order for anything not emitted by the hierarchy walk.
  for (const task of tasks) {
    if (!emittedIds.has(task.id)) ordered.push(task);
  }

  return ordered;
}

/**
 * Pure flat projection: returns tasks visible after collapsing.
 * Hides descendants of any collapsed summary task.
 * Preserves parent-before-child display order from existing parentId metadata.
 */
export function getVisibleTasks(
  tasks: readonly Task[],
  collapsedIds: ReadonlySet<string>,
): Task[] {
  const orderedTasks = orderTasksForHierarchyDisplay(tasks);
  if (collapsedIds.size === 0) return orderedTasks;

  // Build ancestor-set of collapsed IDs for efficient skipping
  const hiddenParents = new Set<string>();
  const result: Task[] = [];

  for (const task of orderedTasks) {
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
