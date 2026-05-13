/**
 * Phase B — Calendar Types, Indexer, and Constraint Snapping Tests
 *
 * Verifies that:
 * 1. Calendar identity types exist and are correctly branded
 * 2. Default implementations preserve existing behavior
 * 3. KernelTemporalAdapter matches existing toDaySlots/fromDaySlots math
 * 4. CalendarResolver always returns the default calendar in Phase B
 * 5. CalendarIndexer generates NWDs from CalendarConfig (weekends + holidays)
 * 6. CalendarServices factory produces coherent services from CalendarConfig
 * 7. State/persistence round-trip calendarId and projectCalendar safely
 * 8. Constraint snapping: SNET/MSO snap forward, FNLT/MFO snap backward
 * 9. Summary duration uses working-time index (holidays excluded)
 */

import type { CalendarConfig, CalendarId, ScheduleResultMap, Task, VisibleRow, WorkMinutes } from "@planner/protocol";
import { DEFAULT_CALENDAR_ID, MINUTES_PER_DAY } from "@planner/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { countWorkingDays, generateNonWorkingDays, generateNonWorkingDaysFromConfig, snapBackward, snapForward } from "../src/calendar.js";
import { compileCalendar } from "../src/calendarRegistry.js";
import {
    CalendarBackedTemporalAdapter,
    computeMinutesPerDay,
    createCalendarServices,
    createTrackACalendarServices,
    DEFAULT_CALENDAR_CONFIG,
    DefaultCalendarIndexer,
    DefaultCalendarResolver,
    DefaultKernelTemporalAdapter,
    STANDARD_CALENDAR,
} from "../src/calendarTypes.js";
import { buildFullProjection } from "../src/hierarchy.js";
import { computeRollups } from "../src/rollup.js";
import { buildScheduleRequest } from "../src/schedule/buildScheduleRequest.js";
import { SlotCoordinateTranslator } from "../src/schedule/SlotCoordinateTranslator.js";
import * as State from "../src/state.js";

// ─── Helpers matching existing test conventions ─────────────────────
const wm = (n: number) => n as WorkMinutes;
const d = (days: number) => (days * MINUTES_PER_DAY) as WorkMinutes;

// ─── Test calendar configs ──────────────────────────────────────────
const MON_FRI_CONFIG: CalendarConfig = {
  ...DEFAULT_CALENDAR_CONFIG,
  workingWeekPattern: "MON_FRI",
  holidays: [],
};

const ALL_DAYS_CONFIG: CalendarConfig = {
  ...DEFAULT_CALENDAR_CONFIG,
  workingWeekPattern: "ALL_DAYS",
  holidays: [],
};

const HOLIDAYS_CONFIG: CalendarConfig = {
  ...DEFAULT_CALENDAR_CONFIG,
  workingWeekPattern: "MON_FRI",
  holidays: ["2025-01-06", "2025-01-07"],
};

// ─── CalendarId & DEFAULT_CALENDAR_ID ───────────────────────────────

describe("CalendarId types", () => {
  it("DEFAULT_CALENDAR_ID is 'default'", () => {
    expect(DEFAULT_CALENDAR_ID).toBe("default");
  });

  it("DEFAULT_CALENDAR_ID is assignable as CalendarId", () => {
    const id: CalendarId = DEFAULT_CALENDAR_ID;
    expect(id).toBe("default");
  });
});

// ─── DefaultCalendarResolver ────────────────────────────────────────

describe("DefaultCalendarResolver", () => {
  const resolver = new DefaultCalendarResolver();

  it("resolve() returns DEFAULT_CALENDAR_ID for any entity", () => {
    expect(resolver.resolve()).toBe(DEFAULT_CALENDAR_ID);
    expect(resolver.resolve("task-123")).toBe(DEFAULT_CALENDAR_ID);
    expect(resolver.resolve("resource-456")).toBe(DEFAULT_CALENDAR_ID);
  });

  it("projectCalendarId() returns DEFAULT_CALENDAR_ID", () => {
    expect(resolver.projectCalendarId()).toBe(DEFAULT_CALENDAR_ID);
  });
});

// ─── DefaultKernelTemporalAdapter ───────────────────────────────────

describe("DefaultKernelTemporalAdapter", () => {
  const adapter = new DefaultKernelTemporalAdapter();

  it("minutesPerDay matches MINUTES_PER_DAY constant", () => {
    expect(adapter.minutesPerDay).toBe(MINUTES_PER_DAY);
    expect(adapter.minutesPerDay).toBe(480);
  });

  it("toDaySlots matches existing Math.round(wm / 480) behavior", () => {
    expect(adapter.toDaySlots(d(5))).toBe(5);
    expect(adapter.toDaySlots(wm(0))).toBe(0);
    expect(adapter.toDaySlots(wm(480))).toBe(1);
    expect(adapter.toDaySlots(wm(500))).toBe(1);
    expect(adapter.toDaySlots(wm(720))).toBe(2);
  });

  it("fromDaySlots matches existing daySlots * 480 behavior", () => {
    expect(adapter.fromDaySlots(wm(5))).toBe(d(5));
    expect(adapter.fromDaySlots(wm(0))).toBe(0);
    expect(adapter.fromDaySlots(wm(1))).toBe(480);
  });

  it("roundtrip: toDaySlots(fromDaySlots(n)) === n for integer day values", () => {
    for (const n of [0, 1, 5, 10, 100]) {
      expect(adapter.toDaySlots(adapter.fromDaySlots(wm(n)))).toBe(n);
    }
  });
});

// ─── DefaultCalendarIndexer (Phase B) ───────────────────────────────

describe("DefaultCalendarIndexer (Phase B)", () => {
  it("MON_FRI produces same weekend offsets as legacy generateNonWorkingDays", () => {
    const indexer = new DefaultCalendarIndexer(MON_FRI_CONFIG);
    const startDate = "2025-01-06"; // Monday
    const horizon = 14;

    const fromIndexer = indexer.indexNonWorkingDays(DEFAULT_CALENDAR_ID, startDate, horizon);
    const fromLegacy = generateNonWorkingDays(startDate, true, horizon);

    expect(fromIndexer).toEqual(fromLegacy);
  });

  it("ALL_DAYS produces no non-working days", () => {
    const indexer = new DefaultCalendarIndexer(ALL_DAYS_CONFIG);
    const result = indexer.indexNonWorkingDays(DEFAULT_CALENDAR_ID, "2025-01-06", 14);
    expect(result).toEqual([]);
  });

  it("ignores calendarId parameter in Phase B (single project calendar)", () => {
    const indexer = new DefaultCalendarIndexer(MON_FRI_CONFIG);
    const startDate = "2025-01-06";
    const horizon = 7;

    const a = indexer.indexNonWorkingDays(DEFAULT_CALENDAR_ID, startDate, horizon);
    const b = indexer.indexNonWorkingDays("custom-cal" as CalendarId, startDate, horizon);
    expect(a).toEqual(b);
  });

  it("MON_FRI + holidays blocks both weekends and holiday dates", () => {
    const indexer = new DefaultCalendarIndexer(HOLIDAYS_CONFIG);
    const nwd = indexer.indexNonWorkingDays(DEFAULT_CALENDAR_ID, "2025-01-06", 14);
    expect(nwd).toContain(0);  // Mon holiday
    expect(nwd).toContain(1);  // Tue holiday
    expect(nwd).toContain(5);  // Sat
    expect(nwd).toContain(6);  // Sun
    expect(nwd).not.toContain(2); // Wed = working day
  });

  it("ALL_DAYS + holidays blocks only holiday dates", () => {
    const config: CalendarConfig = {
      ...DEFAULT_CALENDAR_CONFIG,
      workingWeekPattern: "ALL_DAYS",
      holidays: ["2025-01-08"],
    };
    const indexer = new DefaultCalendarIndexer(config);
    const nwd = indexer.indexNonWorkingDays(DEFAULT_CALENDAR_ID, "2025-01-06", 7);
    expect(nwd).toEqual([2]);
    expect(nwd).not.toContain(5);
    expect(nwd).not.toContain(6);
  });

  it("compiled project calendar supports 6-day workweeks (Sunday non-working only)", () => {
    const sixDayCal = compileCalendar({
      id: "six-day" as CalendarId,
      name: "6-Day",
      weeklyPattern: {
        1: [{ startMinute: 480, endMinute: 1020 }],
        2: [{ startMinute: 480, endMinute: 1020 }],
        3: [{ startMinute: 480, endMinute: 1020 }],
        4: [{ startMinute: 480, endMinute: 1020 }],
        5: [{ startMinute: 480, endMinute: 1020 }],
        6: [{ startMinute: 480, endMinute: 1020 }],
      },
      exceptions: [],
    });

    const indexer = new DefaultCalendarIndexer(MON_FRI_CONFIG, sixDayCal);
    const nwd = indexer.indexNonWorkingDays("six-day" as CalendarId, "2025-01-06", 14);

    expect(nwd).toEqual([6, 13]);
  });

  it("holidays outside horizon are ignored", () => {
    const config: CalendarConfig = {
      ...DEFAULT_CALENDAR_CONFIG,
      workingWeekPattern: "ALL_DAYS",
      holidays: ["2026-06-01"],
    };
    const indexer = new DefaultCalendarIndexer(config);
    const nwd = indexer.indexNonWorkingDays(DEFAULT_CALENDAR_ID, "2025-01-06", 30);
    expect(nwd).toEqual([]);
  });
});

// ─── generateNonWorkingDaysFromConfig ───────────────────────────────

describe("generateNonWorkingDaysFromConfig", () => {
  it("MON_FRI without holidays matches legacy function", () => {
    const result = generateNonWorkingDaysFromConfig(MON_FRI_CONFIG, "2025-01-06", 14);
    const legacy = generateNonWorkingDays("2025-01-06", true, 14);
    expect(result).toEqual(legacy);
  });

  it("ALL_DAYS without holidays returns empty", () => {
    const result = generateNonWorkingDaysFromConfig(ALL_DAYS_CONFIG, "2025-01-06", 14);
    expect(result).toEqual([]);
  });

  it("holidays are merged with weekends and sorted", () => {
    const config: CalendarConfig = {
      ...DEFAULT_CALENDAR_CONFIG,
      workingWeekPattern: "MON_FRI",
      holidays: ["2025-01-08"],
    };
    const result = generateNonWorkingDaysFromConfig(config, "2025-01-06", 7);
    expect(result).toEqual([2, 5, 6]);
  });

  it("duplicate holiday on weekend does not create duplicate offset", () => {
    const config: CalendarConfig = {
      ...DEFAULT_CALENDAR_CONFIG,
      workingWeekPattern: "MON_FRI",
      holidays: ["2025-01-11"],
    };
    const result = generateNonWorkingDaysFromConfig(config, "2025-01-06", 7);
    expect(result).toEqual([5, 6]);
  });
});

// ─── Constraint Snapping ────────────────────────────────────────────

describe("Constraint snapping (Phase B)", () => {
  it("snapForward advances past non-working days", () => {
    const nwdSet = new Set([5, 6]);
    expect(snapForward(5, nwdSet)).toBe(7);
    expect(snapForward(6, nwdSet)).toBe(7);
  });

  it("snapForward returns same day if already working", () => {
    const nwdSet = new Set([5, 6]);
    expect(snapForward(3, nwdSet)).toBe(3);
  });

  it("snapBackward retreats past non-working days", () => {
    const nwdSet = new Set([5, 6]);
    expect(snapBackward(5, nwdSet)).toBe(4);
    expect(snapBackward(6, nwdSet)).toBe(4);
  });

  it("snapBackward returns same day if already working", () => {
    const nwdSet = new Set([5, 6]);
    expect(snapBackward(4, nwdSet)).toBe(4);
  });

  it("snapForward handles consecutive holidays", () => {
    const nwdSet = new Set([5, 6, 7]);
    expect(snapForward(5, nwdSet)).toBe(8);
  });

  it("snapBackward handles consecutive holidays", () => {
    const nwdSet = new Set([3, 4, 5, 6]);
    expect(snapBackward(6, nwdSet)).toBe(2);
  });
});

describe("Constraint snapping in buildScheduleRequest", () => {
  const nwd = [5, 6, 12, 13];
  const nwdSet = new Set(nwd);
  const translator = new SlotCoordinateTranslator({
    projectStartDate: "2025-01-06",
    minutesPerDay: MINUTES_PER_DAY,
    nwdSet,
  });

  it("SNET constraint on Saturday snaps forward to Monday", () => {
    const tasks: Task[] = [{
      id: "t1", name: "T1",
      durationWorkMinutes: d(2),
      siblingOrder: "a",
      constraintType: "SNET",
      constraintDateMinutes: d(5),
    }];
    const req = buildScheduleRequest(tasks, [], nwd, translator);
    expect(req.tasks[0].constraintDateMinutes).toBe(7);
  });

  it("MSO constraint on Sunday snaps forward to Monday", () => {
    const tasks: Task[] = [{
      id: "t1", name: "T1",
      durationWorkMinutes: d(2),
      siblingOrder: "a",
      constraintType: "MSO",
      constraintDateMinutes: d(6),
    }];
    const req = buildScheduleRequest(tasks, [], nwd, translator);
    expect(req.tasks[0].constraintDateMinutes).toBe(7);
  });

  it("FNLT constraint on Saturday snaps backward to Friday", () => {
    const tasks: Task[] = [{
      id: "t1", name: "T1",
      durationWorkMinutes: d(2),
      siblingOrder: "a",
      constraintType: "FNLT",
      constraintDateMinutes: d(5),
    }];
    const req = buildScheduleRequest(tasks, [], nwd, translator);
    expect(req.tasks[0].constraintDateMinutes).toBe(4);
  });

  it("MFO constraint on Sunday snaps backward to Friday", () => {
    const tasks: Task[] = [{
      id: "t1", name: "T1",
      durationWorkMinutes: d(2),
      siblingOrder: "a",
      constraintType: "MFO",
      constraintDateMinutes: d(6),
    }];
    const req = buildScheduleRequest(tasks, [], nwd, translator);
    expect(req.tasks[0].constraintDateMinutes).toBe(4);
  });

  it("ASAP constraint is not snapped (no date)", () => {
    const tasks: Task[] = [{
      id: "t1", name: "T1",
      durationWorkMinutes: d(2),
      siblingOrder: "a",
      constraintType: "ASAP",
    }];
    const req = buildScheduleRequest(tasks, [], nwd, translator);
    expect(req.tasks[0].constraintDateMinutes).toBeUndefined();
  });

  it("constraint on a working day is not snapped", () => {
    const tasks: Task[] = [{
      id: "t1", name: "T1",
      durationWorkMinutes: d(2),
      siblingOrder: "a",
      constraintType: "SNET",
      constraintDateMinutes: d(3),
    }];
    const req = buildScheduleRequest(tasks, [], nwd, translator);
    expect(req.tasks[0].constraintDateMinutes).toBe(3);
  });

  it("SNET constraint on holiday snaps forward past holiday", () => {
    const holidayNwd = [0, 5, 6];
    const holidayNwdSet = new Set(holidayNwd);
    const holidayTranslator = new SlotCoordinateTranslator({
      projectStartDate: "2025-01-06",
      minutesPerDay: MINUTES_PER_DAY,
      nwdSet: holidayNwdSet,
    });
    const tasks: Task[] = [{
      id: "t1", name: "T1",
      durationWorkMinutes: d(2),
      siblingOrder: "a",
      constraintType: "SNET",
      constraintDateMinutes: d(0),
    }];
    const req = buildScheduleRequest(tasks, [], holidayNwd, holidayTranslator);
    expect(req.tasks[0].constraintDateMinutes).toBe(1);
  });
});

// ─── DEFAULT_CALENDAR_CONFIG ────────────────────────────────────────

describe("DEFAULT_CALENDAR_CONFIG (Phase B)", () => {
  it("has correct shape", () => {
    expect(DEFAULT_CALENDAR_CONFIG.id).toBe(DEFAULT_CALENDAR_ID);
    expect(DEFAULT_CALENDAR_CONFIG.name).toBe("Standard (Mon–Fri, 8h)");
    expect(DEFAULT_CALENDAR_CONFIG.minutesPerDay).toBe(480);
    expect(DEFAULT_CALENDAR_CONFIG.workingWeekPattern).toBe("MON_FRI");
    expect(DEFAULT_CALENDAR_CONFIG.holidays).toEqual([]);
  });
});

// ─── createCalendarServices ─────────────────────────────────────────

describe("createCalendarServices (Phase B)", () => {
  it("returns coherent CalendarServices from MON_FRI config", () => {
    const services = createCalendarServices(MON_FRI_CONFIG);

    expect(services.resolver.projectCalendarId()).toBe(DEFAULT_CALENDAR_ID);
    expect(services.temporalAdapter.minutesPerDay).toBe(MINUTES_PER_DAY);

    const nwd = services.indexer.indexNonWorkingDays(
      services.resolver.projectCalendarId(),
      "2025-01-06",
      7,
    );
    expect(nwd.length).toBeGreaterThan(0);
  });

  it("ALL_DAYS config produces no non-working days from weekends", () => {
    const services = createCalendarServices(ALL_DAYS_CONFIG);
    const nwd = services.indexer.indexNonWorkingDays(
      services.resolver.projectCalendarId(),
      "2025-01-06",
      7,
    );
    expect(nwd).toEqual([]);
  });

  it("config with holidays blocks holiday offsets", () => {
    const services = createCalendarServices(HOLIDAYS_CONFIG);
    const nwd = services.indexer.indexNonWorkingDays(
      services.resolver.projectCalendarId(),
      "2025-01-06",
      7,
    );
    expect(nwd).toEqual([0, 1, 5, 6]);
  });
});

// ─── Behavior Preservation ──────────────────────────────────────────

describe("Phase B behavior preservation", () => {
  it("adapter toDaySlots matches inline toDaySlots used by buildScheduleRequest", () => {
    const adapter = new DefaultKernelTemporalAdapter();
    const inlineToDaySlots = (w: WorkMinutes): WorkMinutes =>
      Math.round(w / MINUTES_PER_DAY) as WorkMinutes;

    const testValues = [wm(0), wm(480), wm(960), wm(1440), wm(2400), wm(500), wm(720)];
    for (const v of testValues) {
      expect(adapter.toDaySlots(v)).toBe(inlineToDaySlots(v));
    }
  });

  it("adapter fromDaySlots matches inline multiplication used by rollup.ts", () => {
    const adapter = new DefaultKernelTemporalAdapter();
    const testValues = [wm(0), wm(1), wm(5), wm(10)];
    for (const v of testValues) {
      expect(adapter.fromDaySlots(v)).toBe(v * MINUTES_PER_DAY);
    }
  });
});

// ─── Summary Duration with Holidays ─────────────────────────────────

describe("Summary duration uses working-time index (Phase B)", () => {
  it("countWorkingDays excludes holidays from span", () => {
    const nwdSet = new Set([0, 1, 5, 6]);
    expect(countWorkingDays(0, 7, nwdSet)).toBe(3);
  });

  it("summary rollup duration reflects holidays in NWD set", () => {
    const adapter = new DefaultKernelTemporalAdapter();
    const nwdSet = new Set([0, 1, 5, 6]);

    const rows: VisibleRow[] = [
      {
        id: "s1", name: "Summary", durationWorkMinutes: d(0), siblingOrder: "a",
        depth: 0, isSummary: true, isCollapsed: false, canExpand: true, wbsCode: "1",
        rollupStartMinutes: null, rollupFinishMinutes: null, rollupDurationMinutes: null,
        rollupCost: null, rollupWorkMinutes: null, rollupPercentComplete: null,
      } as VisibleRow,
      {
        id: "c1", name: "Child1", durationWorkMinutes: d(1), siblingOrder: "a", parentId: "s1",
        depth: 1, isSummary: false, isCollapsed: false, canExpand: false, wbsCode: "1.1",
        rollupStartMinutes: null, rollupFinishMinutes: null, rollupDurationMinutes: null,
        rollupCost: null, rollupWorkMinutes: null, rollupPercentComplete: null,
      } as VisibleRow,
      {
        id: "c2", name: "Child2", durationWorkMinutes: d(1), siblingOrder: "b", parentId: "s1",
        depth: 1, isSummary: false, isCollapsed: false, canExpand: false, wbsCode: "1.2",
        rollupStartMinutes: null, rollupFinishMinutes: null, rollupDurationMinutes: null,
        rollupCost: null, rollupWorkMinutes: null, rollupPercentComplete: null,
      } as VisibleRow,
    ];

    const scheduleResults: ScheduleResultMap = {
      c1: {
        earlyStartMinutes: wm(2), earlyFinishMinutes: wm(3),
        lateStartMinutes: wm(2), lateFinishMinutes: wm(3),
        totalFloatMinutes: wm(0), isCritical: true,
      },
      c2: {
        earlyStartMinutes: wm(3), earlyFinishMinutes: wm(7),
        lateStartMinutes: wm(3), lateFinishMinutes: wm(7),
        totalFloatMinutes: wm(0), isCritical: true,
      },
    };

    const result = computeRollups(rows, scheduleResults, nwdSet, adapter.minutesPerDay as number);
    const summary = result.find(r => r.id === "s1")!;

    // Summary spans day-slots 2 to 7. Working days in [2, 7) with NWDs {0,1,5,6}:
    // Day 2=work, 3=work, 4=work, 5=NWD, 6=NWD → 3 working days
    expect(summary.rollupDurationMinutes).toBe(d(3));
    expect(summary.rollupStartMinutes).toBe(d(2));
    expect(summary.rollupFinishMinutes).toBe(d(7));
  });
});

// ─── State projectCalendar safety ─────────────────────────────────

describe("State projectCalendar (Phase B)", () => {
  beforeEach(() => {
    State.clearState();
  });

  it("getProjectCalendar returns DEFAULT_CALENDAR_CONFIG after clearState", () => {
    State.setProjectCalendar({ ...DEFAULT_CALENDAR_CONFIG, holidays: ["2025-12-25"] });
    State.clearState();
    expect(State.getProjectCalendar()).toEqual(DEFAULT_CALENDAR_CONFIG);
  });

  it("getExcludeWeekends derives from projectCalendar.workingWeekPattern", () => {
    expect(State.getExcludeWeekends()).toBe(true);
    State.setProjectCalendar({ ...DEFAULT_CALENDAR_CONFIG, workingWeekPattern: "ALL_DAYS" });
    expect(State.getExcludeWeekends()).toBe(false);
    State.setProjectCalendar({ ...DEFAULT_CALENDAR_CONFIG, workingWeekPattern: "MON_FRI" });
    expect(State.getExcludeWeekends()).toBe(true);
  });

  it("hydrateState synthesizes projectCalendar from excludeWeekends when absent", () => {
    State.hydrateState({
      projectStartDate: "2025-01-06",
      excludeWeekends: false,
      tasks: [],
      dependencies: [],
      baselines: {},
    });
    expect(State.getProjectCalendar().workingWeekPattern).toBe("ALL_DAYS");
    expect(State.getExcludeWeekends()).toBe(false);
  });

  it("hydrateState uses projectCalendar when present (ignores excludeWeekends)", () => {
    const customCalendar: CalendarConfig = {
      ...DEFAULT_CALENDAR_CONFIG,
      workingWeekPattern: "ALL_DAYS",
      holidays: ["2025-12-25"],
    };
    State.hydrateState({
      projectStartDate: "2025-01-06",
      excludeWeekends: true,
      projectCalendar: customCalendar,
      tasks: [],
      dependencies: [],
      baselines: {},
    });
    expect(State.getProjectCalendar()).toEqual(customCalendar);
    expect(State.getProjectCalendar().workingWeekPattern).toBe("ALL_DAYS");
    expect(State.getProjectCalendar().holidays).toEqual(["2025-12-25"]);
  });

  it("getCalendarId returns DEFAULT_CALENDAR_ID after clearState", () => {
    State.setCalendarId("custom" as CalendarId);
    State.clearState();
    expect(State.getCalendarId()).toBe(DEFAULT_CALENDAR_ID);
  });

  it("hydrateState defaults calendarId when missing", () => {
    State.hydrateState({
      projectStartDate: "2025-01-06",
      excludeWeekends: true,
      tasks: [],
      dependencies: [],
      baselines: {},
    });
    expect(State.getCalendarId()).toBe(DEFAULT_CALENDAR_ID);
  });

  it("hydrateState reads calendarId when present", () => {
    State.hydrateState({
      projectStartDate: "2025-01-06",
      excludeWeekends: true,
      calendarId: "project-cal" as CalendarId,
      tasks: [],
      dependencies: [],
      baselines: {},
    });
    expect(State.getCalendarId()).toBe("project-cal");
  });
});

// ─── Phase C: CalendarResolver with task lookup ─────────────────────

describe("DefaultCalendarResolver (Phase C)", () => {
  const projectCalId = DEFAULT_CALENDAR_ID;
  const customCalId = "custom-cal" as CalendarId;

  const mockTasks: Task[] = [
    { id: "t1", name: "T1", durationWorkMinutes: d(2), siblingOrder: "a" },
    { id: "t2", name: "T2", durationWorkMinutes: d(3), siblingOrder: "b", assignedCalendarId: customCalId },
  ];

  const findTask = (id: string) => mockTasks.find(t => t.id === id);
  const resolver = new DefaultCalendarResolver(findTask);

  it("resolveAssignedCalendar returns project calendar when task has no assignment", () => {
    expect(resolver.resolveAssignedCalendar("t1")).toBe(projectCalId);
  });

  it("resolveAssignedCalendar returns assigned calendar when task has one", () => {
    expect(resolver.resolveAssignedCalendar("t2")).toBe(customCalId);
  });

  it("resolveAssignedCalendar returns project calendar for unknown taskId", () => {
    expect(resolver.resolveAssignedCalendar("unknown")).toBe(projectCalId);
  });

  it("resolveComputationalCalendar always returns project calendar (Phase C invariant)", () => {
    expect(resolver.resolveComputationalCalendar("t1")).toBe(projectCalId);
    expect(resolver.resolveComputationalCalendar("t2")).toBe(projectCalId);
    expect(resolver.resolveComputationalCalendar("unknown")).toBe(projectCalId);
  });

  it("resolve() delegates to resolveComputationalCalendar for known task", () => {
    expect(resolver.resolve("t2")).toBe(projectCalId);
  });

  it("resolve() returns DEFAULT_CALENDAR_ID when no entityId provided", () => {
    expect(resolver.resolve()).toBe(projectCalId);
  });

  it("projectCalendarId always returns DEFAULT_CALENDAR_ID", () => {
    expect(resolver.projectCalendarId()).toBe(projectCalId);
  });
});

// ─── Phase C: createCalendarServices with findTask ──────────────────

describe("createCalendarServices (Phase C)", () => {
  it("resolver uses findTask when provided", () => {
    const customCalId = "task-cal" as CalendarId;
    const tasks: Task[] = [
      { id: "t1", name: "T1", durationWorkMinutes: d(1), siblingOrder: "a", assignedCalendarId: customCalId },
    ];
    const services = createCalendarServices(
      { ...DEFAULT_CALENDAR_CONFIG },
      DEFAULT_CALENDAR_ID,
      (id: string) => tasks.find(t => t.id === id),
    );
    expect(services.resolver.resolveAssignedCalendar("t1")).toBe(customCalId);
    expect(services.resolver.resolveComputationalCalendar("t1")).toBe(DEFAULT_CALENDAR_ID);
  });

  it("resolver falls back when findTask not provided", () => {
    const services = createCalendarServices({ ...DEFAULT_CALENDAR_CONFIG });
    expect(services.resolver.resolveAssignedCalendar("any")).toBe(DEFAULT_CALENDAR_ID);
    expect(services.resolver.resolveComputationalCalendar("any")).toBe(DEFAULT_CALENDAR_ID);
  });
});

// ─── Phase C: Task assignedCalendarId in State ──────────────────────

describe("State task assignedCalendarId (Phase C)", () => {
  beforeEach(() => {
    State.clearState();
  });

  it("updateTask sets assignedCalendarId", () => {
    const calId = "cal-A" as CalendarId;
    State.addTask({ id: "t1", name: "T1", durationWorkMinutes: d(1), siblingOrder: "a" });
    State.updateTask("t1", { assignedCalendarId: calId });
    expect(State.findTask("t1")?.assignedCalendarId).toBe(calId);
  });

  it("updateTask clears assignedCalendarId with null", () => {
    const calId = "cal-A" as CalendarId;
    State.addTask({ id: "t1", name: "T1", durationWorkMinutes: d(1), siblingOrder: "a", assignedCalendarId: calId });
    expect(State.findTask("t1")?.assignedCalendarId).toBe(calId);
    State.updateTask("t1", { assignedCalendarId: null });
    expect(State.findTask("t1")?.assignedCalendarId).toBeUndefined();
  });

  it("assignedCalendarId survives snapshot/restore", () => {
    const calId = "cal-A" as CalendarId;
    State.addTask({ id: "t1", name: "T1", durationWorkMinutes: d(1), siblingOrder: "a", assignedCalendarId: calId });
    const snapshot = State.createSnapshot();
    State.updateTask("t1", { assignedCalendarId: null });
    expect(State.findTask("t1")?.assignedCalendarId).toBeUndefined();
    State.restoreSnapshot(snapshot);
    expect(State.findTask("t1")?.assignedCalendarId).toBe(calId);
  });
});

// ─── Phase C: Calendars dictionary in State ─────────────────────────

describe("State calendars dictionary (Phase C)", () => {
  beforeEach(() => {
    State.clearState();
  });

  it("getCalendars returns empty after clearState", () => {
    expect(State.getCalendars()).toEqual({});
  });

  it("setCalendars/getCalendars round-trip", () => {
    const calId = "night-shift" as CalendarId;
    const cal: CalendarConfig = {
      ...DEFAULT_CALENDAR_CONFIG,
      id: calId,
      name: "Night Shift",
      workingWeekPattern: "ALL_DAYS",
      holidays: ["2025-12-25"],
    };
    State.setCalendars({ [calId]: cal });
    expect(State.getCalendars()[calId]).toEqual(cal);
  });

  it("getCalendarConfig returns calendar by id", () => {
    const calId = "custom" as CalendarId;
    const cal: CalendarConfig = { ...DEFAULT_CALENDAR_CONFIG, id: calId, name: "Custom" };
    State.setCalendars({ [calId]: cal });
    expect(State.getCalendarConfig(calId)).toEqual(cal);
    expect(State.getCalendarConfig("nonexistent" as CalendarId)).toBeUndefined();
  });

  it("clearState resets calendars to empty", () => {
    State.setCalendars({ x: DEFAULT_CALENDAR_CONFIG });
    State.clearState();
    expect(State.getCalendars()).toEqual({});
  });

  it("hydrateState loads calendars when present", () => {
    const calId = "imported" as CalendarId;
    const cal: CalendarConfig = { ...DEFAULT_CALENDAR_CONFIG, id: calId, name: "Imported" };
    State.hydrateState({
      projectStartDate: "2025-01-06",
      excludeWeekends: true,
      calendars: { [calId]: cal },
      tasks: [],
      dependencies: [],
      baselines: {},
    });
    expect(State.getCalendars()[calId]).toEqual(cal);
  });

  it("hydrateState defaults calendars to empty when absent", () => {
    State.hydrateState({
      projectStartDate: "2025-01-06",
      excludeWeekends: true,
      tasks: [],
      dependencies: [],
      baselines: {},
    });
    expect(State.getCalendars()).toEqual({});
  });
});

// ─── Phase C: Hierarchy calendar projection ─────────────────────────

describe("Hierarchy calendar projection (Phase C)", () => {
  it("stamps computationalCalendarId via resolver", () => {
    const tasks: Task[] = [
      { id: "t1", name: "T1", durationWorkMinutes: d(1), siblingOrder: "a" },
    ];
    const resolver = new DefaultCalendarResolver((id) => tasks.find(t => t.id === id));
    const rows: VisibleRow[] = buildFullProjection(tasks, resolver);
    expect(rows[0].computationalCalendarId).toBe(DEFAULT_CALENDAR_ID);
    expect(rows[0].assignedCalendarId).toBeUndefined();
    expect(rows[0].calendarWarnings).toBeUndefined();
  });

  it("produces CALENDAR_DIVERGENCE warning when assigned != computational", () => {
    const customCalId = "custom-cal" as CalendarId;
    const tasks: Task[] = [
      { id: "t1", name: "T1", durationWorkMinutes: d(1), siblingOrder: "a", assignedCalendarId: customCalId },
    ];
    const resolver = new DefaultCalendarResolver((id) => tasks.find(t => t.id === id));
    const rows: VisibleRow[] = buildFullProjection(tasks, resolver);
    expect(rows[0].assignedCalendarId).toBe(customCalId);
    expect(rows[0].computationalCalendarId).toBe(DEFAULT_CALENDAR_ID);
    expect(rows[0].calendarWarnings).toEqual(["CALENDAR_DIVERGENCE"]);
  });

  it("no warning when task uses project calendar (assignedCalendarId undefined)", () => {
    const tasks: Task[] = [
      { id: "t1", name: "T1", durationWorkMinutes: d(1), siblingOrder: "a" },
    ];
    const resolver = new DefaultCalendarResolver((id) => tasks.find(t => t.id === id));
    const rows: VisibleRow[] = buildFullProjection(tasks, resolver);
    expect(rows[0].calendarWarnings).toBeUndefined();
  });

  it("without resolver, Phase C fields are undefined (backward compat)", () => {
    const tasks: Task[] = [
      { id: "t1", name: "T1", durationWorkMinutes: d(1), siblingOrder: "a" },
    ];
    const rows: VisibleRow[] = buildFullProjection(tasks);
    expect(rows[0].computationalCalendarId).toBeUndefined();
    expect(rows[0].calendarWarnings).toBeUndefined();
  });
});

// ─── Track A Step 6: computeMinutesPerDay ───────────────────────────

describe("computeMinutesPerDay (Step 6)", () => {
  it("STANDARD_CALENDAR yields 480 (identical to MINUTES_PER_DAY)", () => {
    const compiled = compileCalendar(STANDARD_CALENDAR);
    expect(computeMinutesPerDay(compiled)).toBe(480);
  });

  it("uniform 6h/day calendar yields 360", () => {
    const sixHourDef: import("@planner/protocol").BaseCalendarDefinition = {
      id: "6h" as import("@planner/protocol").CalendarId,
      name: "6h",
      weeklyPattern: {
        1: [{ startMinute: 480, endMinute: 840 }],
        2: [{ startMinute: 480, endMinute: 840 }],
        3: [{ startMinute: 480, endMinute: 840 }],
        4: [{ startMinute: 480, endMinute: 840 }],
        5: [{ startMinute: 480, endMinute: 840 }],
      },
      exceptions: [],
    };
    const compiled = compileCalendar(sixHourDef);
    expect(computeMinutesPerDay(compiled)).toBe(360);
  });

  it("mixed-length working days returns rounded average", () => {
    const mixedDef: import("@planner/protocol").BaseCalendarDefinition = {
      id: "mixed" as import("@planner/protocol").CalendarId,
      name: "Mixed",
      weeklyPattern: {
        1: [{ startMinute: 480, endMinute: 960 }], // 480 min (8h)
        2: [{ startMinute: 480, endMinute: 960 }], // 480 min
        3: [{ startMinute: 480, endMinute: 960 }], // 480 min
        4: [{ startMinute: 480, endMinute: 960 }], // 480 min
        5: [{ startMinute: 480, endMinute: 720 }], // 240 min (4h — half Friday)
      },
      exceptions: [],
    };
    const compiled = compileCalendar(mixedDef);
    // (480*4 + 240) / 5 = 2160/5 = 432
    expect(computeMinutesPerDay(compiled)).toBe(432);
  });

  it("all-zero calendar falls back to MINUTES_PER_DAY (480)", () => {
    const emptyDef: import("@planner/protocol").BaseCalendarDefinition = {
      id: "empty" as import("@planner/protocol").CalendarId,
      name: "Empty",
      weeklyPattern: {},
      exceptions: [],
    };
    const compiled = compileCalendar(emptyDef);
    expect(computeMinutesPerDay(compiled)).toBe(MINUTES_PER_DAY);
  });
});

// ─── Track A Step 6: CalendarBackedTemporalAdapter ──────────────────

describe("CalendarBackedTemporalAdapter (Step 6)", () => {
  it("matches DefaultKernelTemporalAdapter for STANDARD_CALENDAR", () => {
    const compiled = compileCalendar(STANDARD_CALENDAR);
    const trackA = new CalendarBackedTemporalAdapter(compiled);
    const legacy = new DefaultKernelTemporalAdapter();

    expect(trackA.minutesPerDay).toBe(legacy.minutesPerDay);

    const testValues = [wm(0), wm(480), wm(960), wm(1440), wm(2400), wm(500), wm(720)];
    for (const v of testValues) {
      expect(trackA.toDaySlots(v)).toBe(legacy.toDaySlots(v));
      expect(trackA.fromDaySlots(v)).toBe(legacy.fromDaySlots(v));
    }
  });

  it("uses derived minutesPerDay for custom calendar", () => {
    const sixHourDef: import("@planner/protocol").BaseCalendarDefinition = {
      id: "6h" as import("@planner/protocol").CalendarId,
      name: "6h",
      weeklyPattern: {
        1: [{ startMinute: 480, endMinute: 840 }],
        2: [{ startMinute: 480, endMinute: 840 }],
        3: [{ startMinute: 480, endMinute: 840 }],
        4: [{ startMinute: 480, endMinute: 840 }],
        5: [{ startMinute: 480, endMinute: 840 }],
      },
      exceptions: [],
    };
    const compiled = compileCalendar(sixHourDef);
    const adapter = new CalendarBackedTemporalAdapter(compiled);

    expect(adapter.minutesPerDay).toBe(360);
    expect(adapter.toDaySlots(wm(360))).toBe(1);
    expect(adapter.toDaySlots(wm(720))).toBe(2);
    expect(adapter.fromDaySlots(wm(3))).toBe(1080);
  });

  it("roundtrip: toDaySlots(fromDaySlots(n)) === n for integer values", () => {
    const compiled = compileCalendar(STANDARD_CALENDAR);
    const adapter = new CalendarBackedTemporalAdapter(compiled);
    for (const n of [0, 1, 5, 10, 100]) {
      expect(adapter.toDaySlots(adapter.fromDaySlots(wm(n)))).toBe(n);
    }
  });
});

// ─── Track A Step 6: createTrackACalendarServices ───────────────────

describe("createTrackACalendarServices (Step 6)", () => {
  it("produces identical minutesPerDay to legacy factory for default definitions", () => {
    const definitions = { [DEFAULT_CALENDAR_ID]: STANDARD_CALENDAR };
    const services = createTrackACalendarServices(
      MON_FRI_CONFIG,
      definitions,
      DEFAULT_CALENDAR_ID,
    );
    expect(services.temporalAdapter.minutesPerDay).toBe(MINUTES_PER_DAY);
  });

  it("resolver and indexer behave same as legacy createCalendarServices", () => {
    const definitions = { [DEFAULT_CALENDAR_ID]: STANDARD_CALENDAR };
    const trackA = createTrackACalendarServices(
      MON_FRI_CONFIG,
      definitions,
      DEFAULT_CALENDAR_ID,
    );
    const legacy = createCalendarServices(MON_FRI_CONFIG);

    expect(trackA.resolver.projectCalendarId()).toBe(legacy.resolver.projectCalendarId());

    const nwdA = trackA.indexer.indexNonWorkingDays(DEFAULT_CALENDAR_ID, "2025-01-06", 14);
    const nwdL = legacy.indexer.indexNonWorkingDays(DEFAULT_CALENDAR_ID, "2025-01-06", 14);
    expect(nwdA).toEqual(nwdL);
  });

  it("resolver projectCalendarId reflects the provided project calendar id", () => {
    const customCalId = "custom-project" as CalendarId;
    const customDef: import("@planner/protocol").BaseCalendarDefinition = {
      id: customCalId,
      name: "Custom Project",
      weeklyPattern: {
        0: [{ startMinute: 480, endMinute: 1020 }],
        1: [{ startMinute: 480, endMinute: 1020 }],
        2: [{ startMinute: 480, endMinute: 1020 }],
        3: [{ startMinute: 480, endMinute: 1020 }],
        4: [{ startMinute: 480, endMinute: 1020 }],
        5: [{ startMinute: 480, endMinute: 1020 }],
        6: [{ startMinute: 480, endMinute: 1020 }],
      },
      exceptions: [],
    };
    const services = createTrackACalendarServices(
      ALL_DAYS_CONFIG,
      {
        [DEFAULT_CALENDAR_ID]: STANDARD_CALENDAR,
        [customCalId]: customDef,
      },
      customCalId,
    );

    expect(services.resolver.projectCalendarId()).toBe(customCalId);
  });

  it("falls back to standard calendar when projectCalendarId is missing from definitions", () => {
    const definitions = { [DEFAULT_CALENDAR_ID]: STANDARD_CALENDAR };
    const services = createTrackACalendarServices(
      MON_FRI_CONFIG,
      definitions,
      "nonexistent" as import("@planner/protocol").CalendarId,
    );
    // Falls back to registry.getDefault() → STANDARD_CALENDAR → 480
    expect(services.temporalAdapter.minutesPerDay).toBe(480);
  });

  it("derives minutesPerDay from a custom project calendar definition", () => {
    const customCalId = "short-day" as import("@planner/protocol").CalendarId;
    const shortDayDef: import("@planner/protocol").BaseCalendarDefinition = {
      id: customCalId,
      name: "Short Day",
      weeklyPattern: {
        1: [{ startMinute: 540, endMinute: 840 }], // 300 min (5h)
        2: [{ startMinute: 540, endMinute: 840 }],
        3: [{ startMinute: 540, endMinute: 840 }],
        4: [{ startMinute: 540, endMinute: 840 }],
        5: [{ startMinute: 540, endMinute: 840 }],
      },
      exceptions: [],
    };
    const definitions = {
      [DEFAULT_CALENDAR_ID]: STANDARD_CALENDAR,
      [customCalId]: shortDayDef,
    };
    const services = createTrackACalendarServices(
      MON_FRI_CONFIG,
      definitions,
      customCalId,
    );
    expect(services.temporalAdapter.minutesPerDay).toBe(300);
  });

  it("passes findTask to resolver for assigned calendar resolution", () => {
    const customCalId = "custom" as import("@planner/protocol").CalendarId;
    const tasks: Task[] = [
      { id: "t1", name: "T1", durationWorkMinutes: d(1), siblingOrder: "a", assignedCalendarId: customCalId },
    ];
    const definitions = { [DEFAULT_CALENDAR_ID]: STANDARD_CALENDAR };
    const services = createTrackACalendarServices(
      MON_FRI_CONFIG,
      definitions,
      DEFAULT_CALENDAR_ID,
      (id: string) => tasks.find(t => t.id === id),
    );
    expect(services.resolver.resolveAssignedCalendar("t1")).toBe(customCalId);
    expect(services.resolver.resolveComputationalCalendar("t1")).toBe(DEFAULT_CALENDAR_ID);
  });

  it("empty definitions still works (registry seeds STANDARD_CALENDAR)", () => {
    const services = createTrackACalendarServices(
      MON_FRI_CONFIG,
      {},
      DEFAULT_CALENDAR_ID,
    );
    // CalendarRegistry always seeds STANDARD_CALENDAR at DEFAULT_CALENDAR_ID
    expect(services.temporalAdapter.minutesPerDay).toBe(480);
  });
});
