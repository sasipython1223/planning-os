/**
 * @module ProjectionAdapter
 *
 * Phase D4 — Converts NormalizedScheduleFacts into ScheduleResultMap.
 *
 * This is the projection seam: the worker no longer converts raw
 * engine coordinates itself. Instead, engine adapters produce facts
 * (via translators), and this adapter converts those facts into the
 * ScheduleResultMap shape that the existing downstream pipeline
 * (rollupSummaries, computeRollups, computeVariances,
 * computeResourceHistogram, DIFF_STATE emit) already consumes.
 *
 * The ScheduleResultMap values are in the same day-offset coordinate
 * space as before D4 — downstream consumers are unchanged.
 *
 * Phase D4: only the slot engine's facts enter this adapter. Temporal
 * facts are used only for comparison (D3 shadow validation) and never
 * pass through this adapter.
 */

import type { ScheduleResultMap, WorkMinutes } from "@planner/protocol";
import type { NormalizedScheduleFacts } from "./NormalizedScheduleFact.js";
import { MS_PER_DAY } from "./NormalizedScheduleFact.js";
import { parseProjectStartMs } from "./SlotScheduleTranslator.js";

/**
 * Convert NormalizedScheduleFacts into a ScheduleResultMap.
 *
 * Date (epoch-ms) → day-offset: (dateMs − startMs) / MS_PER_DAY
 * Float (working minutes) → day-offset units: minutes / minutesPerDay
 *
 * The resulting ScheduleResultMap is identical in shape and units to
 * the pre-D4 direct-passthrough path. All downstream consumers
 * continue to work without modification.
 *
 * @param facts           Normalized schedule facts from a translator.
 * @param projectStartDate  ISO date string "YYYY-MM-DD".
 * @param minutesPerDay   Working minutes per day (e.g. 480).
 */
export function projectFacts(
  facts: NormalizedScheduleFacts,
  projectStartDate: string,
  minutesPerDay: number,
): ScheduleResultMap {
  const startMs = parseProjectStartMs(projectStartDate);
  const resultMap: ScheduleResultMap = {};

  for (const taskId of Object.keys(facts)) {
    const f = facts[taskId];
    resultMap[taskId] = {
      earlyStartMinutes: ((f.earlyStartDate - startMs) / MS_PER_DAY) as WorkMinutes,
      earlyFinishMinutes: ((f.earlyFinishDate - startMs) / MS_PER_DAY) as WorkMinutes,
      lateStartMinutes: ((f.lateStartDate - startMs) / MS_PER_DAY) as WorkMinutes,
      lateFinishMinutes: ((f.lateFinishDate - startMs) / MS_PER_DAY) as WorkMinutes,
      totalFloatMinutes: (f.totalFloatMinutes / minutesPerDay) as WorkMinutes,
      isCritical: f.isCritical,
    };
  }

  return resultMap;
}
