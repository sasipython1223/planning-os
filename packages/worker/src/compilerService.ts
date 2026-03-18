/**
 * @module compilerService
 *
 * Domain Compiler Runtime Seam — Worker Service Boundary
 *
 * Provides an isolated adapter boundary for DomainCompiler integration.
 * The worker interacts with the compiler exclusively through this module,
 * keeping the domain compilation concern decoupled from scheduling flow.
 *
 * ── Current State (M04 scaffolding) ──
 * Uses NullCompiler which returns an empty CompiledScheduleGraph.
 * The existing scheduling flow (State → buildScheduleRequest → runSchedule)
 * is NOT wired through this seam yet. Wiring is a future milestone.
 *
 * ── Future ──
 * A real compiler implementation will be injected via setCompiler().
 * The scheduling flow will be updated to:
 *   AuthoredActivities + AssumptionSet → compile() → CompiledScheduleGraph
 *   → mapToScheduleRequest() → runSchedule()
 */

import type {
    AssumptionSet,
    AuthoredActivity,
    CompiledScheduleGraph,
    DomainCompiler,
} from "protocol";

// ─── Null Compiler (Placeholder) ────────────────────────────────────

/**
 * A no-op DomainCompiler that returns an empty CompiledScheduleGraph.
 * Used as the default until a real compiler is injected.
 */
export class NullCompiler implements DomainCompiler {
  compile(
    assumptionSet: AssumptionSet,
    _authoredActivities: readonly AuthoredActivity[],
    nonWorkingDays: readonly number[],
  ): CompiledScheduleGraph {
    return {
      activities: [],
      dependencies: [],
      nonWorkingDays: [...nonWorkingDays],
      sourceAssumptionSetId: assumptionSet.id,
      sourceAssumptionSetVersion: assumptionSet.version,
      compiledAt: new Date().toISOString(),
    };
  }
}

// ─── Compiler Service ───────────────────────────────────────────────

let activeCompiler: DomainCompiler = new NullCompiler();

/**
 * Replace the active compiler implementation.
 * Called when a real compiler becomes available.
 */
export const setCompiler = (compiler: DomainCompiler): void => {
  activeCompiler = compiler;
};

/**
 * Get the current active compiler (for testing/inspection).
 */
export const getCompiler = (): DomainCompiler => activeCompiler;

/**
 * Compile domain-model inputs into a CompiledScheduleGraph
 * using the currently active compiler.
 */
export const compile = (
  assumptionSet: AssumptionSet,
  authoredActivities: readonly AuthoredActivity[],
  nonWorkingDays: readonly number[],
): CompiledScheduleGraph =>
  activeCompiler.compile(assumptionSet, authoredActivities, nonWorkingDays);

/**
 * Reset the compiler service to its default state (NullCompiler).
 * Intended for tests only.
 */
export const _resetCompilerService = (): void => {
  activeCompiler = new NullCompiler();
};
