/**
 * @module ShadowEngineFacade
 *
 * Phase D3 — Dual-run scheduling facade.
 *
 * Composes a primary (slot) engine and a shadow (temporal) engine behind
 * a single ISchedulingEngine interface. The worker calls only the facade
 * and does not know two engines exist.
 *
 * Flow:
 *   1. Execute the primary (slot) engine synchronously.
 *   2. Return the slot result immediately to the caller.
 *   3. If the shadow flag is enabled, schedule the temporal engine
 *      asynchronously via setTimeout(0) so it does NOT block the
 *      main scheduling path or UI updates.
 *   4. When the temporal engine completes, compare results and log
 *      any mismatches via console.warn.
 *
 * Invariants:
 *   - The returned EngineResult is ALWAYS from the slot engine.
 *   - The temporal engine's result never flows into projection,
 *     persistence, or UI.
 *   - The temporal engine never mutates worker state.
 *   - If the temporal engine throws, the error is logged and swallowed.
 *
 * Phase D3: shadow mode is disabled by default (flag = false).
 * The slot kernel remains the sole authoritative scheduling path.
 */

import {
    recordMismatchCategories,
    recordPrimaryDuration,
    recordShadowComparisonReport,
    recordShadowDuration,
    recordShadowFailure,
} from "./CutoverReadinessGate.js";
import type { EngineResult, ISchedulingEngine, SchedulingStateSnapshot } from "./ISchedulingEngine.js";
import { summarizeMismatchCategories } from "./ParityPolicy.js";
import type { CompareSchedulesOptions, ComparisonResult } from "./ScheduleComparator.js";
import { compareSchedules } from "./ScheduleComparator.js";
import { isShadowEngineEnabled } from "./shadowEngineFlag.js";

/**
 * Dual-run scheduling facade.
 *
 * The worker interacts exclusively with this facade. It delegates to
 * the slot adapter for the authoritative result and optionally runs
 * the temporal adapter in shadow for comparison.
 */
export class ShadowEngineFacade implements ISchedulingEngine {
  constructor(
    private readonly primary: ISchedulingEngine,
    private readonly shadow: ISchedulingEngine,
  ) {}

  /**
   * Execute the primary engine and return its result.
   *
   * If the shadow flag is enabled, the temporal engine runs asynchronously
   * after the primary result is returned. Mismatches are logged but never
   * affect the returned result.
   */
  execute(state: SchedulingStateSnapshot): EngineResult {
    // 1. Run primary (slot) engine — synchronous, authoritative
    const primaryStart = performance.now();
    const primaryResult = this.primary.execute(state);
    recordPrimaryDuration(performance.now() - primaryStart);

    // 2. If shadow is enabled, schedule async temporal run
    if (isShadowEngineEnabled()) {
      // Capture references for the async callback. The snapshot's array
      // and object fields are already captured by value at creation time
      // in the worker, so they won't change. Note: findTask is a closure
      // over mutable State, but it is read synchronously inside the
      // temporal adapter's execute(), which runs inside this callback,
      // so the window for inconsistency is negligible. If State mutates
      // between now and the setTimeout fire, findTask may return stale
      // results — acceptable for diagnostic-only shadow comparison.
      const snapshotForShadow = state;
      const primaryNormalized = primaryResult.normalized;
      const snapshotTasks = Array.isArray((snapshotForShadow as Partial<SchedulingStateSnapshot>).tasks)
        ? (snapshotForShadow as Partial<SchedulingStateSnapshot>).tasks!
        : [];
      const projectCalendarId = (snapshotForShadow as Partial<SchedulingStateSnapshot>).projectCalendar?.id;
      const expectedTaskCalendarDivergenceTaskIds = new Set(
        snapshotTasks
          .filter((task) => {
            if (!task.assignedCalendarId) return false;
            return String(task.assignedCalendarId) !== String(projectCalendarId ?? "");
          })
          .map((task) => task.id),
      );
      const comparisonOptions: CompareSchedulesOptions = {
        expectedTaskCalendarDivergenceTaskIds,
      };

      setTimeout(() => {
        try {
          const shadowStart = performance.now();
          const shadowResult = this.shadow.execute(snapshotForShadow);
          recordShadowDuration(performance.now() - shadowStart);

          if (primaryNormalized && shadowResult.normalized) {
            const comparison = compareSchedules(
              primaryNormalized,
              shadowResult.normalized,
              comparisonOptions,
            );
            recordShadowComparisonReport(comparison.readinessReport);
            this.logComparison(comparison);
          } else if (!shadowResult.normalized) {
            console.warn("[D3 Shadow] Temporal engine did not produce a normalized result.");
          }
        } catch (err) {
          // Shadow engine failure must never affect the primary path
          recordShadowFailure();
          console.warn("[D3 Shadow] Temporal engine failed:", err);
        }
      }, 0);
    }

    // 3. Return primary result immediately — temporal never blocks
    return primaryResult;
  }

  /**
   * Log comparison results. Only fires when shadow is enabled and
   * both engines produced normalized results.
   */
  private logComparison(comparison: ComparisonResult): void {
    const { mismatches, missingInTemporal, missingInSlot, readinessReport } = comparison;

    console.log("[W5B-B1.1 Shadow Readiness]", {
      tasksCompared: readinessReport.tasksCompared,
      tasksWithStartVariance: readinessReport.tasksWithStartVariance,
      tasksWithFinishVariance: readinessReport.tasksWithFinishVariance,
      tasksWithFloatVariance: readinessReport.tasksWithFloatVariance,
      maxStartVarianceMs: readinessReport.maxStartVarianceMs,
      maxFinishVarianceMs: readinessReport.maxFinishVarianceMs,
      taskCalendarDifferencesExpected: readinessReport.taskCalendarDifferencesExpected,
      divergencesDueToPerTaskCalendar: readinessReport.divergencesDueToPerTaskCalendar,
      expectedDivergenceTaskIds: readinessReport.expectedDivergenceTaskIds,
      unexplainedDivergenceTaskIds: readinessReport.unexplainedDivergenceTaskIds,
      singleCalendarParity: readinessReport.singleCalendarParity,
    });

    if (mismatches.length === 0 && missingInTemporal.length === 0 && missingInSlot.length === 0) {
      console.log("[D3 Shadow] ✓ Slot and temporal engines agree.");
      return;
    }

    if (readinessReport.divergencesDueToPerTaskCalendar) {
      console.warn(
        "[W5B-B1.1 Shadow Classification] Divergences classified as expected per-task calendar behavior.",
      );
    }
    if (readinessReport.hasUnexplainedDivergences) {
      console.warn(
        "[W5B-B1.1 Shadow Classification] Unexplained divergences detected.",
        readinessReport.unexplainedDivergenceTaskIds,
      );
    }

    if (mismatches.length > 0) {
      const categorySummary = summarizeMismatchCategories(mismatches);
      recordMismatchCategories(categorySummary);
      console.warn(`[D3 Shadow] ${mismatches.length} field mismatch(es):`);
      console.warn("[D8j Policy] mismatch categories:", categorySummary);
      for (const m of mismatches.slice(0, 20)) {
        console.warn(
          `  task=${m.taskId} field=${m.field} slot=${m.slotValue} temporal=${m.temporalValue}`,
        );
      }
      if (mismatches.length > 20) {
        console.warn(`  ... and ${mismatches.length - 20} more`);
      }
    }

    if (missingInTemporal.length > 0) {
      console.warn(`[D3 Shadow] ${missingInTemporal.length} task(s) in slot but not temporal:`, missingInTemporal);
    }

    if (missingInSlot.length > 0) {
      console.warn(`[D3 Shadow] ${missingInSlot.length} task(s) in temporal but not slot:`, missingInSlot);
    }
  }
}
