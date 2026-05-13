/**
 * @module TemporalCoordinateTranslator
 *
 * Phase D5 — Translates canonical WorkMinutes for the temporal kernel.
 *
 * The temporal kernel operates in working-minute offsets from the
 * MinuteAnchor epoch (which equals project start in the current model).
 * Since canonical state already stores WorkMinutes, this translator is
 * currently an identity passthrough — no arithmetic is performed.
 *
 * This is NOT the final temporal input model. When canonical state
 * evolves to store ISO dates or day-based durations, this translator
 * will use MinuteAnchor for date → minute conversion and minutesPerDay
 * for duration scaling. The interface is established now so that
 * evolution can happen without touching the adapter or worker.
 *
 * D5: shadow engine only. The temporal translator is used by
 * TemporalEngineAdapter which is invoked only through
 * ShadowEngineFacade. Temporal results never enter projection,
 * persistence, or UI.
 */

import type { ConstraintType, WorkMinutes } from "@planner/protocol";
import type {
    IEngineCoordinateTranslator,
    InputTranslationContext,
} from "./IEngineCoordinateTranslator.js";

/**
 * Temporal kernel coordinate translator.
 *
 * D5: identity passthrough — canonical WorkMinutes are already in the
 * temporal kernel's native coordinate space (working-minute offsets).
 *
 * Constructed per scheduling run by TemporalEngineAdapter. The
 * InputTranslationContext is accepted for interface symmetry; it will
 * be consumed when canonical state moves away from WorkMinutes.
 */
export class TemporalCoordinateTranslator
  implements IEngineCoordinateTranslator
{
  // D5: context stored for future use when identity passthrough ends.
  constructor(_context: InputTranslationContext) {}

  convertDuration(wm: WorkMinutes): number {
    return wm as number;
  }

  convertConstraintDate(
    wm: WorkMinutes,
    _constraintType?: ConstraintType,
  ): number {
    // D5: temporal kernel handles constraint semantics internally.
    // No NWD snapping — the kernel uses compiled calendar intervals.
    return wm as number;
  }

  convertLag(wm: WorkMinutes): number {
    return wm as number;
  }

  convertMinEarlyStart(wm: WorkMinutes): number {
    return wm as number;
  }
}
