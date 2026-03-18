/**
 * @module mapCompiledGraph
 *
 * Compiler-to-Solver Bridge — M05
 *
 * Maps a CompiledScheduleGraph (domain compiler output) to a
 * ScheduleRequest (kernel solver input). This is the boundary
 * where domain traceability metadata is intentionally stripped,
 * keeping the kernel pure and free of domain concepts.
 *
 * ── Architecture Context ──
 * Layer 6 (Domain Compiler) → this bridge → Layer 8 (Solver Kernel)
 * The bridge sits at Layer 7 (Schedule Graph) in ARCHITECTURE_BOUNDARIES.
 *
 * ── Current State (M05 scaffolding) ──
 * The existing scheduling flow still uses buildScheduleRequest() which
 * maps from worker Task/Dependency state. This module provides the
 * parallel path from the compiled domain graph. The two paths are NOT
 * yet unified — that is a future milestone.
 *
 * ── Domain concepts dropped at this boundary ──
 * - sourceAuthoredActivityId (compiler traceability)
 * - resolvedStrategyKind (duration derivation trace)
 * - zoneId (spatial domain concept)
 * - sourceAssumptionSetId/Version (compilation provenance)
 * - compiledAt (compilation timestamp)
 *
 * These are intentionally excluded because the kernel must remain
 * a pure math engine with no knowledge of domain semantics.
 */

import type { CompiledScheduleGraph } from "protocol";
import type { ScheduleDependency, ScheduleRequest, ScheduleTask } from "protocol/kernel";

/**
 * Map a CompiledScheduleGraph to a ScheduleRequest for the solver kernel.
 *
 * Generated activities become ScheduleTasks with:
 * - duration from resolved durationDays
 * - constraint forwarded if present, defaulting to ASAP / null
 * - minEarlyStart: 0 (no hierarchy-based offset in compiled graph)
 * - isSummary: false (compiler emits leaf activities only)
 * - parentId: undefined (no hierarchy in compiled graph)
 *
 * Generated dependencies become ScheduleDependencies with field renaming.
 * Non-working days pass through unchanged.
 */
export const mapCompiledGraphToRequest = (
  graph: CompiledScheduleGraph,
): ScheduleRequest => {
  const tasks: ScheduleTask[] = graph.activities.map((activity) => ({
    id: activity.id,
    duration: activity.durationDays,
    minEarlyStart: 0,
    isSummary: false,
    constraintType: activity.constraintType ?? "ASAP",
    constraintDate: activity.constraintDate ?? null,
  }));

  const dependencies: ScheduleDependency[] = graph.dependencies.map((dep) => ({
    predId: dep.predecessorId,
    succId: dep.successorId,
    depType: dep.type,
    lag: dep.lagDays,
  }));

  return {
    tasks,
    dependencies,
    nonWorkingDays: graph.nonWorkingDays,
  };
};
