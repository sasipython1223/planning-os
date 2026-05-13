/**
 * @module temporalFeatureFlag
 *
 * Phase D2 — Feature flag for the temporal scheduling path.
 *
 * Controls whether the worker builds the TemporalScheduleRequest
 * payload during the scheduling pipeline. When enabled, the temporal
 * request is assembled after the slot kernel runs, but is NOT sent
 * to `run_schedule_temporal` — Phase D2 is build-only.
 *
 * Default: disabled (false). When disabled, the temporal build path
 * is completely skipped — no MinuteAnchor creation, no calendar
 * compilation, no cache lookups, no extra hot-path cost.
 *
 * Enabled for testing or future phases (D3 dual-run validation).
 */

let enableTemporalCompiler = false;

/** Check if the temporal compiler pipeline is enabled. */
export const isTemporalCompilerEnabled = (): boolean => enableTemporalCompiler;

/** Enable or disable the temporal compiler pipeline. */
export const setTemporalCompilerEnabled = (enabled: boolean): void => {
  enableTemporalCompiler = enabled;
};

/** Reset to default (disabled). Intended for tests only. */
export const _resetTemporalCompilerFlag = (): void => {
  enableTemporalCompiler = false;
};
