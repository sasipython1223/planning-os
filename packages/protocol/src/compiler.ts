/**
 * @module compiler
 *
 * Domain Compiler Contract — Protocol Definition
 *
 * The DomainCompiler transforms the parametric domain model
 * (AssumptionSet + AuthoredActivities) into a CompiledScheduleGraph
 * that can be mapped to a solver ScheduleRequest.
 *
 * ⚠️ CONTRACT FILE — No compilation logic belongs here.
 * Implementation of the compiler is a future milestone.
 * This file defines only the interface and output shape.
 */

import type {
    AuthoredActivity,
    GeneratedActivity,
    GeneratedDependency,
} from "./activities.js";
import type { AssumptionSet, DomainEntityId } from "./domain.js";

// ─── Compiled Schedule Graph ────────────────────────────────────────

/**
 * The compiled schedule graph produced by the DomainCompiler.
 *
 * Contains all the information needed to construct a solver ScheduleRequest,
 * plus traceability metadata linking back to the domain model.
 *
 * The worker boundary is responsible for mapping this to a ScheduleRequest
 * (as defined in kernel.ts). This type must not reference kernel types directly
 * to keep the domain layer independent of solver internals.
 */
export type CompiledScheduleGraph = {
  /** Generated activities with resolved durations. */
  readonly activities: readonly GeneratedActivity[];
  /** Resolved dependency links between generated activities. */
  readonly dependencies: readonly GeneratedDependency[];
  /** Non-working day offsets from project start. */
  readonly nonWorkingDays: readonly number[];
  /** ID of the AssumptionSet this graph was compiled from. */
  readonly sourceAssumptionSetId: DomainEntityId;
  /** Version of the AssumptionSet at compilation time. */
  readonly sourceAssumptionSetVersion: number;
  /** ISO 8601 timestamp of when compilation occurred. */
  readonly compiledAt: string;
};

// ─── Domain Compiler Interface ──────────────────────────────────────

/**
 * The DomainCompiler interface.
 *
 * Accepts domain-model inputs (AssumptionSet + AuthoredActivities)
 * and returns a CompiledScheduleGraph suitable for the solver boundary.
 *
 * Implementations must:
 * - Resolve all DurationStrategy variants into concrete durations
 * - Validate zone/quantity/resource references
 * - Produce deterministic output for identical inputs
 *
 * Implementations must NOT:
 * - Perform CPM calculations
 * - Call the WASM solver
 * - Mutate input data
 */
export interface DomainCompiler {
  /**
   * Compile domain-model inputs into a solver-ready schedule graph.
   *
   * @param assumptionSet - The versioned set of project assumptions.
   * @param authoredActivities - Human-authored activities referencing domain entities.
   * @param nonWorkingDays - Day-offsets from project start that are non-working.
   * @returns A CompiledScheduleGraph with resolved durations and dependencies.
   */
  compile(
    assumptionSet: AssumptionSet,
    authoredActivities: readonly AuthoredActivity[],
    nonWorkingDays: readonly number[],
  ): CompiledScheduleGraph;
}
