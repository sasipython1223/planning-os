/**
 * @module compiledSchedulePath
 *
 * Controlled Compiler Invocation Path — M06
 *
 * Composes the domain compiler pipeline into a single callable path:
 *   compile(assumptionSet, authoredActivities, nonWorkingDays)
 *     → CompiledScheduleGraph
 *     → mapCompiledGraphToRequest()
 *     → ScheduleRequest
 *
 * This is an internal Worker-side helper that proves the full
 * compile → map → solver-request preparation works end-to-end.
 *
 * ── Current State (M06 scaffolding) ──
 * This path is internal and optional. The existing scheduling flow
 * (State → buildScheduleRequest → runSchedule) remains the primary
 * production path.
 *
 * ── Future ──
 * When the real DomainCompiler is implemented and wired in, this
 * function (or its successor) will replace buildScheduleRequest
 * as the sole entry point into the solver.
 */

import type { AssumptionSet, AuthoredActivity } from "@planner/protocol";
import type { ScheduleRequest } from "@planner/protocol/kernel";
import { compile } from "../compilerService.js";
import type { IEngineCoordinateTranslator } from "./IEngineCoordinateTranslator.js";
import { mapCompiledGraphToRequest } from "./mapCompiledGraph.js";

/**
 * Execute the full domain-compiled scheduling pipeline:
 * compile → map → ScheduleRequest.
 *
 * Phase D6a: accepts a translator so that the compiled path uses the
 * same input translation seam as the legacy buildScheduleRequest path.
 * The translator is constructed by the engine adapter per scheduling run.
 *
 * Returns both the ScheduleRequest (for solver consumption) and the
 * intermediate CompiledScheduleGraph (for traceability / diagnostics).
 *
 * This function does NOT call the solver. The caller decides whether
 * to pass the returned request to runSchedule().
 */
export const buildCompiledScheduleRequest = (
  assumptionSet: AssumptionSet,
  authoredActivities: readonly AuthoredActivity[],
  nonWorkingDays: readonly number[],
  translator: IEngineCoordinateTranslator,
): { request: ScheduleRequest; compiledAt: string } => {
  const graph = compile(assumptionSet, authoredActivities, nonWorkingDays);
  const request = mapCompiledGraphToRequest(graph, translator);
  return { request, compiledAt: graph.compiledAt };
};
