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

import type { CompiledScheduleGraph, WorkMinutes } from "@planner/protocol";
import type { ScheduleDependency, ScheduleRequest, ScheduleTask } from "@planner/protocol/kernel";
import { ENGINE_ABI_VERSION } from "@planner/protocol/kernel";
import type { IEngineCoordinateTranslator } from "./IEngineCoordinateTranslator.js";

/**
 * Map a CompiledScheduleGraph to a ScheduleRequest for the solver kernel.
 *
 * Phase D6a: coordinate conversion is delegated to the translator,
 * matching the same seam used by buildScheduleRequest. The compiled
 * path no longer has its own standalone toDaySlots conversion.
 *
 * Generated activities become ScheduleTasks with:
 * - duration converted via translator
 * - constraint converted via translator (with snapping)
 * - minEarlyStart: 0 (no hierarchy-based offset in compiled graph)
 * - isSummary: false (compiler emits leaf activities only)
 * - parentId: undefined (no hierarchy in compiled graph)
 *
 * Generated dependencies become ScheduleDependencies with field renaming.
 * Non-working days pass through unchanged.
 */
export const mapCompiledGraphToRequest = (
  graph: CompiledScheduleGraph,
  translator: IEngineCoordinateTranslator,
): ScheduleRequest => {
  const tasks: ScheduleTask[] = graph.activities.map((activity) => ({
    id: activity.id,
    durationWorkMinutes: translator.convertDuration(activity.durationWorkMinutes) as WorkMinutes,
    minEarlyStartMinutes: 0 as WorkMinutes,
    isSummary: false,
    constraintType: activity.constraintType ?? "ASAP",
    constraintDateMinutes: activity.constraintDateMinutes != null
      ? translator.convertConstraintDate(activity.constraintDateMinutes, activity.constraintType) as WorkMinutes
      : null,
  }));

  const dependencies: ScheduleDependency[] = graph.dependencies.map((dep) => ({
    predId: dep.predecessorId,
    succId: dep.successorId,
    depType: dep.type,
    lagWorkMinutes: translator.convertLag(dep.lagWorkMinutes) as WorkMinutes,
  }));

  return {
    abiVersion: ENGINE_ABI_VERSION,
    tasks,
    dependencies,
    nonWorkingDays: graph.nonWorkingDays,
  };
};
