/**
 * @module schedulingMode
 *
 * Scheduling Path Selection — M07
 *
 * Controls whether the Worker uses the legacy task-based scheduling path
 * (buildScheduleRequest) or the domain-compiled path
 * (buildCompiledScheduleRequest).
 *
 * ── Current State (M07) ──
 * Default is "legacy". The compiled path is opt-in for testing.
 * No production code activates the compiled path yet.
 *
 * ── Future ──
 * Once the real DomainCompiler is implemented and validated, the
 * default will switch to "compiled" and the legacy path will be
 * removed in a future milestone.
 */

export type SchedulingMode = "legacy" | "compiled";

let currentMode: SchedulingMode = "legacy";

/** Get the active scheduling mode. */
export const getSchedulingMode = (): SchedulingMode => currentMode;

/** Set the active scheduling mode. */
export const setSchedulingMode = (mode: SchedulingMode): void => {
  currentMode = mode;
};

/** Reset to default (legacy). Intended for tests only. */
export const _resetSchedulingMode = (): void => {
  currentMode = "legacy";
};
