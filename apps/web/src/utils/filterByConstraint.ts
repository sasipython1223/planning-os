import type { ConstraintType, Task } from "@planner/protocol";

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
export function filterByConstraint<T extends Task>(
  tasks: readonly T[],
  filter: ConstraintFilter,
): T[] {
  if (filter === "all") return tasks as T[];

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
