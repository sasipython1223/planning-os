/**
 * W4.4.1 — Date Display Format
 *
 * Tests verify:
 *  1. formatWithDisplayFormat produces correct output for all 5 formats.
 *  2. Default format is DD-MMM-YY.
 *  3. projectDateFormatted uses day offsets (CPM schedule results).
 *  4. projectDateFromMinutesFormatted uses calendar-minute offsets (source actuals).
 *  5. Missing date displays "—" (via guards in column renderCell, not tested here — see taskTableActuals.test.ts).
 *  6. Time is shown correctly when format includes HH:mm.
 */

import { describe, expect, it } from "vitest";
import {
    DATE_DISPLAY_FORMAT_OPTIONS,
    DEFAULT_DATE_DISPLAY_FORMAT,
    formatSourceDateString,
    formatWithDisplayFormat,
    projectDateFormatted,
    projectDateFromMinutes,
    projectDateFromMinutesFormatted,
    type DateDisplayFormat,
} from "./dateProjection";

// ─── Reference date ────────────────────────────────────────────────────────
// 2026-05-08 = the "today" used in spec examples.
const REF_DATE = new Date(Date.UTC(2026, 4, 8)); // month is 0-indexed

// ─── formatWithDisplayFormat ───────────────────────────────────────────────

describe("formatWithDisplayFormat", () => {
  it("DD-MMM-YY → 08-May-26", () => {
    expect(formatWithDisplayFormat(REF_DATE, "DD-MMM-YY")).toBe("08-May-26");
  });

  it("DD-MMM-YYYY → 08-May-2026", () => {
    expect(formatWithDisplayFormat(REF_DATE, "DD-MMM-YYYY")).toBe("08-May-2026");
  });

  it("YYYY-MM-DD → 2026-05-08", () => {
    expect(formatWithDisplayFormat(REF_DATE, "YYYY-MM-DD")).toBe("2026-05-08");
  });

  it("DD-MMM-YY HH:mm with midnight → 08-May-26 00:00", () => {
    expect(formatWithDisplayFormat(REF_DATE, "DD-MMM-YY HH:mm")).toBe("08-May-26 00:00");
  });

  it("YYYY-MM-DD HH:mm with midnight → 2026-05-08 00:00", () => {
    expect(formatWithDisplayFormat(REF_DATE, "YYYY-MM-DD HH:mm")).toBe("2026-05-08 00:00");
  });

  it("DD-MMM-YY HH:mm with time → 08-May-26 08:00", () => {
    const dateWithTime = new Date(Date.UTC(2026, 4, 8, 8, 0));
    expect(formatWithDisplayFormat(dateWithTime, "DD-MMM-YY HH:mm")).toBe("08-May-26 08:00");
  });

  it("YYYY-MM-DD HH:mm with time → 2026-05-08 14:30", () => {
    const dateWithTime = new Date(Date.UTC(2026, 4, 8, 14, 30));
    expect(formatWithDisplayFormat(dateWithTime, "YYYY-MM-DD HH:mm")).toBe("2026-05-08 14:30");
  });

  it("pads single-digit day: 04-Jun-26", () => {
    const d = new Date(Date.UTC(2026, 5, 4)); // 2026-06-04
    expect(formatWithDisplayFormat(d, "DD-MMM-YY")).toBe("04-Jun-26");
  });

  it("pads single-digit month: 2026-01-05", () => {
    const d = new Date(Date.UTC(2026, 0, 5)); // 2026-01-05
    expect(formatWithDisplayFormat(d, "YYYY-MM-DD")).toBe("2026-01-05");
  });

  it("handles December correctly: 31-Dec-26", () => {
    const d = new Date(Date.UTC(2026, 11, 31));
    expect(formatWithDisplayFormat(d, "DD-MMM-YY")).toBe("31-Dec-26");
  });

  it("pads hour/minute with leading zeros: 08-May-26 08:07", () => {
    const d = new Date(Date.UTC(2026, 4, 8, 8, 7));
    expect(formatWithDisplayFormat(d, "DD-MMM-YY HH:mm")).toBe("08-May-26 08:07");
  });
});

// ─── Default format ────────────────────────────────────────────────────────

describe("DEFAULT_DATE_DISPLAY_FORMAT", () => {
  it("is DD-MMM-YY", () => {
    expect(DEFAULT_DATE_DISPLAY_FORMAT).toBe("DD-MMM-YY");
  });

  it("is included in DATE_DISPLAY_FORMAT_OPTIONS", () => {
    const values = DATE_DISPLAY_FORMAT_OPTIONS.map((o) => o.value);
    expect(values).toContain(DEFAULT_DATE_DISPLAY_FORMAT);
  });
});

// ─── DATE_DISPLAY_FORMAT_OPTIONS ───────────────────────────────────────────

describe("DATE_DISPLAY_FORMAT_OPTIONS", () => {
  it("has exactly 5 options", () => {
    expect(DATE_DISPLAY_FORMAT_OPTIONS).toHaveLength(5);
  });

  it("all options have value, label, and example", () => {
    for (const opt of DATE_DISPLAY_FORMAT_OPTIONS) {
      expect(opt.value).toBeTruthy();
      expect(opt.label).toBeTruthy();
      expect(opt.example).toBeTruthy();
    }
  });

  it("example for DD-MMM-YY is 08-May-26", () => {
    const opt = DATE_DISPLAY_FORMAT_OPTIONS.find((o) => o.value === "DD-MMM-YY");
    expect(opt?.example).toBe("08-May-26");
  });
});

// ─── projectDateFormatted (CPM day offsets) ────────────────────────────────

describe("projectDateFormatted (CPM day offsets)", () => {
  // Project starts 2026-01-05. Day offset 123 = 2026-05-08.
  // Jan has 26 remaining days (5..31 = 26), Feb=28, Mar=31, Apr=30, May 1..8=7? Let me count properly:
  // Jan: 5+1 = 6th to 31st = 26 days; Feb: 28; Mar: 31; Apr: 30; total to May 1: 115 days. May 8 = 115+7 = 122.
  // Actually: offset 0 = Jan 5, offset 1 = Jan 6, ..., offset 26 = Jan 31, offset 27 = Feb 1...
  // From 2026-01-05 + 123 days: Jan remaining = 26 days (day 5 to day 31), Feb = 28, Mar = 31, Apr = 30 → 26+28+31+30 = 115, so +8 more = May 8 → offset 123.
  // Wait: offset 0 = Jan 5, offset 26 = Jan 31, offset 27 = Feb 1, offset 54 = Feb 28, offset 55 = Mar 1, offset 85 = Mar 31, offset 86 = Apr 1, offset 115 = Apr 30, offset 116 = May 1, offset 123 = May 8. ✓
  const START = "2026-01-05";
  const DAY_OFFSET_MAY_8 = 123;

  it("DD-MMM-YY: 08-May-26", () => {
    expect(projectDateFormatted(START, DAY_OFFSET_MAY_8, "DD-MMM-YY")).toBe("08-May-26");
  });

  it("DD-MMM-YYYY: 08-May-2026", () => {
    expect(projectDateFormatted(START, DAY_OFFSET_MAY_8, "DD-MMM-YYYY")).toBe("08-May-2026");
  });

  it("YYYY-MM-DD: 2026-05-08", () => {
    expect(projectDateFormatted(START, DAY_OFFSET_MAY_8, "YYYY-MM-DD")).toBe("2026-05-08");
  });

  it("DD-MMM-YY HH:mm: 08-May-26 00:00 (day offsets have no time)", () => {
    expect(projectDateFormatted(START, DAY_OFFSET_MAY_8, "DD-MMM-YY HH:mm")).toBe("08-May-26 00:00");
  });

  it("offset 0 = project start date", () => {
    expect(projectDateFormatted(START, 0, "YYYY-MM-DD")).toBe("2026-01-05");
  });
});

// ─── projectDateFromMinutes / projectDateFromMinutesFormatted ──────────────

describe("projectDateFromMinutes (calendar minute offsets)", () => {
  // Project start 2026-01-05 UTC midnight.
  // "2026-05-08 08:00 UTC" is 123 days + 8 hours = 123*1440 + 480 = 177120 + 480 = 177600 calendar minutes after midnight Jan 5.
  const START = "2026-01-05";
  const MIN_MAY_8_MIDNIGHT = 123 * 24 * 60; // 177120 — midnight May 8
  const MIN_MAY_8_08_00 = 123 * 24 * 60 + 8 * 60; // 177600 — 08:00 May 8

  it("minute offset for midnight May 8 → Date is 2026-05-08 00:00 UTC", () => {
    const d = projectDateFromMinutes(START, MIN_MAY_8_MIDNIGHT);
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(4); // May is index 4
    expect(d.getUTCDate()).toBe(8);
    expect(d.getUTCHours()).toBe(0);
  });

  it("minute offset for 08:00 May 8 → Date has hour 8", () => {
    const d = projectDateFromMinutes(START, MIN_MAY_8_08_00);
    expect(d.getUTCDate()).toBe(8);
    expect(d.getUTCHours()).toBe(8);
    expect(d.getUTCMinutes()).toBe(0);
  });
});

describe("projectDateFromMinutesFormatted (calendar minute offsets)", () => {
  const START = "2026-01-05";
  const MIN_MAY_8_08_00 = 123 * 24 * 60 + 8 * 60;
  const MIN_JUN_4 = (31 - 5 + 28 + 31 + 30 + 31 + 4) * 24 * 60;
  // Jan 5→31 = 26d, Feb=28, Mar=31, Apr=30, May=31, Jun 1→4=4 → 26+28+31+30+31+4=150 days = 216000 min

  it("DD-MMM-YY with time: 08-May-26 08:00", () => {
    expect(projectDateFromMinutesFormatted(START, MIN_MAY_8_08_00, "DD-MMM-YY HH:mm")).toBe("08-May-26 08:00");
  });

  it("YYYY-MM-DD with time: 2026-05-08 08:00", () => {
    expect(projectDateFromMinutesFormatted(START, MIN_MAY_8_08_00, "YYYY-MM-DD HH:mm")).toBe("2026-05-08 08:00");
  });

  it("DD-MMM-YY (no time): 08-May-26", () => {
    expect(projectDateFromMinutesFormatted(START, MIN_MAY_8_08_00, "DD-MMM-YY")).toBe("08-May-26");
  });

  it("04-Jun-26 with no time portion", () => {
    expect(projectDateFromMinutesFormatted(START, MIN_JUN_4, "DD-MMM-YY")).toBe("04-Jun-26");
  });
});

// ─── TaskTable Start/Finish column uses selected format ────────────────────
// (Integration: tested via full renderCell calls in separate test file for actuals.
//  Here we just verify the utility chain is correct for the spec examples.)

describe("spec examples verification", () => {
  const FORMATS: DateDisplayFormat[] = [
    "DD-MMM-YY",
    "DD-MMM-YYYY",
    "YYYY-MM-DD",
    "DD-MMM-YY HH:mm",
    "YYYY-MM-DD HH:mm",
  ];

  const MAY_8_DATE = new Date(Date.UTC(2026, 4, 8));

  const EXPECTED: Record<DateDisplayFormat, string> = {
    "DD-MMM-YY":         "08-May-26",
    "DD-MMM-YYYY":       "08-May-2026",
    "YYYY-MM-DD":        "2026-05-08",
    "DD-MMM-YY HH:mm":  "08-May-26 00:00",
    "YYYY-MM-DD HH:mm": "2026-05-08 00:00",
  };

  for (const fmt of FORMATS) {
    it(`${fmt} on 2026-05-08 → "${EXPECTED[fmt]}"`, () => {
      expect(formatWithDisplayFormat(MAY_8_DATE, fmt)).toBe(EXPECTED[fmt]);
    });
  }
});

describe("formatSourceDateString", () => {
  it("formats date-only source values with DD-MMM-YY", () => {
    expect(formatSourceDateString("2026-05-08", "DD-MMM-YY")).toBe("08-May-26");
  });

  it("formats date-time source values with HH:mm", () => {
    expect(formatSourceDateString("2026-05-08T08:00:00", "DD-MMM-YY HH:mm")).toBe("08-May-26 08:00");
  });

  it("omits time when source precision is date-only", () => {
    expect(formatSourceDateString("2026-05-08", "YYYY-MM-DD HH:mm")).toBe("2026-05-08");
  });

  it("returns undefined for invalid source date strings", () => {
    expect(formatSourceDateString("not-a-date", "DD-MMM-YY")).toBeUndefined();
  });
});
