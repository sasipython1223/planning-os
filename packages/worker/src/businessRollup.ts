import type { VisibleRow, WorkMinutes } from "@planner/protocol";

/**
 * Compute business rollup fields on the full projection (pre-collapse).
 *
 * Fields computed:
 * - rollupCost: sum(child cost) for summaries, own cost for leaves
 * - rollupWorkMinutes: sum(child work) for summaries, own durationWorkMinutes for leaves
 * - rollupPercentComplete: weighted average for summaries, own value for leaves
 *
 * Percent complete weighting:
 * - weight by rollupWorkMinutes if available
 * - else weight by durationWorkMinutes if available
 * - Σ(child.pct × child.weight) / Σ(child.weight)
 *
 * Null rules:
 * - null children are skipped in aggregation
 * - if all children are null, parent stays null
 * - no coercion of null to zero
 *
 * Operates bottom-up (deepest first) — iterative, no recursion.
 * Must receive the FULL projection so collapsed descendants contribute.
 * Preserves row reference equality when business rollup values are unchanged.
 *
 * Canonical Task does NOT store cost or percentComplete today.
 * Leaves project durationWorkMinutes as rollupWorkMinutes.
 * Cost and percentComplete will be null until canonical fields are added.
 */
export function computeBusinessRollups(
  fullProjection: readonly VisibleRow[],
): VisibleRow[] {
  // Build parent → direct children
  const childrenOf = new Map<string, VisibleRow[]>();
  for (const row of fullProjection) {
    if (row.parentId) {
      const arr = childrenOf.get(row.parentId);
      if (arr) arr.push(row);
      else childrenOf.set(row.parentId, [row]);
    }
  }

  // Process deepest first
  const sorted = fullProjection.slice().sort((a, b) => b.depth - a.depth);

  const rollupValues = new Map<string, {
    cost: number | null;
    workMinutes: WorkMinutes | null;
    percentComplete: number | null;
  }>();

  for (const row of sorted) {
    if (row.isSummary) {
      const children = childrenOf.get(row.id);
      if (!children || children.length === 0) {
        rollupValues.set(row.id, { cost: null, workMinutes: null, percentComplete: null });
        continue;
      }

      // ── Cost: sum ──
      let costSum: number | null = null;
      for (const child of children) {
        const cv = rollupValues.get(child.id);
        if (cv && cv.cost !== null) {
          costSum = (costSum ?? 0) + cv.cost;
        }
      }

      // ── Work: sum ──
      let workSum: WorkMinutes | null = null;
      for (const child of children) {
        const cv = rollupValues.get(child.id);
        if (cv && cv.workMinutes !== null) {
          workSum = ((workSum ?? 0) + cv.workMinutes) as WorkMinutes;
        }
      }

      // ── Percent complete: weighted average ──
      let weightedPctSum = 0;
      let weightSum = 0;
      for (const child of children) {
        const cv = rollupValues.get(child.id);
        if (!cv || cv.percentComplete === null) continue;

        // Weight: prefer work, then durationWorkMinutes, then skip
        let weight: number;
        if (cv.workMinutes !== null) {
          weight = cv.workMinutes;
        } else if (child.durationWorkMinutes != null) {
          weight = child.durationWorkMinutes;
        } else {
          continue;
        }

        weightedPctSum += cv.percentComplete * weight;
        weightSum += weight;
      }

      const percentComplete = weightSum > 0 ? weightedPctSum / weightSum : null;

      rollupValues.set(row.id, { cost: costSum, workMinutes: workSum, percentComplete });
    } else {
      // Leaf task — project canonical fields
      // Cost: not yet on canonical Task → null
      const cost: number | null = null;
      // Work: use durationWorkMinutes as work proxy
      const workMinutes: WorkMinutes | null = row.durationWorkMinutes ?? null;
      // Percent complete: not yet on canonical Task → null
      const percentComplete: number | null = null;

      rollupValues.set(row.id, { cost, workMinutes, percentComplete });
    }
  }

  // Stamp values onto rows, preserving reference equality when unchanged
  const result: VisibleRow[] = [];
  for (const row of fullProjection) {
    const rv = rollupValues.get(row.id)!;
    if (
      row.rollupCost === rv.cost &&
      row.rollupWorkMinutes === rv.workMinutes &&
      row.rollupPercentComplete === rv.percentComplete
    ) {
      result.push(row);
    } else {
      result.push({
        ...row,
        rollupCost: rv.cost,
        rollupWorkMinutes: rv.workMinutes,
        rollupPercentComplete: rv.percentComplete,
      });
    }
  }

  return result;
}
