import { describe, expect, it } from "vitest";
import {
    createMinuteAnchor,
    dateToMinute,
    dayOffsetToMinute,
    minuteToDate,
} from "../../src/temporal/minuteAnchor.js";

describe("MinuteAnchor", () => {
  describe("createMinuteAnchor", () => {
    it("anchors at midnight UTC of the given date", () => {
      const anchor = createMinuteAnchor("2025-01-06");
      // 2025-01-06 00:00:00 UTC
      expect(anchor.epochMs).toBe(Date.UTC(2025, 0, 6));
    });

    it("handles leap year date", () => {
      const anchor = createMinuteAnchor("2024-02-29");
      expect(anchor.epochMs).toBe(Date.UTC(2024, 1, 29));
    });
  });

  describe("dateToMinute", () => {
    const anchor = createMinuteAnchor("2025-01-06");

    it("returns 0 for the anchor date itself", () => {
      expect(dateToMinute("2025-01-06", anchor)).toBe(0);
    });

    it("returns 1440 for next calendar day", () => {
      expect(dateToMinute("2025-01-07", anchor)).toBe(1440);
    });

    it("returns 7×1440 for one week later", () => {
      expect(dateToMinute("2025-01-13", anchor)).toBe(7 * 1440);
    });

    it("returns negative for dates before anchor", () => {
      expect(dateToMinute("2025-01-05", anchor)).toBe(-1440);
    });
  });

  describe("minuteToDate", () => {
    const anchor = createMinuteAnchor("2025-01-06");

    it("returns anchor date for minute 0", () => {
      expect(minuteToDate(0, anchor)).toBe("2025-01-06");
    });

    it("returns next day for 1440 minutes", () => {
      expect(minuteToDate(1440, anchor)).toBe("2025-01-07");
    });

    it("returns previous day for -1440 minutes", () => {
      expect(minuteToDate(-1440, anchor)).toBe("2025-01-05");
    });

    it("round-trips with dateToMinute", () => {
      const dates = ["2025-03-15", "2024-12-31", "2025-06-01"];
      for (const date of dates) {
        expect(minuteToDate(dateToMinute(date, anchor), anchor)).toBe(date);
      }
    });
  });

  describe("dayOffsetToMinute", () => {
    it("converts day 0 to minute 0", () => {
      expect(dayOffsetToMinute(0)).toBe(0);
    });

    it("converts day 1 to minute 1440", () => {
      expect(dayOffsetToMinute(1)).toBe(1440);
    });

    it("converts day 7 to minute 10080", () => {
      expect(dayOffsetToMinute(7)).toBe(10080);
    });
  });
});
