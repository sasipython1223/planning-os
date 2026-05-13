/**
 * W5B-B2.12A.7 — Sub-Minute Residue Mechanistic Trace, Step 2 (JS coordinate / translator).
 *
 * Synthetic, test-only. Targets the four JS modules that convert
 * engine-native coordinates into the comparator's input space:
 *
 *   - parseProjectStartMs (UTC date parsing — Step 2 timezone stability)
 *   - SlotScheduleTranslator (slot day-offset → epoch-ms + working-minute floats)
 *   - TemporalScheduleTranslator (absolute-minute → epoch-ms; floor/ceil seam)
 *   - ProjectionAdapter.projectFacts (epoch-ms → day-offset round-trip)
 *
 * Hypothesis under test:
 *   The 1–3 unit residue in AI003 live originates at the asymmetric
 *   floor/ceil bucketing inside TemporalScheduleTranslator (or in the
 *   worker.ts:1655–1668 conversion that re-divides epoch-ms by MS_PER_DAY).
 *
 * No production code is modified. These tests only call the translator
 * methods with synthetic inputs and assert exact numeric outputs.
 */

import type { WorkMinutes } from "@planner/protocol";
import type { ScheduleResponse } from "@planner/protocol/kernel";
import { describe, expect, it } from "vitest";
import type { NormalizedScheduleFacts } from "../../src/schedule/NormalizedScheduleFact.js";
import { MS_PER_DAY } from "../../src/schedule/NormalizedScheduleFact.js";
import { projectFacts } from "../../src/schedule/ProjectionAdapter.js";
import {
    parseProjectStartMs,
    SlotScheduleTranslator,
} from "../../src/schedule/SlotScheduleTranslator.js";
import type { TemporalScheduleResponseBoundary } from "../../src/schedule/TemporalScheduleTranslator.js";
import { TemporalScheduleTranslator } from "../../src/schedule/TemporalScheduleTranslator.js";

const PROJECT_START = "2025-01-06"; // Mon
const PROJECT_START_MS = Date.UTC(2025, 0, 6);
const MPD = 480; // business minutes per day
const WALL_MINUTES_PER_DAY = 1440;

const wm = (v: number): WorkMinutes => v as WorkMinutes;

describe("W5B-B2.12A.7 Step 2.1 — parseProjectStartMs (UTC timezone stability)", () => {
  it("returns UTC midnight regardless of the host timezone", () => {
    const ms = parseProjectStartMs(PROJECT_START);
    expect(ms).toBe(PROJECT_START_MS);
    const d = new Date(ms);
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCSeconds()).toBe(0);
    expect(d.getUTCMilliseconds()).toBe(0);
  });

  it("is exact-integer ms — no fractional ms anywhere in the seam", () => {
    expect(Number.isInteger(parseProjectStartMs("2025-01-06"))).toBe(true);
    expect(Number.isInteger(parseProjectStartMs("2024-12-31"))).toBe(true);
    expect(Number.isInteger(parseProjectStartMs("2026-05-13"))).toBe(true);
  });
});

describe("W5B-B2.12A.7 Step 2.2 — SlotScheduleTranslator (slot side)", () => {
  const translator = new SlotScheduleTranslator();

  it("translates integer day-offsets to exact day-aligned epoch-ms", () => {
    const raw: ScheduleResponse = {
      scheduleVersion: 1,
      results: [
        {
          taskId: "A",
          earlyStartMinutes: wm(0),
          earlyFinishMinutes: wm(1),
          lateStartMinutes: wm(0),
          lateFinishMinutes: wm(1),
          totalFloatMinutes: wm(0),
          isCritical: true,
        },
        {
          taskId: "B",
          earlyStartMinutes: wm(1),
          earlyFinishMinutes: wm(3),
          lateStartMinutes: wm(1),
          lateFinishMinutes: wm(3),
          totalFloatMinutes: wm(0),
          isCritical: true,
        },
      ],
    };

    const facts = translator.translate(raw, {
      projectStartDate: PROJECT_START,
      minutesPerDay: MPD,
    })!;

    expect(facts.A.earlyStartDate).toBe(PROJECT_START_MS);
    expect(facts.A.earlyFinishDate).toBe(PROJECT_START_MS + 1 * MS_PER_DAY);
    expect(facts.B.earlyStartDate).toBe(PROJECT_START_MS + 1 * MS_PER_DAY);
    expect(facts.B.earlyFinishDate).toBe(PROJECT_START_MS + 3 * MS_PER_DAY);
  });

  it("scales totalFloat from day-offset units to working minutes by ×mpd (lossless for integer days)", () => {
    const raw: ScheduleResponse = {
      scheduleVersion: 1,
      results: [
        {
          taskId: "A",
          earlyStartMinutes: wm(0),
          earlyFinishMinutes: wm(2),
          lateStartMinutes: wm(0),
          lateFinishMinutes: wm(2),
          totalFloatMinutes: wm(3), // 3 day-offset units of float
          isCritical: false,
        },
      ],
    };
    const facts = translator.translate(raw, {
      projectStartDate: PROJECT_START,
      minutesPerDay: MPD,
    })!;
    expect(facts.A.totalFloatMinutes).toBe(3 * MPD); // 1440 work-min — exact
    expect(facts.A.freeFloatMinutes).toBe(0); // slot kernel does not produce free float
  });

  it("slot translator output then ProjectionAdapter round-trip is identity for integer inputs (no residue)", () => {
    const raw: ScheduleResponse = {
      scheduleVersion: 1,
      results: [
        {
          taskId: "A",
          earlyStartMinutes: wm(5),
          earlyFinishMinutes: wm(8),
          lateStartMinutes: wm(5),
          lateFinishMinutes: wm(8),
          totalFloatMinutes: wm(2),
          isCritical: false,
        },
      ],
    };
    const facts = translator.translate(raw, {
      projectStartDate: PROJECT_START,
      minutesPerDay: MPD,
    })!;
    const result = projectFacts(facts, PROJECT_START, MPD);
    expect(result.A.earlyStartMinutes).toBe(5);
    expect(result.A.earlyFinishMinutes).toBe(8);
    expect(result.A.totalFloatMinutes).toBe(2);
    // i.e. the slot side does not manufacture residue on integer inputs.
  });
});

describe("W5B-B2.12A.7 Step 2.3 — TemporalScheduleTranslator (asymmetric floor/ceil seam)", () => {
  const translator = new TemporalScheduleTranslator();

  const buildResponse = (
    earlyStartMinute: number,
    earlyFinishMinute: number,
  ): TemporalScheduleResponseBoundary => ({
    scheduleVersion: 1,
    results: [
      {
        taskId: "A",
        earlyStartMinute,
        earlyFinishMinute,
        lateStartMinute: earlyStartMinute,
        lateFinishMinute: earlyFinishMinute,
        totalFloatMinutes: 0,
        freeFloatMinutes: 0,
        isCritical: true,
      },
    ],
  });

  it("translates minute 0 / 1440 / 2880 (exact day boundaries) without residue", () => {
    for (const startMin of [0, 1440, 2880]) {
      const facts = translator.translate(buildResponse(startMin, startMin), {
        projectStartDate: PROJECT_START,
        minutesPerDay: MPD,
      })!;
      const dayOffset = startMin / WALL_MINUTES_PER_DAY;
      expect(facts.A.earlyStartDate).toBe(PROJECT_START_MS + dayOffset * MS_PER_DAY);
      expect(facts.A.earlyFinishDate).toBe(PROJECT_START_MS + dayOffset * MS_PER_DAY);
    }
  });

  it("HYPOTHESIS-CONFIRMING: a sub-day finish minute is BUCKETED UP by `ceil` — manufactures a +1-day residue", () => {
    // Temporal kernel may return earlyFinishMinute = 480 (end-of-workday in
    // an 8-hour calendar) for a task on day 0. The translator then computes
    // ceil(480/1440) = 1, mapping the finish to *day 1* of the calendar.
    // The slot kernel, by contrast, would have returned earlyFinishMinutes
    // = 1 (its own day-offset units), which the slot translator maps to
    // *day 1* as well. Both bucket to day 1 in THIS case.
    //
    // The asymmetry appears when the underlying truth lies BELOW the next
    // wall-clock day boundary: any temporal finish in (0, 1440) is bumped
    // to wall-day 1. Any temporal start in [0, 1440) is bumped DOWN to
    // wall-day 0. Therefore a temporal task starting at minute 600 and
    // finishing at minute 1080 (same wall-day) ends up represented as
    // start-day 0, finish-day 1 in the normalized facts — a +1-day
    // *finish residue* injected by the translator.
    const facts = translator.translate(buildResponse(600, 1080), {
      projectStartDate: PROJECT_START,
      minutesPerDay: MPD,
    })!;
    expect(facts.A.earlyStartDate).toBe(PROJECT_START_MS); // floor(600/1440) = 0
    expect(facts.A.earlyFinishDate).toBe(PROJECT_START_MS + 1 * MS_PER_DAY); // ceil(1080/1440) = 1
    // Net: a same-wall-day task is reported as spanning [day 0, day 1)
    // in normalized facts. This is the documented D4 day-bucketing rule
    // (see TemporalScheduleTranslator module docstring) but it is
    // ASYMMETRIC with the slot path on intra-day-finish tasks.
  });

  it("HYPOTHESIS-CONFIRMING: temporal finish at minute 1441 → finish-day 2 (ceil bumps), revealing the bucket choice", () => {
    const facts = translator.translate(buildResponse(0, 1441), {
      projectStartDate: PROJECT_START,
      minutesPerDay: MPD,
    })!;
    expect(facts.A.earlyStartDate).toBe(PROJECT_START_MS);
    expect(facts.A.earlyFinishDate).toBe(PROJECT_START_MS + 2 * MS_PER_DAY);
    // ceil(1441/1440) = 2. A 1-minute overshoot of a wall-day boundary
    // produces a full extra wall-day in the normalized facts.
  });

  it("temporal totalFloat is passed through verbatim — sub-minute float survives the translator", () => {
    const resp: TemporalScheduleResponseBoundary = {
      scheduleVersion: 1,
      results: [
        {
          taskId: "A",
          earlyStartMinute: 0,
          earlyFinishMinute: 0,
          lateStartMinute: 0,
          lateFinishMinute: 0,
          totalFloatMinutes: 481,
          freeFloatMinutes: 0,
          isCritical: false,
        },
      ],
    };
    const facts = translator.translate(resp, {
      projectStartDate: PROJECT_START,
      minutesPerDay: MPD,
    })!;
    expect(facts.A.totalFloatMinutes).toBe(481); // verbatim
    expect(facts.A.freeFloatMinutes).toBe(0);
  });
});

describe("W5B-B2.12A.7 Step 2.4 — ProjectionAdapter (epoch-ms → day-offset round-trip)", () => {
  it("epoch-ms exact day boundaries → integer day-offsets — no fractional residue", () => {
    const facts: NormalizedScheduleFacts = {
      A: {
        taskId: "A",
        earlyStartDate: PROJECT_START_MS + 0 * MS_PER_DAY,
        earlyFinishDate: PROJECT_START_MS + 3 * MS_PER_DAY,
        lateStartDate: PROJECT_START_MS + 0 * MS_PER_DAY,
        lateFinishDate: PROJECT_START_MS + 3 * MS_PER_DAY,
        totalFloatMinutes: 0,
        freeFloatMinutes: 0,
        isCritical: true,
      },
    };
    const map = projectFacts(facts, PROJECT_START, MPD);
    expect(map.A.earlyStartMinutes).toBe(0);
    expect(map.A.earlyFinishMinutes).toBe(3);
    expect(map.A.totalFloatMinutes).toBe(0);
  });

  it("HYPOTHESIS-CONFIRMING: totalFloatMinutes input that is 1 work-min above an integer-day boundary produces a fractional day-offset residue ≈ 1/480", () => {
    // The temporal kernel passes totalFloat in working minutes verbatim
    // through TemporalScheduleTranslator. ProjectionAdapter divides by mpd.
    // 481/480 = 1.0020833333… — the EXACT live-reported value of
    // `maxAbsTotalFloatVarianceMinutes`.
    const facts: NormalizedScheduleFacts = {
      A: {
        taskId: "A",
        earlyStartDate: PROJECT_START_MS,
        earlyFinishDate: PROJECT_START_MS,
        lateStartDate: PROJECT_START_MS,
        lateFinishDate: PROJECT_START_MS,
        totalFloatMinutes: 481, // one work-min above 1 working day
        freeFloatMinutes: 0,
        isCritical: false,
      },
    };
    const map = projectFacts(facts, PROJECT_START, MPD);
    expect(map.A.totalFloatMinutes as number).toBeCloseTo(481 / 480, 12);
    expect(map.A.totalFloatMinutes as number).not.toBe(1);
    expect(map.A.totalFloatMinutes as number).not.toBe(2);
  });

  it("epoch-ms NOT on a day boundary produces fractional earlyStartMinutes (would-be silent residue)", () => {
    // Defensive: if any upstream path were to emit an epoch-ms that is not
    // a clean multiple of MS_PER_DAY, ProjectionAdapter would silently
    // produce a fractional day-offset. The translators above currently
    // emit clean multiples — this test pins the behaviour so any future
    // upstream drift becomes visible.
    const facts: NormalizedScheduleFacts = {
      A: {
        taskId: "A",
        earlyStartDate: PROJECT_START_MS + Math.floor(MS_PER_DAY / 2),
        earlyFinishDate: PROJECT_START_MS + Math.floor(MS_PER_DAY / 2),
        lateStartDate: PROJECT_START_MS + Math.floor(MS_PER_DAY / 2),
        lateFinishDate: PROJECT_START_MS + Math.floor(MS_PER_DAY / 2),
        totalFloatMinutes: 0,
        freeFloatMinutes: 0,
        isCritical: false,
      },
    };
    const map = projectFacts(facts, PROJECT_START, MPD);
    expect(map.A.earlyStartMinutes as number).toBeCloseTo(0.5, 12);
  });
});

describe("W5B-B2.12A.7 Step 2.5 — full slot translator + projection round-trip on integer day inputs", () => {
  it("exact-integer round-trip — no residue, all 6 axes preserved", () => {
    const slotTranslator = new SlotScheduleTranslator();
    const raw: ScheduleResponse = {
      scheduleVersion: 1,
      results: [
        {
          taskId: "A",
          earlyStartMinutes: wm(0),
          earlyFinishMinutes: wm(2),
          lateStartMinutes: wm(0),
          lateFinishMinutes: wm(2),
          totalFloatMinutes: wm(0),
          isCritical: true,
        },
        {
          taskId: "B",
          earlyStartMinutes: wm(2),
          earlyFinishMinutes: wm(5),
          lateStartMinutes: wm(2),
          lateFinishMinutes: wm(5),
          totalFloatMinutes: wm(0),
          isCritical: true,
        },
      ],
    };
    const facts = slotTranslator.translate(raw, {
      projectStartDate: PROJECT_START,
      minutesPerDay: MPD,
    })!;
    const map = projectFacts(facts, PROJECT_START, MPD);
    expect(map.A.earlyStartMinutes).toBe(0);
    expect(map.A.earlyFinishMinutes).toBe(2);
    expect(map.B.earlyStartMinutes).toBe(2);
    expect(map.B.earlyFinishMinutes).toBe(5);
    expect(map.A.totalFloatMinutes).toBe(0);
    expect(map.B.totalFloatMinutes).toBe(0);
  });
});

/**
 * Step 2 findings (asserted by tests above):
 *
 *   F4. `parseProjectStartMs` is UTC-stable and integer-exact. Not a residue source.
 *   F5. Slot side (SlotScheduleTranslator + ProjectionAdapter) is residue-free
 *       on integer day-offset inputs. Output day-offsets are exact integers.
 *   F6. Temporal side (TemporalScheduleTranslator) uses ASYMMETRIC
 *       floor(start) / ceil(finish) wall-clock-day bucketing. Any temporal
 *       finish minute that is not a clean multiple of 1440 is rounded UP to
 *       the next wall-day. This is the documented D4 day-bucketing rule
 *       (see TemporalScheduleTranslator docstring) — it is not a bug, but
 *       it IS asymmetric with the slot path and can produce a +1-day
 *       finish residue on tasks whose temporal finish minute falls inside
 *       a wall-day.
 *   F7. `totalFloatMinutes` is passed through the temporal translator
 *       verbatim. Once it reaches ProjectionAdapter it is divided by mpd
 *       (e.g. 480). A 1-work-minute residual in `totalFloatMinutes`
 *       becomes 1/480 ≈ 0.00208 day-offset units. The cube of this seam
 *       (1 work-min / mpd) reproduces the LIVE-observed value
 *       `maxAbsTotalFloatVarianceMinutes = 1.002083333…` after the
 *       comparator subtracts slot's float (also in day-offset units).
 *
 * Combined Step 1 + Step 2 mechanistic hypothesis:
 *
 *   The 1–3 unit residue stratified in B2.12A.6 across lag /
 *   relationship_chain / unknown buckets is consistent with the
 *   ASYMMETRIC bucketing in TemporalScheduleTranslator and the
 *   minutes-vs-day-offset unit collapse in ProjectionAdapter, NOT with
 *   independent semantic failure of lag, dep-type, or constraint logic.
 *
 *   This hypothesis must still be confirmed against the Rust kernel
 *   outputs (Step 4 — whether the temporal kernel produces sub-1440
 *   finish minutes on tasks the slot kernel rounds to clean days).
 *   No fix is proposed — Track A is a trace, not a fix.
 */
