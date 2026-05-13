/**
 * @module temporal
 *
 * Phase D2 — Temporal scheduling pipeline barrel export.
 *
 * Re-exports all temporal modules for convenient import from the
 * worker scheduling pipeline. Phase D2 is build-only: the temporal
 * request is assembled but never sent to the WASM kernel.
 */

export { createMinuteAnchor, dateToMinute, dayOffsetToMinute, minuteToDate } from "./minuteAnchor.js";
export type { MinuteAnchor } from "./minuteAnchor.js";

export { CalendarCompilerCache, compileCalendar } from "./calendarCompiler.js";
export type { WorkingInterval } from "./calendarCompiler.js";

export { _resetTemporalCompilerFlag, isTemporalCompilerEnabled, setTemporalCompilerEnabled } from "./temporalFeatureFlag.js";

export { _resetCompilerCache, buildTemporalRequest } from "./temporalRequestBuilder.js";
export type { TemporalCalendar, TemporalRelationInput, TemporalScheduleRequest, TemporalStateReader, TemporalTaskInput } from "./temporalRequestBuilder.js";

