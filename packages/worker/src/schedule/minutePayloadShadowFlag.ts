/**
 * D7a flag for minute-payload shadow preparation.
 *
 * Default: disabled. When enabled, worker prepares a minute payload draft
 * through MinuteEngineAdapter for diagnostics/tests only.
 * It does NOT change authoritative scheduling.
 */

let enableMinutePayloadShadow = false;

export const isMinutePayloadShadowEnabled = (): boolean => enableMinutePayloadShadow;

export const setMinutePayloadShadowEnabled = (enabled: boolean): void => {
  enableMinutePayloadShadow = enabled;
};

export const _resetMinutePayloadShadowFlag = (): void => {
  enableMinutePayloadShadow = false;
};
