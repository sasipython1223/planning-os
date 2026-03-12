import type { ScheduleResultMap, Task } from "protocol";
import { describe, expect, it } from "vitest";
import { COLUMN_SCHEMA, TABLE_WIDTH } from "./components/TaskTable";
import {
    BAR_HEIGHT,
    BAR_VERTICAL_PADDING,
    DAY_WIDTH,
    ROW_HEIGHT,
    TIMESCALE_HEIGHT,
} from "./components/gantt/ganttConstants";
import { computeTaskGeometry } from "./components/gantt/ganttGeometry";
import { GEOMETRY } from "./constants/geometry";
import { computeVirtualWindow } from "./hooks/useVirtualWindow";

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
    { id: "A", name: "Task A", duration: 5, depth: 0, isSummary: false },
    { id: "B", name: "Task B", duration: 3, depth: 0, isSummary: false },
  ];
  const scheduleResults: ScheduleResultMap = {
    A: { earlyStart: 0, earlyFinish: 5, lateStart: 0, lateFinish: 5, totalFloat: 0, isCritical: true },
    B: { earlyStart: 5, earlyFinish: 8, lateStart: 5, lateFinish: 8, totalFloat: 0, isCritical: true },
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
});

describe("Dependency anchor centerY derived from ROW_HEIGHT", () => {
  it("centerY for row 0 equals ROW_HEIGHT / 2", () => {
    const tasks: Task[] = [
      { id: "A", name: "A", duration: 5, depth: 0, isSummary: false },
    ];
    const sched: ScheduleResultMap = {
      A: { earlyStart: 0, earlyFinish: 5, lateStart: 0, lateFinish: 5, totalFloat: 0, isCritical: true },
    };
    const geom = computeTaskGeometry(tasks, sched);
    expect(geom.get("A")!.centerY).toBe(GEOMETRY.ROW_HEIGHT / 2);
  });

  it("centerY for row N equals N * ROW_HEIGHT + ROW_HEIGHT / 2", () => {
    const tasks: Task[] = [
      { id: "A", name: "A", duration: 5, depth: 0, isSummary: false },
      { id: "B", name: "B", duration: 3, depth: 0, isSummary: false },
      { id: "C", name: "C", duration: 2, depth: 0, isSummary: false },
    ];
    const sched: ScheduleResultMap = {
      A: { earlyStart: 0, earlyFinish: 5, lateStart: 0, lateFinish: 5, totalFloat: 0, isCritical: true },
      B: { earlyStart: 5, earlyFinish: 8, lateStart: 5, lateFinish: 8, totalFloat: 0, isCritical: true },
      C: { earlyStart: 8, earlyFinish: 10, lateStart: 8, lateFinish: 10, totalFloat: 0, isCritical: true },
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

describe("TaskTable COLUMN_SCHEMA", () => {
  it("TABLE_WIDTH equals sum of all column widths", () => {
    const sum = COLUMN_SCHEMA.reduce((s, c) => s + c.width, 0);
    expect(TABLE_WIDTH).toBe(sum);
  });

  it("every column has a positive pixel width", () => {
    for (const col of COLUMN_SCHEMA) {
      expect(col.width).toBeGreaterThan(0);
    }
  });

  it("every column has a unique key", () => {
    const keys = COLUMN_SCHEMA.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("compact labels are short enough to avoid wrapping", () => {
    for (const col of COLUMN_SCHEMA) {
      expect(col.label.length).toBeLessThanOrEqual(6);
    }
  });

  it("schema has expected column order", () => {
    const keys = COLUMN_SCHEMA.map((c) => c.key);
    expect(keys).toEqual(["task", "duration", "start", "finish", "tf", "sv", "fv", "dv"]);
  });

  it("first column is left-aligned, rest are center-aligned", () => {
    expect(COLUMN_SCHEMA[0].align).toBe("left");
    for (let i = 1; i < COLUMN_SCHEMA.length; i++) {
      expect(COLUMN_SCHEMA[i].align).toBe("center");
    }
  });
});
