/**
 * @module SlotEngineAdapter
 *
 * Phases D3–D5 — Slot kernel adapter implementing ISchedulingEngine.
 *
 * Wraps the slot-based scheduling pipeline (translate inputs →
 * buildScheduleRequest → runSchedule → translate outputs) behind
 * the uniform ISchedulingEngine interface.
 *
 * This is the authoritative production engine. The worker's downstream
 * pipeline (ProjectionAdapter → rollups, variances, histogram, emit)
 * consumes the normalized facts from this adapter. The raw kernel result
 * is used only for error detection.
 *
 * Phase D4: output translation via SlotScheduleTranslator produces
 * NormalizedScheduleFacts (calendar dates + working-minute floats).
 *
 * Phase D5: input translation via SlotCoordinateTranslator converts
 * canonical WorkMinutes → day-slot primitives before building the
 * kernel request. The worker no longer knows about day-slots.
 */

import { isScheduleError } from "@planner/protocol/kernel";
import {
    recordPrimaryEngineExecDuration,
    recordPrimaryRequestBuildDuration,
} from "./CutoverReadinessGate.js";
import type { InputTranslationContext } from "./IEngineCoordinateTranslator.js";
import type { TranslationContext } from "./IScheduleTranslator.js";
import type { EngineResult, ISchedulingEngine, SchedulingStateSnapshot } from "./ISchedulingEngine.js";
import type { NormalizedScheduleFacts } from "./NormalizedScheduleFact.js";
import { SlotCoordinateTranslator } from "./SlotCoordinateTranslator.js";
import { SlotScheduleTranslator } from "./SlotScheduleTranslator.js";
import { buildScheduleRequest } from "./buildScheduleRequest.js";
import { buildCompiledScheduleRequest } from "./compiledSchedulePath.js";
import { runSchedule } from "./runSchedule.js";

// Module-level output translator instance — stateless, safe to reuse.
const slotOutputTranslator = new SlotScheduleTranslator();

/**
 * Slot engine adapter — wraps the existing slot-based scheduling path.
 *
 * Phase D5: authoritative production engine. Owns both input
 * (SlotCoordinateTranslator) and output (SlotScheduleTranslator)
 * translation. The worker passes canonical state only.
 */
export class SlotEngineAdapter implements ISchedulingEngine {
  execute(state: SchedulingStateSnapshot): EngineResult {
    // D5: construct input translator for this scheduling run
    const inputContext: InputTranslationContext = {
      projectStartDate: state.projectStartDate,
      minutesPerDay: state.temporalAdapter.minutesPerDay as number,
      nwdSet: state.nwdSet,
      projectCalendar: state.compiledProjectCalendar,
    };
    const inputTranslator = new SlotCoordinateTranslator(inputContext);

    // Build request — translator handles WorkMinutes → day-slot conversion
    const requestBuildStart = performance.now();
    const request =
      state.schedulingMode === "compiled"
        ? buildCompiledScheduleRequest(
            state.assumptionSet,
            state.authoredActivities,
            state.nonWorkingDays,
            inputTranslator,
          ).request
        : buildScheduleRequest(
            state.tasks,
            state.dependencies,
            state.nonWorkingDays,
            inputTranslator,
          );
    recordPrimaryRequestBuildDuration(performance.now() - requestBuildStart);

    // Execute slot kernel
    const engineExecStart = performance.now();
    const rawResult = runSchedule(request);
    recordPrimaryEngineExecDuration(performance.now() - engineExecStart);

    // D4: translate to normalized facts if successful
    let normalized: NormalizedScheduleFacts | null = null;
    if (!isScheduleError(rawResult)) {
      const outputContext: TranslationContext = {
        projectStartDate: state.projectStartDate,
        minutesPerDay: state.temporalAdapter.minutesPerDay as number,
      };
      normalized = slotOutputTranslator.translate(rawResult, outputContext);
    }

    return { rawResult, normalized };
  }
}
