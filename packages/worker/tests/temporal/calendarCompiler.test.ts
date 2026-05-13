import type { CalendarConfig, CalendarId, WorkMinutes } from "@planner/protocol";
import { DEFAULT_CALENDAR_ID, MINUTES_PER_DAY } from "@planner/protocol";
import { describe, expect, it } from "vitest";
import {
    CalendarCompilerCache,
    compileCalendar,
} from "../../src/temporal/calendarCompiler.js";
import { createMinuteAnchor } from "../../src/temporal/minuteAnchor.js";

const makeConfig = (
  overrides: Partial<CalendarConfig> = {},
): CalendarConfig => ({
  id: DEFAULT_CALENDAR_ID,
  name: "Standard (Mon–Fri, 8h)",
  minutesPerDay: MINUTES_PER_DAY,
  workingWeekPattern: "MON_FRI",
  holidays: [],
  ...overrides,
});

describe("CalendarCompiler", () => {
  describe("compileCalendar", () => {
    // 2025-01-06 is a Monday
    const anchor = createMinuteAnchor("2025-01-06");

    it("emits 5 intervals for a Mon-Fri week in a 7-day horizon", () => {
      const config = makeConfig();
      const intervals = compileCalendar(config, anchor, 7);
      // Mon(0), Tue(1), Wed(2), Thu(3), Fri(4) — Sat(5) & Sun(6) skipped
      expect(intervals).toHaveLength(5);
    });

    it("produces correct interval widths (480 minutes)", () => {
      const config = makeConfig();
      const intervals = compileCalendar(config, anchor, 1);
      expect(intervals).toHaveLength(1);
      const [start, end] = intervals[0];
      expect(end - start).toBe(480);
      expect(start).toBe(0); // day 0 midnight
    });

    it("skips weekend days for MON_FRI pattern", () => {
      const config = makeConfig();
      const intervals = compileCalendar(config, anchor, 14);
      // 14 days = 2 weeks → 10 working days
      expect(intervals).toHaveLength(10);
    });

    it("includes all days for ALL_DAYS pattern", () => {
      const config = makeConfig({ workingWeekPattern: "ALL_DAYS" });
      const intervals = compileCalendar(config, anchor, 7);
      expect(intervals).toHaveLength(7);
    });

    it("excludes holidays", () => {
      // Make Wednesday 2025-01-08 (day offset 2) a holiday
      const config = makeConfig({ holidays: ["2025-01-08"] });
      const intervals = compileCalendar(config, anchor, 7);
      // Mon(0), Tue(1), [Wed skipped], Thu(3), Fri(4) — 4 working days
      expect(intervals).toHaveLength(4);

      // Verify day 2 (1440*2 = 2880) is not in intervals
      const starts = intervals.map(([s]) => s);
      expect(starts).not.toContain(2 * 1440);
    });

    it("handles holidays on weekends (no double-skip)", () => {
      // Saturday 2025-01-11 (day offset 5) — already a weekend
      const config = makeConfig({ holidays: ["2025-01-11"] });
      const intervals = compileCalendar(config, anchor, 7);
      // Same as no holidays: 5 working days
      expect(intervals).toHaveLength(5);
    });

    it("intervals are sorted ascending", () => {
      const config = makeConfig();
      const intervals = compileCalendar(config, anchor, 30);
      for (let i = 1; i < intervals.length; i++) {
        expect(intervals[i][0]).toBeGreaterThan(intervals[i - 1][0]);
      }
    });

    it("intervals are non-overlapping", () => {
      const config = makeConfig();
      const intervals = compileCalendar(config, anchor, 30);
      for (let i = 1; i < intervals.length; i++) {
        expect(intervals[i][0]).toBeGreaterThanOrEqual(intervals[i - 1][1]);
      }
    });

    it("respects custom minutesPerDay", () => {
      const config = makeConfig({ minutesPerDay: 600 as WorkMinutes });
      const intervals = compileCalendar(config, anchor, 1);
      const [start, end] = intervals[0];
      expect(end - start).toBe(600);
    });
  });

  describe("CalendarCompilerCache", () => {
    it("caches compiled intervals", () => {
      const cache = new CalendarCompilerCache();
      const config = makeConfig();
      const anchor = createMinuteAnchor("2025-01-06");

      const first = cache.getOrCompile(config, anchor, 7);
      const second = cache.getOrCompile(config, anchor, 7);
      expect(first).toBe(second); // same reference
      expect(cache.size).toBe(1);
    });

    it("invalidates on different config", () => {
      const cache = new CalendarCompilerCache();
      const anchor = createMinuteAnchor("2025-01-06");

      cache.getOrCompile(makeConfig(), anchor, 7);
      cache.getOrCompile(
        makeConfig({ id: "custom" as CalendarId, holidays: ["2025-01-08"] }),
        anchor,
        7,
      );
      expect(cache.size).toBe(2);
    });

    it("clear() empties the cache", () => {
      const cache = new CalendarCompilerCache();
      const anchor = createMinuteAnchor("2025-01-06");
      cache.getOrCompile(makeConfig(), anchor, 7);
      expect(cache.size).toBe(1);
      cache.clear();
      expect(cache.size).toBe(0);
    });
  });
});
