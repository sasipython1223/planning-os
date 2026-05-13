/**
 * Structural validation — validates hierarchy mutations BEFORE state is changed.
 *
 * Architecture:
 * - Runs in Worker, before any canonical mutation
 * - Uses parentId + siblingOrder + map traversal (never depth/isSummary)
 * - Never calls kernel or scheduling
 * - Returns null if valid, or a rejection reason string
 */

import { compareSiblingOrder } from "./ordering.js";
import * as State from "./state.js";

// ── Helpers (read-only queries against canonical state) ──────────────

/** Check if `descendantId` is a descendant of `ancestorId` via parentId chain. */
const isDescendant = (descendantId: string, ancestorId: string): boolean => {
  const visited = new Set<string>();
  let current = State.findTask(descendantId);
  while (current?.parentId) {
    if (visited.has(current.id)) return false;
    visited.add(current.id);
    if (current.parentId === ancestorId) return true;
    current = State.findTask(current.parentId);
  }
  return false;
};

/** Get children of a parent (sorted by siblingOrder). */
const getChildrenOf = (parentId: string | undefined): readonly import("@planner/protocol").Task[] => {
  return State.getTasks()
    .filter(t => t.parentId === parentId)
    .sort((a, b) => compareSiblingOrder(a.siblingOrder, b.siblingOrder));
};

/**
 * Check if a task would violate the summary rule by becoming a new parent.
 *
 * A task that is about to gain its first child (become summary) must NOT have:
 * - dependencies (as pred or succ)
 * - non-ASAP constraints
 * - resource assignments
 *
 * If the task already has children it is already a summary — no new violation.
 */
const checkSummaryRule = (newParentId: string): string | null => {
  const parent = State.findTask(newParentId);
  if (!parent) return `Task ${newParentId} not found`;

  // Already has children → already a summary, no new violation
  const existingChildren = State.getTasks().filter(t => t.parentId === newParentId);
  if (existingChildren.length > 0) return null;

  // Will become summary — check for blocking attributes
  const deps = State.getDependencies();
  const hasDeps = deps.some(d => d.predId === newParentId || d.succId === newParentId);
  if (hasDeps) {
    return `Cannot make "${parent.name}" a summary: it has dependencies`;
  }

  const ct = parent.constraintType;
  if (ct && ct !== "ASAP") {
    return `Cannot make "${parent.name}" a summary: it has a ${ct} constraint`;
  }

  const assignments = State.getAssignments();
  const hasAssignments = assignments.some(a => a.taskId === newParentId);
  if (hasAssignments) {
    return `Cannot make "${parent.name}" a summary: it has resource assignments`;
  }

  return null;
};

// ── Public Validation Functions ──────────────────────────────────────

/**
 * Validate an indent operation BEFORE mutation.
 * Indent = make task a child of its previous sibling.
 */
export const validateIndent = (taskId: string): string | null => {
  const task = State.findTask(taskId);
  if (!task) return `Task ${taskId} not found`;

  const siblings = getChildrenOf(task.parentId);
  const myIndex = siblings.findIndex(t => t.id === taskId);
  if (myIndex <= 0) return "Cannot indent: no previous sibling to become parent";

  const newParent = siblings[myIndex - 1];

  // Summary rule: will the new parent violate summary constraints?
  const summaryError = checkSummaryRule(newParent.id);
  if (summaryError) return summaryError;

  return null;
};

/**
 * Validate an outdent operation BEFORE mutation.
 * Outdent = move task up one level to be a sibling after its current parent.
 */
export const validateOutdent = (taskId: string): string | null => {
  const task = State.findTask(taskId);
  if (!task) return `Task ${taskId} not found`;
  if (!task.parentId) return "Cannot outdent: task is at root level";

  const parent = State.findTask(task.parentId);
  if (!parent) return "Cannot outdent: parent not found";

  // No summary rule check needed for outdent:
  // - The grandparent (if any) either already is a summary or won't become one
  //   (the parent is already its child)
  // - The parent may stop being summary if this was its only child,
  //   but that's fine — it returns to a leaf

  return null;
};

/**
 * Validate a move operation BEFORE mutation.
 * Move = reparent task under newParentId, optionally after afterTaskId.
 */
export const validateMove = (taskId: string, newParentId: string | undefined | null, afterTaskId?: string): string | null => {
  const task = State.findTask(taskId);
  if (!task) return `Task ${taskId} not found`;

  const targetParentId = newParentId === null ? undefined : newParentId;

  // Cannot move under self or own descendant
  if (targetParentId) {
    if (targetParentId === taskId) return "Cannot move task under itself";
    if (isDescendant(targetParentId, taskId)) return "Cannot move task under its own descendant";

    const targetParent = State.findTask(targetParentId);
    if (!targetParent) return `Target parent ${targetParentId} not found`;

    // Summary rule
    const summaryError = checkSummaryRule(targetParentId);
    if (summaryError) return summaryError;
  }

  // Validate afterTaskId if provided
  if (afterTaskId) {
    const targetSiblings = getChildrenOf(targetParentId).filter(t => t.id !== taskId);
    if (!targetSiblings.some(t => t.id === afterTaskId)) {
      return `After-task ${afterTaskId} not found among target siblings`;
    }
  }

  return null;
};

/**
 * Validate a reorder operation BEFORE mutation.
 * Reorder = change position among siblings without changing parent.
 */
export const validateReorder = (taskId: string, afterTaskId?: string): string | null => {
  const task = State.findTask(taskId);
  if (!task) return `Task ${taskId} not found`;

  if (afterTaskId) {
    const siblings = getChildrenOf(task.parentId).filter(t => t.id !== taskId);
    if (!siblings.some(t => t.id === afterTaskId)) {
      return `After-task ${afterTaskId} not found among siblings`;
    }
  }

  return null;
};
