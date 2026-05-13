/**
 * @module shadowEngineFlag
 *
 * Phase D3 — Feature flag for the shadow dual-run engine.
 *
 * Controls whether the ShadowEngineFacade runs the temporal engine
 * in shadow mode after the slot engine produces the authoritative result.
 *
 * Default: disabled (false). When disabled, only the slot engine runs —
 * no temporal build, no temporal execution, no comparison. Zero extra
 * hot-path cost.
 *
 * When enabled, the temporal engine runs asynchronously via setTimeout(0)
 * AFTER the slot result has been returned to the worker. The temporal
 * result is compared with the slot result and mismatches are logged
 * via console.warn. No state mutation, no UI change.
 *
 * This flag supersedes the D2 ENABLE_TEMPORAL_COMPILER flag. The D2
 * flag module (temporalFeatureFlag.ts) is now dead code — it is no
 * longer imported by worker.ts. Only this D3 flag controls whether
 * the temporal engine executes.
 *
 * When shadow engine is enabled, the temporal request is built and
 * executed. When disabled, neither build nor execution occurs.
 */

let enableShadowEngine = false;

/** Check if the shadow dual-run engine is enabled. */
export const isShadowEngineEnabled = (): boolean => enableShadowEngine;

/** Enable or disable the shadow dual-run engine. */
export const setShadowEngineEnabled = (enabled: boolean): void => {
  enableShadowEngine = enabled;
};

/** Reset to default (disabled). Intended for tests only. */
export const _resetShadowEngineFlag = (): void => {
  enableShadowEngine = false;
};
