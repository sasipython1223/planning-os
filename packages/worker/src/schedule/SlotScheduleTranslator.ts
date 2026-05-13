/**
 * @module SlotScheduleTranslator
 *
 * Phase D4 — Translates slot kernel output into NormalizedScheduleFacts.
 *
 * The slot kernel returns day-offset values (0 = project start, 1 = next
 * calendar day, etc.). This translator converts those offsets into
 * epoch-ms calendar dates and working-minute floats so the worker
 * and comparator deal only with engine-neutral facts.
 *
 * Phase D4: authoritative path. The resulting facts feed into
 * ProjectionAdapter → ScheduleResultMap → existing downstream pipeline.
 * The ScheduleResultMap shape is unchanged; downstream consumers
 * (rollups, variances, histogram, UI) are unaffected.
 */

import type { ScheduleResponse } from "@planner/protocol/kernel";
import type { IScheduleTranslator, TranslationContext } from "./IScheduleTranslator.js";
import type { NormalizedScheduleFacts, ScheduleFact } from "./NormalizedScheduleFact.js";
import { MS_PER_DAY } from "./NormalizedScheduleFact.js";

/**
 * Parse "YYYY-MM-DD" → epoch-ms at UTC midnight.
 *
 * Uses Date.UTC to avoid timezone pitfalls. This is a pure function
 * with no external dependencies.
 */
export function parseProjectStartMs(projectStartDate: string): number {
  const y = parseInt(projectStartDate.slice(0, 4), 10);
  const m = parseInt(projectStartDate.slice(5, 7), 10) - 1;
  const d = parseInt(projectStartDate.slice(8, 10), 10);
  return Date.UTC(y, m, d);
}

/**
 * Translate a slot-engine ScheduleResponse into normalized schedule facts.
 *
 * Note: the slot kernel's ScheduleResponse fields are named `*Minutes`
 * (e.g. earlyStartMinutes) but their values are **day-offsets** (0, 1, 2…),
 * not literal minute values. This naming is a legacy protocol artefact.
 * The translator treats them as day-offsets throughout.
 *
 * Coordinate conversions:
 *   - Day-offset → epoch-ms: startEpochMs + dayOffset × MS_PER_DAY
 *   - Float (day-offset units) → working minutes: float × minutesPerDay
 *   - freeFloat: always 0 (slot kernel does not compute free float)
 *
 * This translator is compatibility-preserving: the round-trip through
 * SlotScheduleTranslator → ProjectionAdapter reproduces the exact same
 * ScheduleResultMap that the pre-D4 direct-passthrough path produced.
 */
export class SlotScheduleTranslator implements IScheduleTranslator {
  translate(rawResult: unknown, context: TranslationContext): NormalizedScheduleFacts | null {
    const response = rawResult as ScheduleResponse;
    if (!response.results) return null;

    const startMs = parseProjectStartMs(context.projectStartDate);
    const mpd = context.minutesPerDay;
    const facts: Record<string, ScheduleFact> = {};

    for (const r of response.results) {
      facts[r.taskId] = {
        taskId: r.taskId,
        earlyStartDate: startMs + (r.earlyStartMinutes as number) * MS_PER_DAY,
        earlyFinishDate: startMs + (r.earlyFinishMinutes as number) * MS_PER_DAY,
        lateStartDate: startMs + (r.lateStartMinutes as number) * MS_PER_DAY,
        lateFinishDate: startMs + (r.lateFinishMinutes as number) * MS_PER_DAY,
        totalFloatMinutes: (r.totalFloatMinutes as number) * mpd,
        freeFloatMinutes: 0,
        isCritical: r.isCritical,
      };
    }

    return facts;
  }
}
