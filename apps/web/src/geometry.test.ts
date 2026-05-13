import type { ScheduleResultMap, Task, VisibleRow, WorkMinutes } from "@planner/protocol";
import { MINUTES_PER_DAY } from "@planner/protocol";
import { describe, expect, it } from "vitest";
import { TABLE_WIDTH, TASK_COLUMN_REGISTRY } from "./components/TaskTable";
import { previewDuration, previewEarlyStart } from "./components/gantt/dragPreview";
import {
    BAR_HEIGHT,
    BAR_VERTICAL_PADDING,
    DAY_WIDTH,
    ROW_HEIGHT,
    TIMESCALE_HEIGHT,
} from "./components/gantt/ganttConstants";
import { computeTaskGeometry } from "./components/gantt/ganttGeometry";
import { hitTestBar } from "./components/gantt/hitTest";
import type { TimescaleModel } from "./components/gantt/timescaleModel";
import { GEOMETRY } from "./constants/geometry";
import { computeVirtualWindow } from "./hooks/useVirtualWindow";

function createMockTimescaleModel(offset: number, unitWidth: number): TimescaleModel {
  return {
    profile: {
      id: "week-day",
      label: "Week / Day",
      tiers: [{ tier: "week" }, { tier: "day" }],
      gridUnit: "day",
      pixelsPerDay: unitWidth,
      showNonWorkingDayShading: true,
      labelMode: "calendar",
    },
    projectStartDate: "2026-01-01",
    zoomPreset: { id: "day", pixelsPerDay: unitWidth, majorTickEveryDays: 1 },
    unitWidth,
    totalWidth: 1000,
    scrollLeft: 0,
    viewportWidth: 400,
    maxDay: 100,
    visibleStartDay: 0,
    visibleEndDay: 10,
    visibleStart: new Date("2026-01-01T00:00:00.000Z"),
    visibleEnd: new Date("2026-01-11T00:00:00.000Z"),
    headerTiers: [],
    ticks: [],
    gridLines: [],
    dateToX: (day: number) => offset + day * unitWidth,
    xToDay: (x: number) => (x - offset) / unitWidth,
    spanWidth: (startDay: number, finishDay: number) => (finishDay - startDay) * unitWidth,
    spanToX: (startDay: number, finishDay: number) => ({
      x: offset + startDay * unitWidth,
      width: (finishDay - startDay) * unitWidth,
    }),
  };
}

describe("Geometry Constants Module", () => {
  it("ganttConstants derive from GEOMETRY", () => {
    expect(ROW_HEIGHT).toBe(GEOMETRY.ROW_HEIGHT);
    expect(BAR_HEIGHT).toBe(GEOMETRY.BAR_HEIGHT);
    expect(TIMESCALE_HEIGHT).toBe(GEOMETRY.HEADER_HEIGHT);
    expect(DAY_WIDTH).toBe(GEOMETRY.DAY_WIDTH);
  });

  it("BAR_VERTICAL_PADDING centers bar within row", () => {
    expect(BAR_VERTICAL_PADDING).toBe((GEOMETRY.ROW_HEIGHT - GEOMETRY.BAR_HEIGHT) / 2);
  });
});

describe("Virtualization uses GEOMETRY.ROW_HEIGHT", () => {
  it("totalHeight equals tasks.length * ROW_HEIGHT", () => {
    const { totalHeight } = computeVirtualWindow(10, ROW_HEIGHT, 0, 400);
    expect(totalHeight).toBe(10 * GEOMETRY.ROW_HEIGHT);
  });

  it("startIndex derived from ROW_HEIGHT", () => {
    // scrollTop = 120, ROW_HEIGHT = 40 → raw index 3, minus overscan
    const { startIndex } = computeVirtualWindow(20, ROW_HEIGHT, 120, 200);
    expect(startIndex).toBe(0); // 3 - 3 overscan = 0
  });

  it("phantom height for 0 tasks is 0", () => {
    const { totalHeight } = computeVirtualWindow(0, ROW_HEIGHT, 0, 400);
    expect(totalHeight).toBe(0);
  });
});

describe("Gantt geometry uses ROW_HEIGHT and BAR_HEIGHT", () => {
  const tasks: Task[] = [
    { id: "A", name: "Task A", durationWorkMinutes: (5 * MINUTES_PER_DAY) as WorkMinutes, siblingOrder: "V" },
    { id: "B", name: "Task B", durationWorkMinutes: (3 * MINUTES_PER_DAY) as WorkMinutes, siblingOrder: "V" },
  ];
  const scheduleResults: ScheduleResultMap = {
    A: { earlyStartMinutes: 0 as WorkMinutes, earlyFinishMinutes: 5 as WorkMinutes, lateStartMinutes: 0 as WorkMinutes, lateFinishMinutes: 5 as WorkMinutes, totalFloatMinutes: 0 as WorkMinutes, isCritical: true },
    B: { earlyStartMinutes: 5 as WorkMinutes, earlyFinishMinutes: 8 as WorkMinutes, lateStartMinutes: 5 as WorkMinutes, lateFinishMinutes: 8 as WorkMinutes, totalFloatMinutes: 0 as WorkMinutes, isCritical: true },
  };

  it("bar Y position uses ROW_HEIGHT + BAR_VERTICAL_PADDING", () => {
    const geom = computeTaskGeometry(tasks, scheduleResults);
    const a = geom.get("A")!;
    expect(a.y).toBe(0 * GEOMETRY.ROW_HEIGHT + BAR_VERTICAL_PADDING);
    const b = geom.get("B")!;
    expect(b.y).toBe(1 * GEOMETRY.ROW_HEIGHT + BAR_VERTICAL_PADDING);
  });

  it("bar height equals GEOMETRY.BAR_HEIGHT", () => {
    const geom = computeTaskGeometry(tasks, scheduleResults);
    expect(geom.get("A")!.height).toBe(GEOMETRY.BAR_HEIGHT);
    expect(geom.get("B")!.height).toBe(GEOMETRY.BAR_HEIGHT);
  });

  it("centerY is at row midpoint", () => {
    const geom = computeTaskGeometry(tasks, scheduleResults);
    const a = geom.get("A")!;
    // centerY = y + height/2 = BAR_VERTICAL_PADDING + BAR_HEIGHT/2 = ROW_HEIGHT/2
    expect(a.centerY).toBe(a.y + GEOMETRY.BAR_HEIGHT / 2);
    expect(a.centerY).toBe(GEOMETRY.ROW_HEIGHT / 2);
  });

  it("uses timescaleModel span mapping when provided", () => {
    const model = createMockTimescaleModel(7, DAY_WIDTH);
    const geom = computeTaskGeometry(tasks, scheduleResults, model);
    const a = geom.get("A")!;
    expect(a.x).toBe(7);
    expect(a.width).toBe(5 * DAY_WIDTH);
  });
});

describe("Interaction math respects shared timescale mapping", () => {
  const tasks: Task[] = [
    { id: "A", name: "Task A", durationWorkMinutes: (5 * MINUTES_PER_DAY) as WorkMinutes, siblingOrder: "V" },
  ];
  const scheduleResults: ScheduleResultMap = {
    A: {
      earlyStartMinutes: 0 as WorkMinutes,
      earlyFinishMinutes: 5 as WorkMinutes,
      lateStartMinutes: 0 as WorkMinutes,
      lateFinishMinutes: 5 as WorkMinutes,
      totalFloatMinutes: 0 as WorkMinutes,
      isCritical: true,
    },
  };

  it("hitTestBar uses model span mapping when available", () => {
    const model = createMockTimescaleModel(7, DAY_WIDTH);
    const hit = hitTestBar(13, BAR_VERTICAL_PADDING + BAR_HEIGHT / 2, tasks as unknown as VisibleRow[], scheduleResults, model);
    expect(hit.zone).toBe("bar");
    expect(hit.taskId).toBe("A");
  });

  it("preview helpers use model xToDay when available", () => {
    const drag = {
      active: true,
      taskId: "A",
      mode: "move" as const,
      initialWorldX: 19,
      currentWorldX: 42,
      initialDuration: 5,
      initialEarlyStart: 3,
    };
    const model = {
      xToDay: (x: number) => x / 8,
    } as Pick<TimescaleModel, "xToDay">;

    expect(previewDuration(drag, model)).toBe(8);
    expect(previewEarlyStart(drag, model)).toBe(6);
  });
});

describe("Dependency anchor centerY derived from ROW_HEIGHT", () => {
  it("centerY for row 0 equals ROW_HEIGHT / 2", () => {
    const tasks: Task[] = [
      { id: "A", name: "A", durationWorkMinutes: (5 * MINUTES_PER_DAY) as WorkMinutes, siblingOrder: "V" },
    ];
    const sched: ScheduleResultMap = {
      A: { earlyStartMinutes: 0 as WorkMinutes, earlyFinishMinutes: 5 as WorkMinutes, lateStartMinutes: 0 as WorkMinutes, lateFinishMinutes: 5 as WorkMinutes, totalFloatMinutes: 0 as WorkMinutes, isCritical: true },
    };
    const geom = computeTaskGeometry(tasks, sched);
    expect(geom.get("A")!.centerY).toBe(GEOMETRY.ROW_HEIGHT / 2);
  });

  it("centerY for row N equals N * ROW_HEIGHT + ROW_HEIGHT / 2", () => {
    const tasks: Task[] = [
      { id: "A", name: "A", durationWorkMinutes: (5 * MINUTES_PER_DAY) as WorkMinutes, siblingOrder: "V" },
      { id: "B", name: "B", durationWorkMinutes: (3 * MINUTES_PER_DAY) as WorkMinutes, siblingOrder: "V" },
      { id: "C", name: "C", durationWorkMinutes: (2 * MINUTES_PER_DAY) as WorkMinutes, siblingOrder: "V" },
    ];
    const sched: ScheduleResultMap = {
      A: { earlyStartMinutes: 0 as WorkMinutes, earlyFinishMinutes: 5 as WorkMinutes, lateStartMinutes: 0 as WorkMinutes, lateFinishMinutes: 5 as WorkMinutes, totalFloatMinutes: 0 as WorkMinutes, isCritical: true },
      B: { earlyStartMinutes: 5 as WorkMinutes, earlyFinishMinutes: 8 as WorkMinutes, lateStartMinutes: 5 as WorkMinutes, lateFinishMinutes: 8 as WorkMinutes, totalFloatMinutes: 0 as WorkMinutes, isCritical: true },
      C: { earlyStartMinutes: 8 as WorkMinutes, earlyFinishMinutes: 10 as WorkMinutes, lateStartMinutes: 8 as WorkMinutes, lateFinishMinutes: 10 as WorkMinutes, totalFloatMinutes: 0 as WorkMinutes, isCritical: true },
    };
    const geom = computeTaskGeometry(tasks, sched);
    expect(geom.get("C")!.centerY).toBe(2 * GEOMETRY.ROW_HEIGHT + GEOMETRY.ROW_HEIGHT / 2);
  });
});

describe("Changing GEOMETRY.ROW_HEIGHT realigns all math", () => {
  it("BAR_VERTICAL_PADDING adjusts with ROW_HEIGHT", () => {
    // This is a compile-time relationship test:
    // BAR_VERTICAL_PADDING = (ROW_HEIGHT - BAR_HEIGHT) / 2
    expect(BAR_VERTICAL_PADDING * 2 + BAR_HEIGHT).toBe(ROW_HEIGHT);
  });
});

describe("TaskTable TASK_COLUMN_REGISTRY", () => {
  it("TABLE_WIDTH equals sum of all column widths", () => {
    const sum = TASK_COLUMN_REGISTRY.reduce((s, c) => s + c.width, 0);
    expect(TABLE_WIDTH).toBe(sum);
  });

  it("every column has a positive pixel width", () => {
    for (const col of TASK_COLUMN_REGISTRY) {
      expect(col.width).toBeGreaterThan(0);
    }
  });

  it("every column has a unique key", () => {
    const keys = TASK_COLUMN_REGISTRY.map((c) => c.id);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("compact labels are short enough to avoid wrapping", () => {
    for (const col of TASK_COLUMN_REGISTRY) {
      expect(col.label.length).toBeLessThanOrEqual(6);
    }
  });

  it("schema has expected column order", () => {
    const keys = TASK_COLUMN_REGISTRY.map((c) => c.id);
    expect(keys).toEqual(["wbs", "id", "task", "duration", "start", "finish", "tf", "ct", "cd", "sv", "fv", "dv", "act-start", "act-finish", "rem-dur", "act-dur", "phys-pct", "dur-pct", "units-pct", "pct-comp"]);
  });

  it("first visible columns keep structural band then left-aligned activity identity then description", () => {
    expect(TASK_COLUMN_REGISTRY[0].id).toBe("wbs");
    expect(TASK_COLUMN_REGISTRY[0].align).toBe("left");
    expect(TASK_COLUMN_REGISTRY[1].id).toBe("id");
    expect(TASK_COLUMN_REGISTRY[1].align).toBe("left");
    expect(TASK_COLUMN_REGISTRY[2].align).toBe("left"); // task/Desc
    expect(TASK_COLUMN_REGISTRY[3].align).toBe("right"); // duration
  });

  it("every column has a tier", () => {
    for (const col of TASK_COLUMN_REGISTRY) {
      expect(["A", "B", "C"]).toContain(col.tier);
    }
  });
});
