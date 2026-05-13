import type { CalendarId, ScheduleResultMap, VisibleRow } from "@planner/protocol";
import { describe, expect, it } from "vitest";
import { compileCalendar } from "../src/calendarRegistry.js";
import { STANDARD_CALENDAR } from "../src/calendarTypes.js";
import { clearCollapsedIds, filterVisibleRows, setCollapsedIds, setFullProjection } from "../src/hierarchy.js";
import type { CalendarOutputContext } from "../src/rollup.js";
import { computeRollups } from "../src/rollup.js";
import { d, wm } from "./helpers.js";

/** Helper to build a minimal VisibleRow for testing. */
function row(
  id: string,
  opts: {
    parentId?: string;
    depth?: number;
    isSummary?: boolean;
  } = {},
): VisibleRow {
  return {
    id,
    name: id,
    durationWorkMinutes: wm(480),
    siblingOrder: "A",
    depth: opts.depth ?? 0,
    isSummary: opts.isSummary ?? false,
    parentId: opts.parentId,
    isCollapsed: false,
    canExpand: opts.isSummary ?? false,
    wbsCode: "1",
    rollupStartMinutes: null,
    rollupFinishMinutes: null,
    rollupDurationMinutes: null,
    rollupCost: null,
    rollupWorkMinutes: null,
    rollupPercentComplete: null,
  };
}

describe("computeRollups", () => {
  it("leaf task gets schedule values from scheduleResults (day-slot → WorkMinutes)", () => {
    const rows = [row("A")];
    // Schedule results are in kernel day-slot units (1 unit = 1 calendar day).
    // computeRollups converts to WorkMinutes by multiplying by MINUTES_PER_DAY.
    const sr: ScheduleResultMap = {
      A: {
        earlyStartMinutes: wm(0),
        earlyFinishMinutes: wm(1),
        lateStartMinutes: wm(0),
        lateFinishMinutes: wm(1),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
    };

    const result = computeRollups(rows, sr);
    expect(result).toHaveLength(1);
    expect(result[0].rollupStartMinutes).toBe(0);
    expect(result[0].rollupFinishMinutes).toBe(d(1));
    expect(result[0].rollupDurationMinutes).toBe(d(1));
  });

  it("leaf task with no schedule data gets null rollup fields", () => {
    const rows = [row("A")];
    const result = computeRollups(rows, {});

    expect(result[0].rollupStartMinutes).toBeNull();
    expect(result[0].rollupFinishMinutes).toBeNull();
    expect(result[0].rollupDurationMinutes).toBeNull();
  });

  it("summary aggregates min(start) and max(finish) from children", () => {
    const rows = [
      row("S", { isSummary: true, depth: 0 }),
      row("A", { parentId: "S", depth: 1 }),
      row("B", { parentId: "S", depth: 1 }),
    ];
    // Day-slot inputs: A spans day 0–2, B spans day 1–5
    const sr: ScheduleResultMap = {
      A: {
        earlyStartMinutes: wm(0),
        earlyFinishMinutes: wm(2),
        lateStartMinutes: wm(0),
        lateFinishMinutes: wm(2),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
      B: {
        earlyStartMinutes: wm(1),
        earlyFinishMinutes: wm(5),
        lateStartMinutes: wm(1),
        lateFinishMinutes: wm(5),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
    };

    const result = computeRollups(rows, sr);
    const summary = result[0];
    // Summary: min(0,1)=0, max(2,5)=5 → WorkMinutes: 0, 5*480=2400, duration=2400
    expect(summary.rollupStartMinutes).toBe(0);
    expect(summary.rollupFinishMinutes).toBe(d(5));
    expect(summary.rollupDurationMinutes).toBe(d(5));
  });

  it("nested summaries propagate bottom-up", () => {
    const rows = [
      row("Root", { isSummary: true, depth: 0 }),
      row("Sub", { parentId: "Root", isSummary: true, depth: 1 }),
      row("Leaf1", { parentId: "Sub", depth: 2 }),
      row("Leaf2", { parentId: "Root", depth: 1 }),
    ];
    // Day-slot: Leaf1 day 0–2, Leaf2 day 3–7
    const sr: ScheduleResultMap = {
      Leaf1: {
        earlyStartMinutes: wm(0),
        earlyFinishMinutes: wm(2),
        lateStartMinutes: wm(0),
        lateFinishMinutes: wm(2),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
      Leaf2: {
        earlyStartMinutes: wm(3),
        earlyFinishMinutes: wm(7),
        lateStartMinutes: wm(3),
        lateFinishMinutes: wm(7),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
    };

    const result = computeRollups(rows, sr);

    // Sub summary: child = Leaf1 only → start=0, finish=d(2)
    const sub = result.find(r => r.id === "Sub")!;
    expect(sub.rollupStartMinutes).toBe(0);
    expect(sub.rollupFinishMinutes).toBe(d(2));
    expect(sub.rollupDurationMinutes).toBe(d(2));

    // Root summary: children = Sub(0,d(2)) + Leaf2(d(3),d(7)) → start=0, finish=d(7)
    const root = result.find(r => r.id === "Root")!;
    expect(root.rollupStartMinutes).toBe(0);
    expect(root.rollupFinishMinutes).toBe(d(7));
    expect(root.rollupDurationMinutes).toBe(d(7));
  });

  it("summary with no scheduled children gets null", () => {
    const rows = [
      row("S", { isSummary: true, depth: 0 }),
      row("A", { parentId: "S", depth: 1 }),
    ];
    const result = computeRollups(rows, {});

    expect(result[0].rollupStartMinutes).toBeNull();
    expect(result[0].rollupFinishMinutes).toBeNull();
    expect(result[0].rollupDurationMinutes).toBeNull();
  });

  it("summary with empty children list gets null", () => {
    // Summary with no visible children (all collapsed away)
    const rows = [row("S", { isSummary: true, depth: 0 })];
    const result = computeRollups(rows, {});

    expect(result[0].rollupStartMinutes).toBeNull();
    expect(result[0].rollupFinishMinutes).toBeNull();
  });

  it("preserves reference equality when rollup values unchanged", () => {
    // Pre-existing row already has rolled-up values matching what computeRollups would produce
    const existingRow: VisibleRow = {
      ...row("A"),
      rollupStartMinutes: wm(0),
      rollupFinishMinutes: d(1),
      rollupDurationMinutes: d(1),
    };
    const sr: ScheduleResultMap = {
      A: {
        earlyStartMinutes: wm(0),
        earlyFinishMinutes: wm(1),
        lateStartMinutes: wm(0),
        lateFinishMinutes: wm(1),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
    };

    const result = computeRollups([existingRow], sr);
    expect(result[0]).toBe(existingRow); // same object reference
  });

  it("creates new object when rollup values change", () => {
    const existingRow: VisibleRow = {
      ...row("A"),
      rollupStartMinutes: wm(0),
      rollupFinishMinutes: d(1),
      rollupDurationMinutes: d(1),
    };
    const sr: ScheduleResultMap = {
      A: {
        earlyStartMinutes: wm(0),
        earlyFinishMinutes: wm(2),
        lateStartMinutes: wm(0),
        lateFinishMinutes: wm(2),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
    };

    const result = computeRollups([existingRow], sr);
    expect(result[0]).not.toBe(existingRow);
    expect(result[0].rollupFinishMinutes).toBe(d(2));
    expect(result[0].rollupDurationMinutes).toBe(d(2));
  });

  it("preserves original row order", () => {
    const rows = [
      row("S", { isSummary: true, depth: 0 }),
      row("A", { parentId: "S", depth: 1 }),
      row("B", { parentId: "S", depth: 1 }),
    ];
    const result = computeRollups(rows, {});
    expect(result.map(r => r.id)).toEqual(["S", "A", "B"]);
  });

  it("summary with mix of scheduled and unscheduled children", () => {
    const rows = [
      row("S", { isSummary: true, depth: 0 }),
      row("A", { parentId: "S", depth: 1 }),
      row("B", { parentId: "S", depth: 1 }),
    ];
    // Only A has schedule data (day-slot: 0–2)
    const sr: ScheduleResultMap = {
      A: {
        earlyStartMinutes: wm(0),
        earlyFinishMinutes: wm(2),
        lateStartMinutes: wm(0),
        lateFinishMinutes: wm(2),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
      // B has no schedule results
    };

    const result = computeRollups(rows, sr);
    const s = result[0];
    // Should still aggregate from the one scheduled child
    expect(s.rollupStartMinutes).toBe(0);
    expect(s.rollupFinishMinutes).toBe(d(2));
    expect(s.rollupDurationMinutes).toBe(d(2));
  });
});

describe("Phase 3A architectural invariants", () => {
  it("collapsed summary retains same rollup values as expanded — full projection includes all children", () => {
    // Full projection: summary S has children A and B, regardless of collapse state
    const rows = [
      { ...row("S", { isSummary: true, depth: 0 }), isCollapsed: true },
      row("A", { parentId: "S", depth: 1 }),
      row("B", { parentId: "S", depth: 1 }),
    ];
    // Day-slot: A 0–1, B 1–2
    const sr: ScheduleResultMap = {
      A: {
        earlyStartMinutes: wm(0),
        earlyFinishMinutes: wm(1),
        lateStartMinutes: wm(0),
        lateFinishMinutes: wm(1),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
      B: {
        earlyStartMinutes: wm(1),
        earlyFinishMinutes: wm(2),
        lateStartMinutes: wm(1),
        lateFinishMinutes: wm(2),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
    };

    // Compute rollups on full projection (all 3 rows present)
    const result = computeRollups(rows, sr);

    // Summary should aggregate both children even though it's "collapsed"
    const summary = result.find(r => r.id === "S")!;
    expect(summary.rollupStartMinutes).toBe(0);
    expect(summary.rollupFinishMinutes).toBe(d(2));
    expect(summary.rollupDurationMinutes).toBe(d(2));
  });

  it("parent totals do not change when descendants are hidden — rollups computed before filtering", () => {
    // Full projection with nested summaries — all rows present regardless of collapse
    const rows = [
      row("Root", { isSummary: true, depth: 0 }),
      { ...row("Sub", { parentId: "Root", isSummary: true, depth: 1 }), isCollapsed: true },
      row("Leaf1", { parentId: "Sub", depth: 2 }),
      row("Leaf2", { parentId: "Sub", depth: 2 }),
      row("Leaf3", { parentId: "Root", depth: 1 }),
    ];
    // Day-slot inputs: Leaf1 0–1, Leaf2 1–2, Leaf3 0–1
    const sr: ScheduleResultMap = {
      Leaf1: {
        earlyStartMinutes: wm(0),
        earlyFinishMinutes: wm(1),
        lateStartMinutes: wm(0),
        lateFinishMinutes: wm(1),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
      Leaf2: {
        earlyStartMinutes: wm(1),
        earlyFinishMinutes: wm(2),
        lateStartMinutes: wm(1),
        lateFinishMinutes: wm(2),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
      Leaf3: {
        earlyStartMinutes: wm(0),
        earlyFinishMinutes: wm(1),
        lateStartMinutes: wm(0),
        lateFinishMinutes: wm(1),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
    };

    const result = computeRollups(rows, sr);

    // Sub (collapsed) still aggregates Leaf1+Leaf2: start=d(0)=0, finish=d(2)=960
    const sub = result.find(r => r.id === "Sub")!;
    expect(sub.rollupStartMinutes).toBe(0);
    expect(sub.rollupFinishMinutes).toBe(d(2));
    expect(sub.rollupDurationMinutes).toBe(d(2));

    // Root aggregates Sub(0,d(2)) + Leaf3(0,d(1)): start=0, finish=d(2)
    const root = result.find(r => r.id === "Root")!;
    expect(root.rollupStartMinutes).toBe(0);
    expect(root.rollupFinishMinutes).toBe(d(2));
    expect(root.rollupDurationMinutes).toBe(d(2));
  });

  it("filterVisibleRows inherits rollup values from full projection without recomputation", () => {
    // Simulate the pipeline: buildFullProjection → computeRollups → filterVisibleRows
    // After computeRollups, rows have stamped rollup values.
    // filterVisibleRows should pass them through unchanged.

    const rolledUpSummary: VisibleRow = {
      ...row("S", { isSummary: true, depth: 0 }),
      isCollapsed: false,
      rollupStartMinutes: wm(0),
      rollupFinishMinutes: d(2),
      rollupDurationMinutes: d(2),
    };
    const rolledUpChild: VisibleRow = {
      ...row("A", { parentId: "S", depth: 1 }),
      rollupStartMinutes: wm(0),
      rollupFinishMinutes: d(1),
      rollupDurationMinutes: d(1),
    };

    // Set cached full projection with rolled-up values
    setFullProjection([rolledUpSummary, rolledUpChild]);

    // Expand state: both visible, rollup values preserved
    clearCollapsedIds();
    const expanded = filterVisibleRows([rolledUpSummary, rolledUpChild]);
    expect(expanded).toHaveLength(2);
    expect(expanded[0].rollupStartMinutes).toBe(0);
    expect(expanded[0].rollupFinishMinutes).toBe(d(2));

    // Collapse S: child hidden, summary rollup unchanged
    setCollapsedIds(new Set(["S"]));
    const collapsed = filterVisibleRows([rolledUpSummary, rolledUpChild]);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].id).toBe("S");
    expect(collapsed[0].rollupStartMinutes).toBe(0);
    expect(collapsed[0].rollupFinishMinutes).toBe(d(2));
    expect(collapsed[0].rollupDurationMinutes).toBe(d(2));
    expect(collapsed[0].isCollapsed).toBe(true);

    // Cleanup
    clearCollapsedIds();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Summary duration uses working time, not elapsed calendar time
// ────────────────────────────────────────────────────────────────────────────

describe("summary duration uses working calendar", () => {
  /** Build a non-working-days set from an array of day-offsets. */
  const nwd = (days: number[]) => new Set(days);

  it("sequential children across a weekend — summary duration excludes weekend days", () => {
    // Project week: Mon=0..Fri=4, Sat=5(NW), Sun=6(NW), Mon=7..Fri=11
    // Child A: day 3–5 (Th–Sat), Child B: day 6–8 (Sun–Tue)
    // Calendar span: day 3 to day 8 = 5 calendar days
    // Working span: days 3, 4, 7 = 3 working days (skip 5, 6)
    const rows = [
      row("S", { isSummary: true, depth: 0 }),
      row("A", { parentId: "S", depth: 1 }),
      row("B", { parentId: "S", depth: 1 }),
    ];
    const sr: ScheduleResultMap = {
      A: {
        earlyStartMinutes: wm(3),
        earlyFinishMinutes: wm(5),
        lateStartMinutes: wm(3),
        lateFinishMinutes: wm(5),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
      B: {
        earlyStartMinutes: wm(6),
        earlyFinishMinutes: wm(8),
        lateStartMinutes: wm(6),
        lateFinishMinutes: wm(8),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
    };
    const weekendDays = nwd([5, 6]); // Sat, Sun

    const result = computeRollups(rows, sr, weekendDays);
    const summary = result.find(r => r.id === "S")!;

    // Start/finish are unaffected — still min/max of children
    expect(summary.rollupStartMinutes).toBe(d(3));
    expect(summary.rollupFinishMinutes).toBe(d(8));
    // Duration: working days in [3, 8) = {3, 4, 7} = 3 working days
    expect(summary.rollupDurationMinutes).toBe(d(3));
  });

  it("parallel children — summary duration counts working days in overlapping span", () => {
    // Two children run in parallel: A day 0–4, B day 1–3
    // Summary span: day 0–4. Weekend on day 2.
    // Working days in [0, 4) = {0, 1, 3} = 3
    const rows = [
      row("S", { isSummary: true, depth: 0 }),
      row("A", { parentId: "S", depth: 1 }),
      row("B", { parentId: "S", depth: 1 }),
    ];
    const sr: ScheduleResultMap = {
      A: {
        earlyStartMinutes: wm(0),
        earlyFinishMinutes: wm(4),
        lateStartMinutes: wm(0),
        lateFinishMinutes: wm(4),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
      B: {
        earlyStartMinutes: wm(1),
        earlyFinishMinutes: wm(3),
        lateStartMinutes: wm(1),
        lateFinishMinutes: wm(3),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
    };

    const result = computeRollups(rows, sr, nwd([2]));
    const summary = result.find(r => r.id === "S")!;

    expect(summary.rollupStartMinutes).toBe(0);
    expect(summary.rollupFinishMinutes).toBe(d(4));
    // Working days in [0, 4) skipping 2 = {0, 1, 3} = 3
    expect(summary.rollupDurationMinutes).toBe(d(3));
  });

  it("leaf duration is unaffected by non-working days — uses kernel working duration directly", () => {
    // Leaf: kernel says start=3, finish=5. Kernel already accounts for NWD internally.
    // Leaf duration = (5-3) * MINUTES_PER_DAY = 2 working days regardless of NWD set.
    const rows = [row("A")];
    const sr: ScheduleResultMap = {
      A: {
        earlyStartMinutes: wm(3),
        earlyFinishMinutes: wm(5),
        lateStartMinutes: wm(3),
        lateFinishMinutes: wm(5),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
    };

    const result = computeRollups(rows, sr, nwd([4]));
    const leaf = result[0];

    // Leaf duration = raw kernel diff * MINUTES_PER_DAY
    expect(leaf.rollupDurationMinutes).toBe(d(2));
  });

  it("leaf and summary durations use the same WorkMinutes unit", () => {
    // Leaf A: 2 working-day task spanning days 0–2 (no NWD in range)
    // Summary S: span 0–2 with no NWD → duration should also be 2 working days
    // Both should produce d(2) — same unit, same value when no NWD overlap.
    const rows = [
      row("S", { isSummary: true, depth: 0 }),
      row("A", { parentId: "S", depth: 1 }),
    ];
    const sr: ScheduleResultMap = {
      A: {
        earlyStartMinutes: wm(0),
        earlyFinishMinutes: wm(2),
        lateStartMinutes: wm(0),
        lateFinishMinutes: wm(2),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
    };

    const result = computeRollups(rows, sr, nwd([]));

    const leaf = result.find(r => r.id === "A")!;
    const summary = result.find(r => r.id === "S")!;

    // Both express duration in WorkMinutes — same unit
    expect(leaf.rollupDurationMinutes).toBe(d(2));
    expect(summary.rollupDurationMinutes).toBe(d(2));
    // TaskTable divides both by MINUTES_PER_DAY to display "2d"
    expect(leaf.rollupDurationMinutes! / 480).toBe(2);
    expect(summary.rollupDurationMinutes! / 480).toBe(2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Track A Step 6b-2: Calendar-aware output duration
// ────────────────────────────────────────────────────────────────────────────

describe("calendar-aware rollup duration (Step 6b-2)", () => {
  /** Monday project start — standard reference date. */
  const PROJECT_START = "2025-01-06";

  /** STANDARD_CALENDAR compiled — uniform 8h Mon–Fri (480 min/day). */
  const STD = compileCalendar(STANDARD_CALENDAR);

  /** Standard calendar output context. */
  const stdCtx: CalendarOutputContext = {
    calendar: STD,
    projectStartDate: PROJECT_START,
  };

  // ─── Leaf task parity with scalar path ────────────────────────────

  it("leaf: STANDARD_CALENDAR matches scalar (finish−start)×minutesPerDay", () => {
    const rows = [row("A")];
    const sr: ScheduleResultMap = {
      A: {
        earlyStartMinutes: wm(0),
        earlyFinishMinutes: wm(3),
        lateStartMinutes: wm(0),
        lateFinishMinutes: wm(3),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
    };

    const scalar = computeRollups(rows, sr);
    const calAware = computeRollups(rows, sr, new Set(), 480, stdCtx);

    // Start/finish remain scalar in both
    expect(calAware[0].rollupStartMinutes).toBe(scalar[0].rollupStartMinutes);
    expect(calAware[0].rollupFinishMinutes).toBe(scalar[0].rollupFinishMinutes);
    // Duration: identical for uniform calendar
    expect(calAware[0].rollupDurationMinutes).toBe(d(3));
    expect(calAware[0].rollupDurationMinutes).toBe(scalar[0].rollupDurationMinutes);
  });

  it("leaf spanning weekend: calendar-aware counts only working days", () => {
    // daySlot 4 = Fri, daySlot 8 = Tue next week.
    // Calendar days [4,8): Fri, Sat(NW), Sun(NW), Mon = 2 working days.
    const rows = [row("A")];
    const sr: ScheduleResultMap = {
      A: {
        earlyStartMinutes: wm(4),
        earlyFinishMinutes: wm(8),
        lateStartMinutes: wm(4),
        lateFinishMinutes: wm(8),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
    };

    const calAware = computeRollups(rows, sr, new Set(), 480, stdCtx);
    // Fri→Tue: Fri(480) + Mon(480) = 960 = d(2). Sat/Sun excluded by calendar.
    expect(calAware[0].rollupDurationMinutes).toBe(d(2));

    // Scalar path without NWD set: naive (8−4)*480 = 1920 = d(4)
    const scalar = computeRollups(rows, sr);
    expect(scalar[0].rollupDurationMinutes).toBe(d(4));
  });

  it("leaf with no schedule data gets null (unchanged)", () => {
    const calAware = computeRollups([row("A")], {}, new Set(), 480, stdCtx);
    expect(calAware[0].rollupDurationMinutes).toBeNull();
  });

  // ─── Summary duration parity ──────────────────────────────────────

  it("summary: STANDARD_CALENDAR matches scalar path for weekday-only span", () => {
    const rows = [
      row("S", { isSummary: true, depth: 0 }),
      row("A", { parentId: "S", depth: 1 }),
      row("B", { parentId: "S", depth: 1 }),
    ];
    const sr: ScheduleResultMap = {
      A: {
        earlyStartMinutes: wm(0),
        earlyFinishMinutes: wm(2),
        lateStartMinutes: wm(0),
        lateFinishMinutes: wm(2),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
      B: {
        earlyStartMinutes: wm(1),
        earlyFinishMinutes: wm(4),
        lateStartMinutes: wm(1),
        lateFinishMinutes: wm(4),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
    };

    // NWD set consistent with STANDARD_CALENDAR: Sat=5, Sun=6
    const nwdSet = new Set([5, 6]);

    const scalar = computeRollups(rows, sr, nwdSet);
    const calAware = computeRollups(rows, sr, nwdSet, 480, stdCtx);

    const scalarSummary = scalar.find(r => r.id === "S")!;
    const calSummary = calAware.find(r => r.id === "S")!;

    // Span [0,4) is all weekdays — both paths give 4 working days
    expect(calSummary.rollupDurationMinutes).toBe(d(4));
    expect(calSummary.rollupDurationMinutes).toBe(scalarSummary.rollupDurationMinutes);
  });

  it("summary spanning weekend: calendar-aware excludes weekend minutes", () => {
    const rows = [
      row("S", { isSummary: true, depth: 0 }),
      row("A", { parentId: "S", depth: 1 }),
      row("B", { parentId: "S", depth: 1 }),
    ];
    // A: Thu(3)–Sat(5), B: Mon(7)–Tue(8)
    const sr: ScheduleResultMap = {
      A: {
        earlyStartMinutes: wm(3),
        earlyFinishMinutes: wm(5),
        lateStartMinutes: wm(3),
        lateFinishMinutes: wm(5),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
      B: {
        earlyStartMinutes: wm(7),
        earlyFinishMinutes: wm(8),
        lateStartMinutes: wm(7),
        lateFinishMinutes: wm(8),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
    };

    // Calendar-consistent NWD set
    const nwdSet = new Set([5, 6]);

    const scalar = computeRollups(rows, sr, nwdSet);
    const calAware = computeRollups(rows, sr, nwdSet, 480, stdCtx);

    const scalarSummary = scalar.find(r => r.id === "S")!;
    const calSummary = calAware.find(r => r.id === "S")!;

    // Summary span [3,8): days 3(Thu),4(Fri),5(Sat),6(Sun),7(Mon) = 3 working days
    expect(calSummary.rollupDurationMinutes).toBe(d(3));
    expect(calSummary.rollupDurationMinutes).toBe(scalarSummary.rollupDurationMinutes);
  });

  it("nested summaries propagate bottom-up with calendar context", () => {
    const rows = [
      row("Root", { isSummary: true, depth: 0 }),
      row("Sub", { parentId: "Root", isSummary: true, depth: 1 }),
      row("Leaf1", { parentId: "Sub", depth: 2 }),
      row("Leaf2", { parentId: "Root", depth: 1 }),
    ];
    const sr: ScheduleResultMap = {
      Leaf1: {
        earlyStartMinutes: wm(0),
        earlyFinishMinutes: wm(2),
        lateStartMinutes: wm(0),
        lateFinishMinutes: wm(2),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
      Leaf2: {
        earlyStartMinutes: wm(3),
        earlyFinishMinutes: wm(4),
        lateStartMinutes: wm(3),
        lateFinishMinutes: wm(4),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
    };

    const calAware = computeRollups(rows, sr, new Set([5, 6]), 480, stdCtx);

    const sub = calAware.find(r => r.id === "Sub")!;
    expect(sub.rollupDurationMinutes).toBe(d(2));

    const root = calAware.find(r => r.id === "Root")!;
    // Root span [0,4): Mon,Tue,Wed,Thu = 4 working days
    expect(root.rollupDurationMinutes).toBe(d(4));
  });

  // ─── Holiday / exception case ─────────────────────────────────────

  it("calendar with holiday exception: duration excludes holiday", () => {
    // Calendar: standard + Christmas 2025-12-25 (Thursday) as non-working
    const iv = (s: number, e: number) => ({ startMinute: s, endMinute: e });
    const calWithHoliday = compileCalendar({
      id: "holiday-cal" as CalendarId,
      name: "With Holiday",
      weeklyPattern: {
        1: [iv(480, 720), iv(780, 1020)],
        2: [iv(480, 720), iv(780, 1020)],
        3: [iv(480, 720), iv(780, 1020)],
        4: [iv(480, 720), iv(780, 1020)],
        5: [iv(480, 720), iv(780, 1020)],
      },
      exceptions: [
        { date: "2025-12-25", workIntervals: [], name: "Christmas" },
      ],
    });

    // Project starts Monday 2025-12-22. Days: Mon=0, Tue=1, Wed=2, Thu(Xmas)=3, Fri=4
    const holidayCtx: CalendarOutputContext = {
      calendar: calWithHoliday,
      projectStartDate: "2025-12-22",
    };

    const rows = [
      row("S", { isSummary: true, depth: 0 }),
      row("A", { parentId: "S", depth: 1 }),
    ];
    // Leaf spans Mon(0)–Fri(4)
    const sr: ScheduleResultMap = {
      A: {
        earlyStartMinutes: wm(0),
        earlyFinishMinutes: wm(4),
        lateStartMinutes: wm(0),
        lateFinishMinutes: wm(4),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
    };

    const calAware = computeRollups(rows, sr, new Set([3, 5, 6]), 480, holidayCtx);
    const leaf = calAware.find(r => r.id === "A")!;
    const summary = calAware.find(r => r.id === "S")!;

    // Leaf span [0,4): Mon(480) + Tue(480) + Wed(480) + Thu(0, Christmas) = 1440 = d(3)
    expect(leaf.rollupDurationMinutes).toBe(d(3));
    // Summary same as single child
    expect(summary.rollupDurationMinutes).toBe(d(3));
  });

  // ─── Half-day exception ───────────────────────────────────────────

  it("calendar with half-day exception: duration reflects reduced hours", () => {
    const iv = (s: number, e: number) => ({ startMinute: s, endMinute: e });
    const calHalfDay = compileCalendar({
      id: "half-day-cal" as CalendarId,
      name: "Half Day Friday",
      weeklyPattern: {
        1: [iv(480, 720), iv(780, 1020)], // Mon 480min
        2: [iv(480, 720), iv(780, 1020)], // Tue 480min
        3: [iv(480, 720), iv(780, 1020)], // Wed 480min
        4: [iv(480, 720), iv(780, 1020)], // Thu 480min
        5: [iv(480, 720), iv(780, 1020)], // Fri 480min
      },
      exceptions: [
        // Friday 2025-01-10 is a half-day: morning only (240 min)
        { date: "2025-01-10", workIntervals: [iv(480, 720)], name: "Half Friday" },
      ],
    });

    const halfDayCtx: CalendarOutputContext = {
      calendar: calHalfDay,
      projectStartDate: PROJECT_START,
    };

    const rows = [row("A")];
    // Leaf: Thu(3) to Sat(5) → Thu + half-Friday
    const sr: ScheduleResultMap = {
      A: {
        earlyStartMinutes: wm(3),
        earlyFinishMinutes: wm(5),
        lateStartMinutes: wm(3),
        lateFinishMinutes: wm(5),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
    };

    const calAware = computeRollups(rows, sr, new Set([5, 6]), 480, halfDayCtx);
    // Thu 480 + half-Friday 240 = 720
    expect(calAware[0].rollupDurationMinutes).toBe(720);

    // Scalar path would give (5−3)*480 = 960 — different!
    const scalar = computeRollups(rows, sr);
    expect(scalar[0].rollupDurationMinutes).toBe(d(2)); // 960
    expect(calAware[0].rollupDurationMinutes).not.toBe(scalar[0].rollupDurationMinutes);
  });

  // ─── Fallback: no calendarContext ─────────────────────────────────

  it("without calendarContext, scalar path is used (backward compat)", () => {
    const rows = [row("A")];
    const sr: ScheduleResultMap = {
      A: {
        earlyStartMinutes: wm(0),
        earlyFinishMinutes: wm(2),
        lateStartMinutes: wm(0),
        lateFinishMinutes: wm(2),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
    };

    // No calendarContext parameter — uses scalar (finish−start)*minutesPerDay
    const result = computeRollups(rows, sr);
    expect(result[0].rollupDurationMinutes).toBe(d(2));
  });

  // ─── Start/finish remain scalar ───────────────────────────────────

  it("start/finish remain scalar daySlot×minutesPerDay regardless of context", () => {
    const rows = [row("A")];
    const sr: ScheduleResultMap = {
      A: {
        earlyStartMinutes: wm(3),
        earlyFinishMinutes: wm(7),
        lateStartMinutes: wm(3),
        lateFinishMinutes: wm(7),
        totalFloatMinutes: wm(0),
        isCritical: false,
      },
    };

    const calAware = computeRollups(rows, sr, new Set([5, 6]), 480, stdCtx);
    // Start/finish: scalar conversion unchanged
    expect(calAware[0].rollupStartMinutes).toBe(d(3));
    expect(calAware[0].rollupFinishMinutes).toBe(d(7));
  });
});
