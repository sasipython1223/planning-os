import type { ConstraintType, Task } from "protocol";

export type ConstraintFilter =
  | "all"
  | "constrained"
  | "unconstrained"
  | ConstraintType;

/**
 * Pure view-level filter: returns tasks matching the constraint filter.
 * "all" → pass-through. "constrained" → has non-ASAP constraint.
 * "unconstrained" → ASAP or absent. Specific type → exact match.
 */
export function filterByConstraint(
  tasks: readonly Task[],
  filter: ConstraintFilter,
): Task[] {
  if (filter === "all") return tasks as Task[];

  if (filter === "constrained") {
    return tasks.filter(
      (t) => t.constraintType != null && t.constraintType !== "ASAP",
    );
  }

  if (filter === "unconstrained") {
    return tasks.filter(
      (t) => t.constraintType == null || t.constraintType === "ASAP",
    );
  }

  // Specific constraint type
  return tasks.filter((t) => t.constraintType === filter);
}
