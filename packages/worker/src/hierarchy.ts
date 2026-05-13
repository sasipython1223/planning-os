/**
 * Hierarchy module — owns collapse state, full projection, and visible-row filtering.
 *
 * Architecture:
 * - Worker owns canonical hierarchy visibility
 * - Full projection = all rows with WBS codes + rollup fields (pre-collapse)
 * - Visible rows = full projection filtered by collapse state (O(N) filter)
 * - Rollups are computed on full projection so collapsed descendants are included
 * - TOGGLE_NODE reuses cached full projection — no rollup recomputation
 * - Reference equality preserved for unchanged rows across toggles
 */

import type { Task, VisibleRow } from "@planner/protocol";
import type { CalendarResolver } from "./calendarTypes.js";

// ── Collapse State ──────────────────────────────────────────────────

let collapsedIds = new Set<string>();

export const getCollapsedIds = (): ReadonlySet<string> => collapsedIds;

export const isCollapsed = (id: string): boolean => collapsedIds.has(id);

export const toggleCollapsed = (id: string): void => {
  if (collapsedIds.has(id)) {
    collapsedIds.delete(id);
  } else {
    collapsedIds.add(id);
  }
};

export const setCollapsedIds = (ids: Set<string>): void => {
  collapsedIds = ids;
};

export const clearCollapsedIds = (): void => {
  collapsedIds = new Set();
};

// ── Row Cache (reference equality) ──────────────────────────────────
// We cache the last VisibleRow per task id. When rebuilding, if the
// underlying data hasn't changed we return the same object reference.
// This is critical for 1000+ row performance — React can skip re-rendering
// rows whose identity hasn't changed.

let rowCache = new Map<string, VisibleRow>();

// ── Cached Full Projection ──────────────────────────────────────────
// Cached between rebuilds so TOGGLE_NODE can filter without recomputing rollups.
let cachedFullProjection: VisibleRow[] = [];

/**
 * Get the cached full projection (all rows, fully rolled up).
 * Returns empty array if no projection has been built yet.
 */
export function getFullProjection(): readonly VisibleRow[] {
  return cachedFullProjection;
}

/**
 * Build the full projection from the canonical ordered task list.
 * This includes ALL rows — no collapse filtering.
 * Rollup fields are initialized to null; caller applies computeRollups() after.
 *
 * Rules:
 * - Tasks are already in WBS/topological display order from State (sorted by siblingOrder)
 * - depth and isSummary are derived from parentId relationships (not from canonical Task)
 * - Each row is enriched with hierarchy metadata (depth, isSummary, isCollapsed, canExpand, wbsCode)
 * - WBS codes are computed from parent chain + sibling index
 * - Reference equality is preserved for unchanged rows
 *
 * Phase C: when a resolver is provided, stamps assignedCalendarId,
 * computationalCalendarId, and calendarWarnings on each row.
 */
export function buildFullProjection(tasks: readonly Task[], resolver?: CalendarResolver): VisibleRow[] {
  const result: VisibleRow[] = [];
  const newCache = new Map<string, VisibleRow>();

  // Pre-compute depth and summary classification from canonical task markers + parent relationships
  // Tasks are in WBS order (parent before children), so single-pass depth derivation works
  const depthOf = new Map<string, number>();
  const summaryIds = new Set<string>();
  for (const task of tasks) {
    depthOf.set(task.id, task.parentId ? (depthOf.get(task.parentId) ?? 0) + 1 : 0);
    if (task.parentId) summaryIds.add(task.parentId);
    if (task.isStructuralSummary === true) summaryIds.add(task.id);
  }

  // Build sibling counters for WBS code generation
  // parentId → count of children seen so far (1-based)
  const siblingCounter = new Map<string | undefined, number>();
  // taskId → its WBS code
  const wbsCodes = new Map<string, string>();

  for (const task of tasks) {
    // Compute WBS code
    const parentKey = task.parentId ?? undefined;
    const count = (siblingCounter.get(parentKey) ?? 0) + 1;
    siblingCounter.set(parentKey, count);

    const parentCode = task.parentId ? wbsCodes.get(task.parentId) : undefined;
    const wbsCode = parentCode ? `${parentCode}.${count}` : `${count}`;
    wbsCodes.set(task.id, wbsCode);

    const depth = depthOf.get(task.id) ?? 0;
    const isSummary = summaryIds.has(task.id);
    const taskIsCollapsed = collapsedIds.has(task.id);
    const canExpand = isSummary;

    // Phase C: resolve calendar identities via the resolver seam
    const assignedCalId = resolver ? resolver.resolveAssignedCalendar(task.id) : undefined;
    const computationalCalId = resolver ? resolver.resolveComputationalCalendar(task.id) : undefined;
    const calWarnings: readonly string[] | undefined =
      assignedCalId && computationalCalId && assignedCalId !== computationalCalId
        ? ["CALENDAR_DIVERGENCE"]
        : undefined;

    // Check if we can reuse the cached row object (reference equality)
    const cached = rowCache.get(task.id);
    let row: VisibleRow;

    if (
      cached &&
      cached.name === task.name &&
      cached.durationWorkMinutes === task.durationWorkMinutes &&
      cached.minEarlyStartMinutes === task.minEarlyStartMinutes &&
      cached.parentId === task.parentId &&
      cached.siblingOrder === task.siblingOrder &&
      cached.depth === depth &&
      cached.isSummary === isSummary &&
      cached.isStructuralSummary === task.isStructuralSummary &&
      cached.constraintType === task.constraintType &&
      cached.constraintDateMinutes === task.constraintDateMinutes &&
      cached.isCollapsed === taskIsCollapsed &&
      cached.canExpand === canExpand &&
      cached.wbsCode === wbsCode &&
      cached.assignedCalendarId === task.assignedCalendarId &&
      cached.computationalCalendarId === computationalCalId &&
      cached.calendarWarnings?.length === calWarnings?.length
    ) {
      row = cached;
    } else {
      row = {
        ...task,
        depth,
        isSummary,
        isCollapsed: taskIsCollapsed,
        canExpand,
        wbsCode,
        rollupStartMinutes: null,
        rollupFinishMinutes: null,
        rollupDurationMinutes: null,
        rollupCost: null,
        rollupWorkMinutes: null,
        rollupPercentComplete: null,
        assignedCalendarId: task.assignedCalendarId,
        computationalCalendarId: computationalCalId,
        calendarWarnings: calWarnings,
      };
    }

    newCache.set(task.id, row);
    result.push(row);
  }

  rowCache = newCache;
  cachedFullProjection = result;
  return result;
}

/**
 * Replace the cached full projection (e.g. after computeRollups stamps values).
 * Also updates the rowCache so subsequent filterVisibleRows calls preserve
 * reference equality for rows whose rollup values didn't change.
 */
export function setFullProjection(projection: VisibleRow[]): void {
  cachedFullProjection = projection;
  // Rebuild rowCache from the new projection so rollup-stamped rows are cached
  const newCache = new Map<string, VisibleRow>();
  for (const row of projection) {
    newCache.set(row.id, row);
  }
  rowCache = newCache;
}

/**
 * Filter the full projection to only visible rows (collapse-aware).
 * O(N) scan — no rollup recomputation.
 *
 * Reads live collapse state from collapsedIds.
 * If a row's isCollapsed flag is stale (e.g. after TOGGLE_NODE),
 * produces a new object with the corrected flag (preserves other fields).
 * Otherwise reuses the original row reference.
 */
export function filterVisibleRows(fullProjection: readonly VisibleRow[]): VisibleRow[] {
  const result: VisibleRow[] = [];
  const hiddenParents = new Set<string>();

  for (const row of fullProjection) {
    // Skip descendants of collapsed nodes
    if (row.parentId && hiddenParents.has(row.parentId)) {
      hiddenParents.add(row.id);
      continue;
    }

    // Ensure isCollapsed matches live state
    const liveCollapsed = collapsedIds.has(row.id);
    const outputRow = row.isCollapsed === liveCollapsed
      ? row
      : { ...row, isCollapsed: liveCollapsed };

    result.push(outputRow);

    // If collapsed summary, mark children for skipping
    if (liveCollapsed && row.isSummary) {
      hiddenParents.add(row.id);
    }
  }

  return result;
}

/**
 * Compute the anchor index in the new visible rows after a toggle.
 *
 * If the anchorTaskId is still visible, return its new index.
 * If it was hidden (collapsed parent absorbed it), walk up to find
 * the closest visible ancestor and return that index.
 */
export function computeAnchorIndex(
  visibleRows: readonly VisibleRow[],
  anchorTaskId: string | undefined,
  tasks: readonly Task[],
): number {
  if (!anchorTaskId) return 0;

  // Fast path: anchor is still visible
  const directIndex = visibleRows.findIndex(r => r.id === anchorTaskId);
  if (directIndex >= 0) return directIndex;

  // Anchor was hidden — walk up parent chain to find visible ancestor
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  let current = taskMap.get(anchorTaskId);
  while (current?.parentId) {
    const parentIndex = visibleRows.findIndex(r => r.id === current!.parentId);
    if (parentIndex >= 0) return parentIndex;
    current = taskMap.get(current.parentId);
  }

  // Fallback: clamp to last row
  return Math.max(0, visibleRows.length - 1);
}

/** Reset hierarchy cache (e.g. on import). */
export const resetCache = (): void => {
  rowCache = new Map();
};
