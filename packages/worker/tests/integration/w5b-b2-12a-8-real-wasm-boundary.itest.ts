/**
 * TEST-ONLY HARNESS — DO NOT IMPORT FROM PRODUCTION.
 * Local/on-demand only.
 * Uses already-built `cpm-wasm` pkg artifact.
 * Does not trigger rebuild.
 * Not wired into CI or default test scripts.
 *
 * Run command:
 *   pnpm -C packages/worker exec vitest \
 *     -c vitest.integration.config.ts run \
 *     tests/integration/w5b-b2-12a-8-real-wasm-boundary.test.ts
 *
 * Milestone:
 *   W5B-B2.12A.8.1 — Real-WASM Loader Harness Wiring. Activates the
 *   six required Track A boundary scenarios from W5B-B2.12A.8 that
 *   were previously blocked at the WASM loader.
 *
 * Boundary contract under test (no production code modified):
 *   JS test input → production `loadCpmWasm` → real wasm-pack bundler
 *   artifact → `calculate_schedule_minute` (ABI v2) → real
 *   `cpm_kernel::run_schedule_temporal` → JS response → production
 *   `TemporalScheduleTranslator` → production `ProjectionAdapter`.
 *
 *   No vi.mock of any WASM / boundary module. No reimplementation of
 *   Rust algorithms in JS. No AI003 fixture.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { projectFacts } from "../../src/schedule/ProjectionAdapter.js";
import { TemporalScheduleTranslator } from "../../src/schedule/TemporalScheduleTranslator.js";
import type { NormalizedScheduleFacts } from "../../src/schedule/NormalizedScheduleFact.js";
import { MS_PER_DAY } from "../../src/schedule/NormalizedScheduleFact.js";
import {
  ensureRealWasmLoaded,
  runRealWasmMinute,
  type RealWasmCalendar,
  type RealWasmMinuteRequest,
  type RealWasmMinuteResponse,
  type RealWasmRelationInput,
  type RealWasmTaskInput,
} from "./helpers/wasmTestLoader.js";

const PROJECT_START_DATE = "2025-01-06"; // Mon
const PROJECT_START_MS = Date.UTC(2025, 0, 6);
const MPD = 480; // business minutes per day used by production ProjectionAdapter
const WALL_MINUTES_PER_DAY = 1440;

const task = (
  id: string,
  durationMinutes: number,
  calendarId: string,
  minEarlyStartMinutes = 0,
): RealWasmTaskInput => ({
  id,
  durationMinutes,
  minEarlyStartMinutes,
  calendarId,
  parentId: null,
  isSummary: false,
  constraintType: "ASAP",
  constraintDateMinute: null,
});

const fsLag = (predId: string, succId: string, lagMinutes: number): RealWasmRelationInput => ({
  predId,
  succId,
  depType: "FS",
  lagMinutes,
  lagCalendarId: "project",
});

const continuousCalendar = (id: string, total: number): RealWasmCalendar => ({
  id,
  intervals: [[0, total]],
});

const splitCalendar = (id: string, intervals: Array<[number, number]>): RealWasmCalendar => ({
  id,
  intervals,
});

const buildMinuteReq = (
  tasks: RealWasmTaskInput[],
  dependencies: RealWasmRelationInput[],
  calendars: RealWasmCalendar[],
): RealWasmMinuteRequest => ({
  abiVersion: 2,
  tasks,
  dependencies,
  calendars,
  projectCalendarId: "project",
  dataDateMinute: 0,
});

const findResult = (resp: RealWasmMinuteResponse, taskId: string) => {
  const r = resp.results.find((x) => x.taskId === taskId);
  if (!r) throw new Error(`task ${taskId} not in real-WASM response`);
  return r;
};

beforeAll(async () => {
  await ensureRealWasmLoaded();
});

// ─────────────────────────────────────────────────────────────────────
// 1. Loader smoke
// ─────────────────────────────────────────────────────────────────────
describe("W5B-B2.12A.8.1 — loader smoke", () => {
  it("b2_12a_8_1_real_wasm_loader_smoke — integration config loads + executes real cpm-wasm", () => {
    const resp = runRealWasmMinute(
      buildMinuteReq(
        [task("A", 1, "project")],
        [],
        [continuousCalendar("project", 10_000)],
      ),
    );
    expect(resp.scheduleVersion).toBeTypeOf("number");
    expect(resp.results).toHaveLength(1);
    const a = findResult(resp, "A");
    expect(a.earlyStartMinute).toBe(0);
    expect(a.earlyFinishMinute).toBe(1);
    expect(Number.isInteger(a.earlyStartMinute)).toBe(true);
    expect(Number.isInteger(a.earlyFinishMinute)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2–7. Track A required boundary scenarios
// ─────────────────────────────────────────────────────────────────────
describe("W5B-B2.12A.8 Track A — required boundary scenarios (now executable)", () => {
  // 2. Negative control — clean day-aligned input, end-to-end zero residue
  it("b2_12a_8_real_wasm_clean_day_aligned_zero_residue — negative control: clean integer day end-to-end", () => {
    const resp = runRealWasmMinute(
      buildMinuteReq(
        [task("A", 1440, "project")],
        [],
        [continuousCalendar("project", 10_000)],
      ),
    );
    const a = findResult(resp, "A");

    // Boundary side: exact integer minutes, finish on clean wall-day.
    expect(a.earlyStartMinute).toBe(0);
    expect(a.earlyFinishMinute).toBe(1440);
    expect(a.totalFloatMinutes).toBe(0);
    expect(a.freeFloatMinutes).toBe(0);
    expect(Number.isInteger(a.earlyStartMinute)).toBe(true);
    expect(Number.isInteger(a.earlyFinishMinute)).toBe(true);
    expect(Number.isInteger(a.totalFloatMinutes)).toBe(true);

    // Production translator + projection — no modifications.
    const translator = new TemporalScheduleTranslator();
    const facts = translator.translate(resp, {
      projectStartDate: PROJECT_START_DATE,
      minutesPerDay: MPD,
    }) as NormalizedScheduleFacts;
    expect(facts.A.earlyStartDate).toBe(PROJECT_START_MS);
    expect(facts.A.earlyFinishDate).toBe(PROJECT_START_MS + 1 * MS_PER_DAY);

    const projected = projectFacts(facts, PROJECT_START_DATE, MPD);
    expect(projected.A.earlyStartMinutes as number).toBe(0);
    expect(projected.A.earlyFinishMinutes as number).toBe(1);
    expect(projected.A.totalFloatMinutes as number).toBe(0);
    expect(Number.isInteger(projected.A.earlyStartMinutes as number)).toBe(true);
    expect(Number.isInteger(projected.A.earlyFinishMinutes as number)).toBe(true);
    expect(Number.isInteger(projected.A.totalFloatMinutes as number)).toBe(true);
  });

  // 3. Kernel-minute preservation across boundary
  it("b2_12a_8_real_wasm_481_min_duration_preserves_kernel_minute — boundary returns 481 verbatim", () => {
    const resp = runRealWasmMinute(
      buildMinuteReq(
        [task("A", 481, "project")],
        [],
        [continuousCalendar("project", 10_000)],
      ),
    );
    const a = findResult(resp, "A");
    expect(a.earlyStartMinute).toBe(0);
    expect(a.earlyFinishMinute).toBe(481);
    expect(Number.isInteger(a.earlyFinishMinute)).toBe(true);
    expect(a.earlyFinishMinute % WALL_MINUTES_PER_DAY).not.toBe(0); // intra-wall-day
  });

  // 4. Intra-wall-day finish bucketing — confirms B2.12A.7 F6 on real WASM
  it("b2_12a_8_real_wasm_intra_wall_day_finish_produces_plus_one_day_bucket — confirms B2.12A.7 F6 on real-WASM data", () => {
    const resp = runRealWasmMinute(
      buildMinuteReq(
        [task("A", 480, "project", 600)], // start=600, finish=1080 — same wall-day
        [],
        [continuousCalendar("project", 10_000)],
      ),
    );
    const a = findResult(resp, "A");

    // Boundary side: integer minutes, intra-wall-day finish preserved.
    expect(a.earlyStartMinute).toBe(600);
    expect(a.earlyFinishMinute).toBe(1080);
    expect(Number.isInteger(a.earlyStartMinute)).toBe(true);
    expect(Number.isInteger(a.earlyFinishMinute)).toBe(true);

    // Production translator (unchanged): floor(start/1440)=0,
    // ceil(finish/1440)=1 → +1 wall-day finish residue.
    const translator = new TemporalScheduleTranslator();
    const facts = translator.translate(resp, {
      projectStartDate: PROJECT_START_DATE,
      minutesPerDay: MPD,
    }) as NormalizedScheduleFacts;
    expect(facts.A.earlyStartDate).toBe(PROJECT_START_MS);
    expect(facts.A.earlyFinishDate).toBe(PROJECT_START_MS + 1 * MS_PER_DAY);
  });

  // 5. FS+lag chain — no drift at real boundary
  it("b2_12a_8_real_wasm_fs_lag_chain_no_drift — FS+lag survives real boundary without drift", () => {
    const resp = runRealWasmMinute(
      buildMinuteReq(
        [task("A", 480, "project"), task("B", 480, "project")],
        [fsLag("A", "B", 60)],
        [continuousCalendar("project", 10_000)],
      ),
    );
    const a = findResult(resp, "A");
    const b = findResult(resp, "B");
    expect(a.earlyFinishMinute).toBe(480);
    expect(b.earlyStartMinute).toBe(a.earlyFinishMinute + 60);
    expect(b.earlyStartMinute).toBe(540);
    expect(b.earlyFinishMinute).toBe(1020);
  });

  // 6. Calendar gap resume — byte-identical to B2.12A.7 Rust F10
  it("b2_12a_8_real_wasm_calendar_gap_resume_byte_identical — matches B2.12A.7 Rust F10 at boundary", () => {
    const resp = runRealWasmMinute(
      buildMinuteReq(
        [task("A", 90, "project")],
        [],
        [
          splitCalendar("project", [
            [0, 60],
            [1500, 5000],
          ]),
        ],
      ),
    );
    const a = findResult(resp, "A");
    expect(a.earlyStartMinute).toBe(0);
    expect(a.earlyFinishMinute).toBe(1530);
    expect(Number.isInteger(a.earlyFinishMinute)).toBe(true);
  });

  // 7. Fractional minute sweep — closes BigInt/serialization narrowing concern
  it("b2_12a_8_real_wasm_no_fractional_minutes_anywhere — sweep durations, assert integer-exact boundary fields", () => {
    const durations = [1, 59, 60, 61, 479, 480, 481, 1439, 1440, 1441];
    for (const dur of durations) {
      const resp = runRealWasmMinute(
        buildMinuteReq(
          [task("A", dur, "project")],
          [],
          [continuousCalendar("project", 100_000)],
        ),
      );
      const a = findResult(resp, "A");
      const fields: Array<[string, number]> = [
        ["earlyStartMinute", a.earlyStartMinute],
        ["earlyFinishMinute", a.earlyFinishMinute],
        ["lateStartMinute", a.lateStartMinute],
        ["lateFinishMinute", a.lateFinishMinute],
        ["totalFloatMinutes", a.totalFloatMinutes],
        ["freeFloatMinutes", a.freeFloatMinutes],
      ];
      for (const [name, value] of fields) {
        expect(Number.isFinite(value), `dur=${dur} ${name}=${value} non-finite`).toBe(true);
        expect(Number.isInteger(value), `dur=${dur} ${name}=${value} non-integer`).toBe(true);
      }
      // finish − start === duration (real boundary preserves kernel
      // half-open semantics — B2.12A.7 F8).
      expect(a.earlyFinishMinute - a.earlyStartMinute).toBe(dur);
    }
  });
});
