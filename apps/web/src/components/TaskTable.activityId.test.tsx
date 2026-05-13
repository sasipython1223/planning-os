import type { ScheduleResultMap, VarianceMap, VisibleRow, WorkMinutes } from "@planner/protocol";
import { MINUTES_PER_DAY } from "@planner/protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TaskTable } from "./TaskTable";

const wm = (n: number) => n as WorkMinutes;

function row(overrides: Partial<VisibleRow>): VisibleRow {
  return {
    id: "task-1",
    name: "Task",
    durationWorkMinutes: wm(1 * MINUTES_PER_DAY),
    siblingOrder: "V",
    depth: 0,
    isSummary: false,
    isCollapsed: false,
    canExpand: false,
    wbsCode: "1",
    rollupStartMinutes: null,
    rollupFinishMinutes: null,
    rollupDurationMinutes: null,
    rollupCost: null,
    rollupWorkMinutes: null,
    rollupPercentComplete: null,
    ...overrides,
  };
}

describe("TaskTable Activity ID rendering", () => {
  it("does not render legacy in-header chooser glyph text and exposes resize handles", () => {
    const tasks: VisibleRow[] = [
      row({
        id: "leaf-plain-1",
        sourceActivityId: "A-1",
      }),
    ];

    const html = renderToStaticMarkup(
      <TaskTable
        tasks={tasks}
        scheduleResults={{}}
        variances={{}}
        onUpdateTask={() => {}}
        scrollTop={0}
        viewportHeight={400}
        projectStartDate="2026-01-01"
        selectedTaskId={null}
        onSelectTask={() => {}}
        onToggleCollapse={() => {}}
      />,
    );

    expect(html).toContain("task-table-col-resize-handle");
    expect(html).not.toContain("\\u2699");
    expect(html).not.toContain("task-table-col-picker-btn");
  });

  it("keeps Act ID path free of hierarchy tree-prefix rendering", () => {
    const tasks: VisibleRow[] = [
      row({
        id: "sum-owned-1",
        name: "Phase 1",
        isSummary: true,
        canExpand: true,
      }),
      row({
        id: "leaf-owned-1",
        parentId: "sum-owned-1",
        depth: 1,
        sourceActivityId: "A100",
        name: "Leaf Activity",
      }),
    ];

    const html = renderToStaticMarkup(
      <TaskTable
        tasks={tasks}
        scheduleResults={{}}
        variances={{}}
        onUpdateTask={() => {}}
        scrollTop={0}
        viewportHeight={400}
        projectStartDate="2026-01-01"
        selectedTaskId={null}
        onSelectTask={() => {}}
        onToggleCollapse={() => {}}
      />,
    );

    expect(html).not.toContain("data-col-key=\"diag\"");
    expect(html).not.toContain("task-cell-status");
    expect(html).not.toContain("task-tree-prefix");
  });

  it("renders structural summary rows with blank Activity ID even when they have no child activities", () => {
    const tasks: VisibleRow[] = [
      row({
        id: "wbs-zero-1",
        name: "Lonely WBS",
        isSummary: true,
        canExpand: false,
        sourceActivityId: undefined,
      }),
    ];

    const html = renderToStaticMarkup(
      <TaskTable
        tasks={tasks}
        scheduleResults={{}}
        variances={{}}
        onUpdateTask={() => {}}
        scrollTop={0}
        viewportHeight={400}
        projectStartDate="2026-01-01"
        selectedTaskId={null}
        onSelectTask={() => {}}
        onToggleCollapse={() => {}}
      />,
    );

    expect(html).toContain("colSpan=\"2\"");
    expect(html).not.toContain("task-activity-id-text");
  });

  it("renders activityCode before sourceActivityId for activity rows", () => {
    const tasks: VisibleRow[] = [
      row({
        id: "manual-activity-1",
        activityCode: "A1000",
        sourceActivityId: "IMP-100",
        name: "Manual Activity",
      }),
    ];

    const html = renderToStaticMarkup(
      <TaskTable
        tasks={tasks}
        scheduleResults={{}}
        variances={{}}
        onUpdateTask={() => {}}
        scrollTop={0}
        viewportHeight={400}
        projectStartDate="2026-01-01"
        selectedTaskId={null}
        onSelectTask={() => {}}
        onToggleCollapse={() => {}}
      />,
    );

    expect(html).toContain("A1000");
    expect(html).not.toContain("IMP-100");
  });

  it("renders MSP numeric Activity ID values in activity rows", () => {
    const tasks: VisibleRow[] = [
      row({
        id: "uuid-msp-1",
        sourceActivityId: "17",
        name: "MSP Imported Activity",
      }),
    ];

    const html = renderToStaticMarkup(
      <TaskTable
        tasks={tasks}
        scheduleResults={{}}
        variances={{}}
        onUpdateTask={() => {}}
        scrollTop={0}
        viewportHeight={400}
        projectStartDate="2026-01-01"
        selectedTaskId={null}
        onSelectTask={() => {}}
        onToggleCollapse={() => {}}
      />,
    );

    expect(html).toContain("17");
  });

  it("renders sourceActivityId for imported activity rows and falls back to empty text", () => {
    const tasks: VisibleRow[] = [
      row({
        id: "uuid-1",
        sourceActivityId: "A100",
        name: "Imported Activity",
      }),
      row({
        id: "uuid-2",
        sourceActivityId: undefined,
        name: "Native Activity",
      }),
    ];

    const scheduleResults: ScheduleResultMap = {};
    const variances: VarianceMap = {};

    const html = renderToStaticMarkup(
      <TaskTable
        tasks={tasks}
        scheduleResults={scheduleResults}
        variances={variances}
        onUpdateTask={() => {}}
        scrollTop={0}
        viewportHeight={400}
        projectStartDate="2026-01-01"
        selectedTaskId={null}
        onSelectTask={() => {}}
        onToggleCollapse={() => {}}
      />,
    );

    expect(html).toContain("A100");
    expect(html).not.toContain("uuid-2");
    expect(html).not.toContain("task-disclosure-slot");
  });

  it("keeps summary rows on merged identity rendering with blank Activity ID text", () => {
    const tasks: VisibleRow[] = [
      row({
        id: "sum-1",
        sourceActivityId: "SUM-1",
        name: "Summary",
        isSummary: true,
        canExpand: true,
      }),
      row({
        id: "leaf-1",
        sourceActivityId: "A200",
        parentId: "sum-1",
        depth: 1,
        name: "Child Activity",
      }),
    ];

    const scheduleResults: ScheduleResultMap = {};
    const variances: VarianceMap = {};

    const html = renderToStaticMarkup(
      <TaskTable
        tasks={tasks}
        scheduleResults={scheduleResults}
        variances={variances}
        onUpdateTask={() => {}}
        scrollTop={0}
        viewportHeight={400}
        projectStartDate="2026-01-01"
        selectedTaskId={null}
        onSelectTask={() => {}}
        onToggleCollapse={() => {}}
      />,
    );

    const activityIdTextOccurrences = (html.match(/task-activity-id-text/g) ?? []).length;
    expect(activityIdTextOccurrences).toBe(1);
    expect(html).not.toContain("SUM-1");
    expect(html).toContain("colSpan=\"2\"");
  });
});
