/**
 * W3C Calendar Inheritance Resolver Tests
 *
 * Verifies:
 * 1. XER child calendar retains parentCalendarId from base_clndr_id
 * 2. MSP child calendar retains parentCalendarId from BaseCalendarUID
 * 3. Resolver merges parent weekday/time blocks into child
 * 4. Child weekday overrides parent
 * 5. Exceptions combined (parent + child, child wins same date)
 * 6. Missing parent emits UNRESOLVED_BASE_CALENDAR diagnostic
 * 7. Circular reference emits CALENDAR_INHERITANCE_LOOP warning
 * 8. ImportCandidate carries resolvedCalendarDefinitions
 * 9. Calendarless project: resolvedCalendarDefinitions is empty object
 */

import type { BaseCalendarDefinition, CalendarId, WeeklyWorkPattern } from "@planner/protocol";
import { describe, expect, it } from "vitest";
import { resolveCalendarInheritance } from "../../src/import/mappers/calendarInheritance.js";
import { mapMspToCanonical } from "../../src/import/mappers/mspMapper.js";
import { mapXerToCanonical } from "../../src/import/mappers/xerMapper.js";
import type { MspCalendar, MspData } from "../../src/import/types/mspTypes.js";
import type { XerCalendar, XerData } from "../../src/import/types/xerTypes.js";

// ─── Helpers ────────────────────────────────────────────────────────

function makeCalDef(
  id: string,
  weeklyPattern: WeeklyWorkPattern,
  parentCalendarId?: string,
): BaseCalendarDefinition {
  return {
    id: id as CalendarId,
    name: `Calendar ${id}`,
    weeklyPattern,
    exceptions: [],
    ...(parentCalendarId !== undefined ? { parentCalendarId: parentCalendarId as CalendarId } : {}),
  };
}

const MON_FRI_PATTERN: WeeklyWorkPattern = {
  1: [{ startMinute: 480, endMinute: 1020 }],
  2: [{ startMinute: 480, endMinute: 1020 }],
  3: [{ startMinute: 480, endMinute: 1020 }],
  4: [{ startMinute: 480, endMinute: 1020 }],
  5: [{ startMinute: 480, endMinute: 1020 }],
};

const FULL_WEEK_PATTERN: WeeklyWorkPattern = {
  0: [{ startMinute: 480, endMinute: 1020 }],
  1: [{ startMinute: 480, endMinute: 1020 }],
  2: [{ startMinute: 480, endMinute: 1020 }],
  3: [{ startMinute: 480, endMinute: 1020 }],
  4: [{ startMinute: 480, endMinute: 1020 }],
  5: [{ startMinute: 480, endMinute: 1020 }],
  6: [{ startMinute: 480, endMinute: 1020 }],
};

// Minimal XER helpers

function baseXerData(calendars: XerCalendar[]): XerData {
  return {
    projects: [{ proj_id: "P1", proj_short_name: "Test", plan_start_date: "2024-01-01", day_hr_cnt: "8" }],
    calendars,
    tasks: [],
    taskPreds: [],
    wbs: [{ wbs_id: "WBS1", proj_id: "P1", wbs_name: "Root WBS", wbs_short_name: "ROOT", parent_wbs_id: "" }],
    resources: [],
    taskRsrcs: [],
  };
}

function makeXerCal(id: string, name: string, baseClndrId?: string): XerCalendar {
  return {
    clndr_id: id,
    clndr_name: name,
    clndr_data: "",
    ...(baseClndrId !== undefined && baseClndrId !== "" ? { base_clndr_id: baseClndrId } : {}),
  };
}

// Minimal MSP helpers

function makeMspCal(uid: string, name: string, baseCalUID?: string): MspCalendar {
  return {
    uid,
    name,
    baseCalendarUID: baseCalUID ?? "-1",
    isBaseCalendar: baseCalUID === undefined || baseCalUID === "-1" ? "1" : "0",
    weekDays: [],
    exceptions: [],
  };
}

function baseMspData(calendars: MspCalendar[]): MspData {
  return {
    project: { name: "Test Project", startDate: "2024-01-15T08:00:00", minutesPerDay: "480" },
    tasks: [],
    resources: [],
    assignments: [],
    calendars,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("W3C: calendarInheritance resolver", () => {

  it("returns empty result when no calendars provided", () => {
    const result = resolveCalendarInheritance({} as Record<CalendarId, BaseCalendarDefinition>);
    expect(result.resolvedCount).toBe(0);
    expect(result.unresolvedCount).toBe(0);
    expect(result.diagnostics).toHaveLength(0);
    expect(Object.keys(result.resolvedDefinitions)).toHaveLength(0);
  });

  it("passes through root calendars (no parent) unchanged", () => {
    const defs = {
      "C1": makeCalDef("C1", MON_FRI_PATTERN),
    } as unknown as Record<CalendarId, BaseCalendarDefinition>;

    const result = resolveCalendarInheritance(defs);
    expect(result.resolvedCount).toBe(0); // no inheritance to resolve
    expect(result.unresolvedCount).toBe(0);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.resolvedDefinitions["C1" as CalendarId]).toBeDefined();
    expect(result.resolvedDefinitions["C1" as CalendarId].id).toBe("C1");
  });

  it("child inherits parent weekdays that child does not define", () => {
    // Parent: Mon-Fri work days
    // Child: only defines Mon (shorter hours) — should inherit Tue-Fri from parent
    const parentPattern: WeeklyWorkPattern = {
      1: [{ startMinute: 480, endMinute: 1020 }],
      2: [{ startMinute: 480, endMinute: 1020 }],
      3: [{ startMinute: 480, endMinute: 1020 }],
      4: [{ startMinute: 480, endMinute: 1020 }],
      5: [{ startMinute: 480, endMinute: 1020 }],
    };
    const childPattern: WeeklyWorkPattern = {
      1: [{ startMinute: 480, endMinute: 720 }], // Monday only, shorter
    };

    const defs = {
      "PARENT": makeCalDef("PARENT", parentPattern),
      "CHILD": makeCalDef("CHILD", childPattern, "PARENT"),
    } as unknown as Record<CalendarId, BaseCalendarDefinition>;

    const result = resolveCalendarInheritance(defs);
    const resolved = result.resolvedDefinitions["CHILD" as CalendarId];
    expect(resolved).toBeDefined();
    expect(resolved.id).toBe("CHILD");
    // Monday from child (shorter)
    expect(resolved.weeklyPattern[1]).toEqual([{ startMinute: 480, endMinute: 720 }]);
    // Tuesday-Friday inherited from parent
    expect(resolved.weeklyPattern[2]).toEqual([{ startMinute: 480, endMinute: 1020 }]);
    expect(resolved.weeklyPattern[3]).toEqual([{ startMinute: 480, endMinute: 1020 }]);
    expect(resolved.weeklyPattern[4]).toEqual([{ startMinute: 480, endMinute: 1020 }]);
    expect(resolved.weeklyPattern[5]).toEqual([{ startMinute: 480, endMinute: 1020 }]);
    // Saturday/Sunday not in parent or child
    expect(resolved.weeklyPattern[0]).toBeUndefined();
    expect(resolved.weeklyPattern[6]).toBeUndefined();
  });

  it("child overrides parent when same weekday is defined", () => {
    const parentPattern: WeeklyWorkPattern = {
      1: [{ startMinute: 480, endMinute: 1020 }], // Mon 8:00-17:00
    };
    const childPattern: WeeklyWorkPattern = {
      1: [{ startMinute: 540, endMinute: 960 }], // Mon 9:00-16:00
    };

    const defs = {
      "PARENT": makeCalDef("PARENT", parentPattern),
      "CHILD": makeCalDef("CHILD", childPattern, "PARENT"),
    } as unknown as Record<CalendarId, BaseCalendarDefinition>;

    const result = resolveCalendarInheritance(defs);
    const resolved = result.resolvedDefinitions["CHILD" as CalendarId];
    expect(resolved.weeklyPattern[1]).toEqual([{ startMinute: 540, endMinute: 960 }]);
  });

  it("merges exceptions: parent exceptions inherited, child overrides same date", () => {
    const parentCal: BaseCalendarDefinition = {
      id: "PARENT" as CalendarId,
      name: "Parent",
      weeklyPattern: MON_FRI_PATTERN,
      exceptions: [
        { date: "2024-07-04", workIntervals: [] }, // parent holiday
        { date: "2024-12-25", workIntervals: [] }, // parent holiday
      ],
    };
    const childCal: BaseCalendarDefinition = {
      id: "CHILD" as CalendarId,
      name: "Child",
      weeklyPattern: {},
      exceptions: [
        { date: "2024-07-04", workIntervals: [{ startMinute: 480, endMinute: 720 }] }, // child works half-day
        { date: "2024-11-28", workIntervals: [] }, // child-only holiday
      ],
      parentCalendarId: "PARENT" as CalendarId,
    };

    const defs = {
      "PARENT": parentCal,
      "CHILD": childCal,
    } as Record<CalendarId, BaseCalendarDefinition>;

    const result = resolveCalendarInheritance(defs);
    const resolved = result.resolvedDefinitions["CHILD" as CalendarId];
    const exceptions = resolved.exceptions;

    // 2024-07-04: child overrides parent
    const july4 = exceptions.find(e => e.date === "2024-07-04");
    expect(july4).toBeDefined();
    expect(july4!.workIntervals).toEqual([{ startMinute: 480, endMinute: 720 }]);

    // 2024-12-25: inherited from parent
    const dec25 = exceptions.find(e => e.date === "2024-12-25");
    expect(dec25).toBeDefined();
    expect(dec25!.workIntervals).toEqual([]);

    // 2024-11-28: child-only
    const nov28 = exceptions.find(e => e.date === "2024-11-28");
    expect(nov28).toBeDefined();
  });

  it("missing parent emits UNRESOLVED_BASE_CALENDAR diagnostic and uses child as-is", () => {
    const defs = {
      "CHILD": makeCalDef("CHILD", MON_FRI_PATTERN, "MISSING_PARENT"),
    } as unknown as Record<CalendarId, BaseCalendarDefinition>;

    const result = resolveCalendarInheritance(defs);
    expect(result.unresolvedCount).toBe(1);

    const diag = result.diagnostics.find(d => d.code === "UNRESOLVED_BASE_CALENDAR");
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe("info");

    // Child is still returned as-is
    const resolved = result.resolvedDefinitions["CHILD" as CalendarId];
    expect(resolved).toBeDefined();
    expect(resolved.id).toBe("CHILD");
  });

  it("circular reference emits CALENDAR_INHERITANCE_LOOP warning and uses child as-is", () => {
    const calA: BaseCalendarDefinition = {
      id: "CAL_A" as CalendarId,
      name: "Calendar A",
      weeklyPattern: MON_FRI_PATTERN,
      exceptions: [],
      parentCalendarId: "CAL_B" as CalendarId,
    };
    const calB: BaseCalendarDefinition = {
      id: "CAL_B" as CalendarId,
      name: "Calendar B",
      weeklyPattern: {},
      exceptions: [],
      parentCalendarId: "CAL_A" as CalendarId, // circular!
    };

    const defs = {
      "CAL_A": calA,
      "CAL_B": calB,
    } as Record<CalendarId, BaseCalendarDefinition>;

    const result = resolveCalendarInheritance(defs);

    const loopDiag = result.diagnostics.find(d => d.code === "CALENDAR_INHERITANCE_LOOP");
    expect(loopDiag).toBeDefined();
    expect(loopDiag!.severity).toBe("warning");

    // Both calendars should still appear in resolved (as-is)
    expect(result.resolvedDefinitions["CAL_A" as CalendarId]).toBeDefined();
    expect(result.resolvedDefinitions["CAL_B" as CalendarId]).toBeDefined();
  });

  it("multi-level inheritance: grandchild inherits from grandparent via parent", () => {
    const grandParent: WeeklyWorkPattern = {
      0: [{ startMinute: 480, endMinute: 1020 }], // Sunday
      1: [{ startMinute: 480, endMinute: 1020 }],
      2: [{ startMinute: 480, endMinute: 1020 }],
    };
    const parent: WeeklyWorkPattern = {
      1: [{ startMinute: 540, endMinute: 960 }], // override Monday
    };
    const child: WeeklyWorkPattern = {
      // only inherits
    };

    const defs = {
      "GP": makeCalDef("GP", grandParent),
      "P": makeCalDef("P", parent, "GP"),
      "C": makeCalDef("C", child, "P"),
    } as unknown as Record<CalendarId, BaseCalendarDefinition>;

    const result = resolveCalendarInheritance(defs);
    const resolved = result.resolvedDefinitions["C" as CalendarId];

    // Sunday from grandparent
    expect(resolved.weeklyPattern[0]).toEqual([{ startMinute: 480, endMinute: 1020 }]);
    // Monday: parent overrode grandparent, child inherits parent's version
    expect(resolved.weeklyPattern[1]).toEqual([{ startMinute: 540, endMinute: 960 }]);
    // Tuesday from grandparent
    expect(resolved.weeklyPattern[2]).toEqual([{ startMinute: 480, endMinute: 1020 }]);
  });

  it("resolved definition preserves child id, name, and parentCalendarId", () => {
    const defs = {
      "PARENT": makeCalDef("PARENT", MON_FRI_PATTERN),
      "CHILD": makeCalDef("CHILD", {}, "PARENT"),
    } as unknown as Record<CalendarId, BaseCalendarDefinition>;

    const result = resolveCalendarInheritance(defs);
    const resolved = result.resolvedDefinitions["CHILD" as CalendarId];
    expect(resolved.id).toBe("CHILD");
    expect(resolved.name).toBe("Calendar CHILD");
    expect(resolved.parentCalendarId).toBe("PARENT");
  });

  it("resolvedCount tracks number of calendars with inheritance successfully resolved", () => {
    const defs = {
      "ROOT": makeCalDef("ROOT", MON_FRI_PATTERN),
      "CHILD1": makeCalDef("CHILD1", {}, "ROOT"),
      "CHILD2": makeCalDef("CHILD2", {}, "ROOT"),
    } as unknown as Record<CalendarId, BaseCalendarDefinition>;

    const result = resolveCalendarInheritance(defs);
    expect(result.resolvedCount).toBe(2);
    expect(result.unresolvedCount).toBe(0);
  });

});

// ─── XER mapper: parentCalendarId wiring ───────────────────────────

describe("W3C: XER mapper preserves parentCalendarId", () => {

  it("child calendar has parentCalendarId set from base_clndr_id", () => {
    const calendars: XerCalendar[] = [
      makeXerCal("C1", "Standard 5-Day", ""),       // root
      makeXerCal("C2", "Night Shift", "C1"),         // child of C1
    ];
    const data = baseXerData(calendars);
    const result = mapXerToCanonical(data);
    const defs = result.calendarDefinitions;
    expect(defs).toBeDefined();
    const c1 = defs!["C1" as CalendarId];
    const c2 = defs!["C2" as CalendarId];
    expect(c1.parentCalendarId).toBeUndefined();
    expect(c2.parentCalendarId).toBe("C1");
  });

  it("XER mapper resolvedCalendarDefinitions is populated", () => {
    const calendars: XerCalendar[] = [
      makeXerCal("C1", "Base", ""),
      makeXerCal("C2", "Derived", "C1"),
    ];
    const data = baseXerData(calendars);
    const result = mapXerToCanonical(data);
    expect(result.resolvedCalendarDefinitions).toBeDefined();
    expect(Object.keys(result.resolvedCalendarDefinitions!)).toContain("C1");
    expect(Object.keys(result.resolvedCalendarDefinitions!)).toContain("C2");
  });

  it("XER mapper calendarFidelity includes unresolvedInheritanceCount when all parents present", () => {
    const calendars: XerCalendar[] = [
      makeXerCal("C1", "Base", ""),
      makeXerCal("C2", "Derived", "C1"),
    ];
    const data = baseXerData(calendars);
    const result = mapXerToCanonical(data);
    // All parents present → unresolvedInheritanceCount should be 0 or absent
    const fidelity = result.calendarFidelity;
    expect(fidelity).toBeDefined();
    expect(fidelity?.unresolvedInheritanceCount ?? 0).toBe(0);
  });

  it("XER mapper calendarFidelity reports unresolved when base calendar is missing", () => {
    const calendars: XerCalendar[] = [
      makeXerCal("C2", "Derived", "MISSING_C1"), // parent doesn't exist
    ];
    const data = baseXerData(calendars);
    const result = mapXerToCanonical(data);
    expect(result.calendarFidelity?.unresolvedInheritanceCount).toBeGreaterThanOrEqual(1);
    const diags = result.diagnostics;
    expect(diags.some(d => d.code === "UNRESOLVED_BASE_CALENDAR")).toBe(true);
  });

});

// ─── MSP mapper: parentCalendarId wiring ───────────────────────────

describe("W3C: MSP mapper preserves parentCalendarId", () => {

  it("MSP child calendar has parentCalendarId set from BaseCalendarUID", () => {
    const calendars: MspCalendar[] = [
      makeMspCal("1", "Standard"),
      makeMspCal("2", "Night Shift", "1"),
    ];
    const data = baseMspData(calendars);
    const result = mapMspToCanonical(data);
    const defs = result.calendarDefinitions;
    expect(defs).toBeDefined();
    const c1 = defs!["1" as CalendarId];
    const c2 = defs!["2" as CalendarId];
    expect(c1.parentCalendarId).toBeUndefined();
    expect(c2.parentCalendarId).toBe("1");
  });

  it("MSP mapper resolvedCalendarDefinitions is populated", () => {
    const calendars: MspCalendar[] = [
      makeMspCal("1", "Base"),
      makeMspCal("2", "Derived", "1"),
    ];
    const data = baseMspData(calendars);
    const result = mapMspToCanonical(data);
    expect(result.resolvedCalendarDefinitions).toBeDefined();
    expect(Object.keys(result.resolvedCalendarDefinitions!)).toContain("1");
    expect(Object.keys(result.resolvedCalendarDefinitions!)).toContain("2");
  });

  it("MSP mapper calendarFidelity includes unresolvedInheritanceCount for missing parent", () => {
    const calendars: MspCalendar[] = [
      makeMspCal("2", "Derived", "999"), // parent doesn't exist
    ];
    const data = baseMspData(calendars);
    const result = mapMspToCanonical(data);
    expect(result.calendarFidelity?.unresolvedInheritanceCount).toBeGreaterThanOrEqual(1);
  });

});
