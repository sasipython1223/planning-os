import type { BaseCalendarDefinition, CalendarAssignmentState, CalendarId, TimeInterval } from "@planner/protocol";
import { DEFAULT_CALENDAR_ID } from "@planner/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { CalendarRegistry } from "../src/calendarRegistry.js";
import {
    resolveCalendarIdForTask,
    resolveCompiledCalendarForTask,
} from "../src/calendarResolution.js";

// ─── Helpers ────────────────────────────────────────────────────────

const iv = (startMinute: number, endMinute: number): TimeInterval => ({
  startMinute,
  endMinute,
});

/** Build a minimal Mon–Fri calendar definition. */
function weekdayCal(
  id: string,
  intervals: readonly TimeInterval[],
): BaseCalendarDefinition {
  return {
    id: id as CalendarId,
    name: id,
    weeklyPattern: {
      1: intervals,
      2: intervals,
      3: intervals,
      4: intervals,
      5: intervals,
    },
    exceptions: [],
  };
}

/** Build a CalendarAssignmentState from partials. */
function makeState(overrides: Partial<CalendarAssignmentState> = {}): CalendarAssignmentState {
  return {
    projectCalendarId: DEFAULT_CALENDAR_ID,
    taskCalendarIds: {},
    resourceCalendarIds: {},
    ...overrides,
  };
}

const NIGHT_SHIFT_ID = "night-shift" as CalendarId;
const CUSTOM_ID = "custom-cal" as CalendarId;
const NONEXISTENT_ID = "does-not-exist" as CalendarId;

// ─── resolveCalendarIdForTask ───────────────────────────────────────

describe("resolveCalendarIdForTask", () => {
  it("returns task assignment when present", () => {
    const state = makeState({
      taskCalendarIds: { T1: NIGHT_SHIFT_ID },
    });
    expect(resolveCalendarIdForTask("T1", state)).toBe(NIGHT_SHIFT_ID);
  });

  it("returns project calendar when task has no assignment", () => {
    const state = makeState({
      projectCalendarId: CUSTOM_ID,
      taskCalendarIds: {},
    });
    expect(resolveCalendarIdForTask("T1", state)).toBe(CUSTOM_ID);
  });

  it("returns DEFAULT_CALENDAR_ID when neither task nor project overrides", () => {
    const state = makeState();
    expect(resolveCalendarIdForTask("T1", state)).toBe(DEFAULT_CALENDAR_ID);
  });

  it("task assignment wins over project calendar", () => {
    const state = makeState({
      projectCalendarId: CUSTOM_ID,
      taskCalendarIds: { T1: NIGHT_SHIFT_ID },
    });
    expect(resolveCalendarIdForTask("T1", state)).toBe(NIGHT_SHIFT_ID);
  });

  it("different tasks resolve independently", () => {
    const state = makeState({
      projectCalendarId: CUSTOM_ID,
      taskCalendarIds: { T1: NIGHT_SHIFT_ID },
    });
    expect(resolveCalendarIdForTask("T1", state)).toBe(NIGHT_SHIFT_ID);
    expect(resolveCalendarIdForTask("T2", state)).toBe(CUSTOM_ID);
  });

  it("deterministic with empty assignment maps", () => {
    const state = makeState({
      taskCalendarIds: {},
      resourceCalendarIds: {},
    });
    expect(resolveCalendarIdForTask("T1", state)).toBe(DEFAULT_CALENDAR_ID);
    expect(resolveCalendarIdForTask("T2", state)).toBe(DEFAULT_CALENDAR_ID);
  });
});

// ─── resolveCompiledCalendarForTask ─────────────────────────────────

describe("resolveCompiledCalendarForTask", () => {
  let registry: CalendarRegistry;
  const nightShift = weekdayCal("night-shift", [iv(1200, 1440)]);
  const customCal = weekdayCal("custom-cal", [iv(480, 600)]);

  beforeEach(() => {
    registry = new CalendarRegistry();
    registry.rebuild({
      "night-shift": nightShift,
      "custom-cal": customCal,
    });
  });

  it("returns compiled calendar for assigned task", () => {
    const state = makeState({
      taskCalendarIds: { T1: NIGHT_SHIFT_ID },
    });
    const compiled = resolveCompiledCalendarForTask("T1", state, registry);
    expect(compiled.id).toBe(NIGHT_SHIFT_ID);
    expect(compiled.weeklyMinutes).toBe(5 * 240);
  });

  it("returns project calendar when task has no assignment", () => {
    const state = makeState({
      projectCalendarId: CUSTOM_ID,
    });
    const compiled = resolveCompiledCalendarForTask("T1", state, registry);
    expect(compiled.id).toBe(CUSTOM_ID);
    expect(compiled.weeklyMinutes).toBe(5 * 120);
  });

  it("returns default calendar when neither assignment nor project override", () => {
    const state = makeState();
    const compiled = resolveCompiledCalendarForTask("T1", state, registry);
    expect(compiled.id).toBe(DEFAULT_CALENDAR_ID);
    expect(compiled.weeklyMinutes).toBe(2400);
  });

  it("falls back to default when assigned calendar ID is missing from registry", () => {
    const state = makeState({
      taskCalendarIds: { T1: NONEXISTENT_ID },
    });
    const compiled = resolveCompiledCalendarForTask("T1", state, registry);
    // Should not crash — falls back to default
    expect(compiled.id).toBe(DEFAULT_CALENDAR_ID);
    expect(compiled.weeklyMinutes).toBe(2400);
  });

  it("falls back to default when project calendar ID is missing from registry", () => {
    const state = makeState({
      projectCalendarId: NONEXISTENT_ID,
    });
    const compiled = resolveCompiledCalendarForTask("T1", state, registry);
    expect(compiled.id).toBe(DEFAULT_CALENDAR_ID);
    expect(compiled.weeklyMinutes).toBe(2400);
  });

  it("task assignment wins over project calendar for compiled lookup", () => {
    const state = makeState({
      projectCalendarId: CUSTOM_ID,
      taskCalendarIds: { T1: NIGHT_SHIFT_ID },
    });
    const compiled = resolveCompiledCalendarForTask("T1", state, registry);
    expect(compiled.id).toBe(NIGHT_SHIFT_ID);
  });

  it("returns valid compiled calendar shape", () => {
    const state = makeState();
    const compiled = resolveCompiledCalendarForTask("T1", state, registry);
    expect(compiled.weeklyPattern).toHaveLength(7);
    expect(compiled.dailyMinutes).toHaveLength(7);
    expect(compiled.exceptionsByDate).toBeInstanceOf(Map);
    expect(typeof compiled.weeklyMinutes).toBe("number");
  });

  it("deterministic with empty maps and empty registry rebuild", () => {
    const emptyRegistry = new CalendarRegistry();
    emptyRegistry.rebuild({});
    const state = makeState();

    const compiled = resolveCompiledCalendarForTask("T1", state, emptyRegistry);
    expect(compiled.id).toBe(DEFAULT_CALENDAR_ID);
    expect(compiled.weeklyMinutes).toBe(2400);
  });
});
