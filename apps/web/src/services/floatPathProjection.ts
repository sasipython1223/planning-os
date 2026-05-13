import type { FloatPathMvpResponse } from "@planner/protocol";

export type FloatPathViewFilter =
  | { mode: "off" }
  | { mode: "path"; pathId: string }
  | { mode: "topN"; count: number }
  | { mode: "nearCritical" }
  | { mode: "allReturned" };

export type FloatPathLayoutMode =
  | "originalWbs"
  | "floatPathOrder";

export type FloatPathWbsContextDepth = "none" | 1 | 2 | 3 | "full";

export type FloatPathTaskMembership = {
  pathId: string;
  floatPathNumber: number;
  floatPathOrder: number;
  sequence: number;
  isPrimaryDrivingPath: boolean;
  isNearCritical: boolean;
};

export type FloatPathProjectionRow<TTask> = {
  row: TTask;
  memberships: FloatPathTaskMembership[];
  projectionKind: "canonical" | "pathInstance";
  pathId?: string;
  sequence?: number;
};

export type FloatPathViewProjection<TTask> = {
  isActive: boolean;
  visibleTaskIds: Set<string>;
  taskMembership: Map<string, FloatPathTaskMembership[]>;
  projectedRows: TTask[];
  warnings: string[];
};

const STALE_WARNING = "Float path result is stale or unavailable. Re-run analysis to apply filter.";

function compareMembership(a: FloatPathTaskMembership, b: FloatPathTaskMembership): number {
  return (
    a.floatPathNumber - b.floatPathNumber
    || a.floatPathOrder - b.floatPathOrder
    || a.sequence - b.sequence
  );
}

function pushMembership(
  map: Map<string, FloatPathTaskMembership[]>,
  taskId: string,
  membership: FloatPathTaskMembership,
): void {
  const existing = map.get(taskId);
  if (existing) {
    existing.push(membership);
    existing.sort(compareMembership);
  } else {
    map.set(taskId, [membership]);
  }
}

function selectPaths(
  result: FloatPathMvpResponse,
  filter: Exclude<FloatPathViewFilter, { mode: "off" }>,
): FloatPathMvpResponse["paths"] {
  const sorted = [...result.paths].sort((a, b) => a.floatPathOrder - b.floatPathOrder || a.floatPathNumber - b.floatPathNumber);

  if (filter.mode === "path") {
    return sorted.filter((path) => path.pathId === filter.pathId);
  }

  if (filter.mode === "topN") {
    const count = Math.max(0, Math.floor(filter.count));
    return sorted.slice(0, count);
  }

  if (filter.mode === "nearCritical") {
    return sorted.filter((path) => path.isNearCritical);
  }

  return sorted;
}

function withAncestors<TTask extends { id: string; parentId?: string | null; depth?: number }>(
  rows: TTask[],
  includedIds: Set<string>,
  maxAncestorDepth: number | null,
): Set<string> {
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const withParents = new Set(includedIds);

  for (const id of includedIds) {
    let parentId = rowById.get(id)?.parentId ?? null;
    while (parentId) {
      const parent = rowById.get(parentId);
      if (!parent) break;
      if (maxAncestorDepth === null || parent.depth == null || parent.depth <= maxAncestorDepth) {
        withParents.add(parent.id);
      }
      parentId = parent.parentId ?? null;
    }
  }

  return withParents;
}

export function deriveFloatPathProjection<TTask extends { id: string; parentId?: string | null; isSummary?: boolean; depth?: number }>(input: {
  rows: TTask[];
  result: FloatPathMvpResponse | null;
  filter: FloatPathViewFilter;
  layout: FloatPathLayoutMode;
  stale: boolean;
  wbsContextDepth?: FloatPathWbsContextDepth;
}): FloatPathViewProjection<TTask> {
  const { rows, result, filter, layout, stale } = input;

  if (filter.mode === "off") {
    return {
      isActive: false,
      visibleTaskIds: new Set(),
      taskMembership: new Map(),
      projectedRows: rows,
      warnings: [],
    };
  }

  if (stale || !result) {
    return {
      isActive: false,
      visibleTaskIds: new Set(),
      taskMembership: new Map(),
      projectedRows: rows,
      warnings: [STALE_WARNING],
    };
  }

  const selectedPaths = selectPaths(result, filter);
  if (selectedPaths.length === 0) {
    return {
      isActive: false,
      visibleTaskIds: new Set(),
      taskMembership: new Map(),
      projectedRows: rows,
      warnings: ["No matching float paths available for the selected filter."],
    };
  }

  const visibleTaskIds = new Set<string>();
  const taskMembership = new Map<string, FloatPathTaskMembership[]>();

  for (const path of selectedPaths) {
    for (const activity of path.orderedActivities) {
      visibleTaskIds.add(activity.taskId);
      pushMembership(taskMembership, activity.taskId, {
        pathId: path.pathId,
        floatPathNumber: path.floatPathNumber,
        floatPathOrder: path.floatPathOrder,
        sequence: activity.sequence,
        isPrimaryDrivingPath: path.isPrimaryDrivingPath,
        isNearCritical: path.isNearCritical,
      });
    }
  }

  if (layout === "originalWbs") {
    const contextDepth = input.wbsContextDepth ?? "full";
    let projectedRows: TTask[];
    if (contextDepth === "none") {
      projectedRows = rows.filter((row) => visibleTaskIds.has(row.id));
    } else {
      const maxAncestorDepth = contextDepth === "full" ? null : contextDepth - 1;
      const withParentIds = withAncestors(rows, visibleTaskIds, maxAncestorDepth);
      projectedRows = rows.filter((row) => withParentIds.has(row.id));
    }

    return {
      isActive: true,
      visibleTaskIds,
      taskMembership,
      projectedRows,
      warnings: [],
    };
  }

  const originalOrder = new Map(rows.map((row, idx) => [row.id, idx]));
  const projectedRows = rows
    .filter((row) => visibleTaskIds.has(row.id))
    .slice()
    .sort((a, b) => {
      const aMembership = taskMembership.get(a.id)?.[0];
      const bMembership = taskMembership.get(b.id)?.[0];
      if (aMembership && bMembership) {
        const membershipCmp = compareMembership(aMembership, bMembership);
        if (membershipCmp !== 0) return membershipCmp;
      }
      return (originalOrder.get(a.id) ?? 0) - (originalOrder.get(b.id) ?? 0);
    });

  return {
    isActive: true,
    visibleTaskIds,
    taskMembership,
    projectedRows,
    warnings: [],
  };
}
