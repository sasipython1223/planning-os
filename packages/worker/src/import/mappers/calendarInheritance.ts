/**
 * @module calendarInheritance
 *
 * Calendar Inheritance Resolver — W3C
 *
 * Resolves parent/base calendar relationships in imported calendar definitions,
 * producing a flattened/merged set of calendar definitions where child calendars
 * inherit from their parents.
 *
 * Pure function — no state mutation, no side effects.
 *
 * ⚠️ SCHEDULING-NEUTRAL — output is sidecar data only.
 * Nothing here is read by the CPM kernel or scheduling pipeline.
 *
 * Merge rules:
 * - Child weekday explicitly defined → child overrides parent for that day.
 * - Child weekday absent → parent weekday is inherited.
 * - Exceptions: union of parent + child; child wins on same date.
 * - If parent is missing from defs: emit UNRESOLVED_BASE_CALENDAR, use child as-is.
 * - If circular reference detected: emit CALENDAR_INHERITANCE_LOOP, use child as-is.
 * - Resolved definition preserves child identity (id, name, parentCalendarId).
 */

import type {
    BaseCalendarDefinition,
    CalendarDateException,
    CalendarId,
    DayOfWeek,
    ImportDiagnostic,
    TimeInterval,
    WeeklyWorkPattern,
} from "@planner/protocol";

// ─── Types ──────────────────────────────────────────────────────────

export type CalendarResolutionResult = {
  /**
   * Resolved (flattened) calendar definitions.
   * For calendars without parents, same as source (but identity preserved).
   * For calendars with parents, weeklyPattern and exceptions are merged.
   * Source definitions (with parentCalendarId lineage) are preserved separately.
   */
  readonly resolvedDefinitions: Readonly<Record<CalendarId, BaseCalendarDefinition>>;
  readonly diagnostics: ImportDiagnostic[];
  readonly unresolvedCount: number;
  readonly resolvedCount: number;
};

// ─── Exception Merge ────────────────────────────────────────────────

/**
 * Merge parent and child exceptions.
 * Child exceptions on the same date override parent exceptions.
 * Parent exceptions on dates not in child are included.
 */
function mergeExceptions(
  parentExceptions: readonly CalendarDateException[],
  childExceptions: readonly CalendarDateException[],
): readonly CalendarDateException[] {
  const childDates = new Set(childExceptions.map(e => e.date));
  const inherited = parentExceptions.filter(e => !childDates.has(e.date));
  return [...inherited, ...childExceptions];
}

// ─── Weekly Pattern Merge ────────────────────────────────────────────

/**
 * Merge parent and child weekly patterns.
 * For each day of week (0–6):
 *   - If child has explicit intervals for that day → use child.
 *   - If child does not have that day → use parent's value (if any).
 *
 * "Explicit" means the key is present in child weeklyPattern.
 * A missing key = not defined (inherited). An empty array would be valid but unusual.
 */
function mergeWeeklyPatterns(
  parent: WeeklyWorkPattern,
  child: WeeklyWorkPattern,
): WeeklyWorkPattern {
  const merged: Record<number, readonly TimeInterval[]> = {};

  // Include all days from parent first
  for (const dayStr of Object.keys(parent)) {
    const day = parseInt(dayStr, 10) as DayOfWeek;
    const parentIntervals = parent[day];
    if (parentIntervals !== undefined) {
      merged[day] = parentIntervals;
    }
  }

  // Child overrides parent for any explicitly defined days
  for (const dayStr of Object.keys(child)) {
    const day = parseInt(dayStr, 10) as DayOfWeek;
    const childIntervals = child[day];
    if (childIntervals !== undefined) {
      merged[day] = childIntervals;
    }
  }

  return merged as WeeklyWorkPattern;
}

// ─── Chain Resolver ─────────────────────────────────────────────────

/**
 * Walk the parent chain for a calendar, collecting the ordered list of
 * ancestor IDs from root to immediate parent (not including the child itself).
 *
 * Returns null if a circular reference is detected.
 * Returns an empty array if there is no parent.
 */
function resolveAncestorChain(
  calId: CalendarId,
  defs: Readonly<Record<CalendarId, BaseCalendarDefinition>>,
): CalendarId[] | null {
  const chain: CalendarId[] = [];
  const visited = new Set<CalendarId>();
  visited.add(calId);

  let current = defs[calId];
  while (current?.parentCalendarId !== undefined) {
    const parentId = current.parentCalendarId;
    if (visited.has(parentId)) {
      // Circular reference detected
      return null;
    }
    visited.add(parentId);
    chain.push(parentId);
    current = defs[parentId];
  }

  // chain is in order: immediate parent, grandparent, ...
  // Reverse to get root-first order for merging
  return chain.reverse();
}

// ─── Main Resolver ───────────────────────────────────────────────────

/**
 * Resolve calendar inheritance for all calendars in the given definitions.
 *
 * For each calendar that has a parentCalendarId:
 * 1. Walk the ancestor chain.
 * 2. Detect and report circular references.
 * 3. Report missing parents.
 * 4. Merge ancestor patterns from root to child (child overrides parent).
 *
 * Returns resolved definitions + diagnostics + summary counts.
 * Source definitions are NOT mutated — resolved copies are returned separately.
 */
export function resolveCalendarInheritance(
  defs: Readonly<Record<CalendarId, BaseCalendarDefinition>>,
): CalendarResolutionResult {
  const diagnostics: ImportDiagnostic[] = [];
  const resolvedDefinitions: Record<CalendarId, BaseCalendarDefinition> = {} as Record<CalendarId, BaseCalendarDefinition>;
  let unresolvedCount = 0;
  let resolvedCount = 0;

  for (const calId of Object.keys(defs) as CalendarId[]) {
    const cal = defs[calId];
    if (!cal) continue;

    // No parent — resolved definition is the same as source
    if (cal.parentCalendarId === undefined) {
      resolvedDefinitions[calId] = cal;
      continue;
    }

    // Check if parent exists
    if (defs[cal.parentCalendarId] === undefined) {
      // Parent missing — already diagnosed in W3B (UNRESOLVED_BASE_CALENDAR)
      // Emit additional resolution-time diagnostic for context
      diagnostics.push({
        code: "UNRESOLVED_BASE_CALENDAR",
        severity: "info",
        message: `Calendar "${cal.name}" (ID: ${calId}) could not resolve parent "${cal.parentCalendarId}" — using child definition as-is`,
        sourceEntityId: calId as string,
        field: "parentCalendarId",
        originalValue: cal.parentCalendarId as string,
      });
      resolvedDefinitions[calId] = cal; // preserve as-is
      unresolvedCount++;
      continue;
    }

    // Walk ancestor chain — detect circular references
    const ancestorChain = resolveAncestorChain(calId, defs);
    if (ancestorChain === null) {
      diagnostics.push({
        code: "CALENDAR_INHERITANCE_LOOP",
        severity: "warning",
        message: `Calendar "${cal.name}" (ID: ${calId}) has a circular inheritance chain — using child definition as-is`,
        sourceEntityId: calId as string,
        field: "parentCalendarId",
      });
      resolvedDefinitions[calId] = cal; // preserve as-is
      unresolvedCount++;
      continue;
    }

    // Merge from root ancestor down to immediate parent, then apply child
    let mergedPattern: WeeklyWorkPattern = {};
    let mergedExceptions: readonly CalendarDateException[] = [];

    for (const ancestorId of ancestorChain) {
      const ancestor = defs[ancestorId];
      if (!ancestor) break; // missing ancestor mid-chain — stop merging
      mergedPattern = mergeWeeklyPatterns(mergedPattern, ancestor.weeklyPattern);
      mergedExceptions = mergeExceptions(mergedExceptions, ancestor.exceptions);
    }

    // Apply child on top
    mergedPattern = mergeWeeklyPatterns(mergedPattern, cal.weeklyPattern);
    mergedExceptions = mergeExceptions(mergedExceptions, cal.exceptions);

    resolvedDefinitions[calId] = {
      id: calId,
      name: cal.name,
      weeklyPattern: mergedPattern,
      exceptions: mergedExceptions,
      parentCalendarId: cal.parentCalendarId, // preserve lineage
    };
    resolvedCount++;
  }

  return {
    resolvedDefinitions: resolvedDefinitions as Readonly<Record<CalendarId, BaseCalendarDefinition>>,
    diagnostics,
    unresolvedCount,
    resolvedCount,
  };
}
