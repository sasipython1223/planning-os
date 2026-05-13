import type { Dependency, DiagnosticsMap, ScheduleResultMap, Task, VarianceMap, VisibleRow, WorkMinutes } from "@planner/protocol";
import { MINUTES_PER_DAY } from "@planner/protocol";
import { describe, expect, it } from "vitest";
import { buildScheduleSnapshot } from "./scheduleSnapshot";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<Task> & { id: string; name: string }): Task {
  return {
    durationWorkMinutes: (5 * MINUTES_PER_DAY) as WorkMinutes,
    siblingOrder: "a",
    ...overrides,
  };
}

function makeRow(task: Task, overrides: Partial<VisibleRow> = {}): VisibleRow {
  return {
    ...task,
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

function makeResult(
  earlyStart: number,
  earlyFinish: number,
  lateStart: number,
  lateFinish: number,
  totalFloat: number,
  isCritical: boolean,
) {
  return {
    earlyStartMinutes: earlyStart as WorkMinutes,
    earlyFinishMinutes: earlyFinish as WorkMinutes,
    lateStartMinutes: lateStart as WorkMinutes,
    lateFinishMinutes: lateFinish as WorkMinutes,
    totalFloatMinutes: totalFloat as WorkMinutes,
    isCritical,
  };
}

const NO_DEPS: Dependency[] = [];
const NO_DIAGS: DiagnosticsMap = {};
const NO_VARIANCES: VarianceMap = {};
const PROJECT_START = "2026-01-01";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("buildScheduleSnapshot", () => {
  it("returns zero counts for empty schedule", () => {
    const snap = buildScheduleSnapshot([], [], NO_DEPS, {}, NO_DIAGS, PROJECT_START, NO_VARIANCES);
    expect(snap.taskCount).toBe(0);
    expect(snap.dependencyCount).toBe(0);
    expect(snap.scheduledCount).toBe(0);
    expect(snap.criticalCount).toBe(0);
    expect(snap.tasks).toHaveLength(0);
    expect(snap.criticalTasks).toHaveLength(0);
    expect(snap.milestones).toHaveLength(0);
    expect(snap.missingLogicCandidates).toHaveLength(0);
    expect(snap.longDurationCandidates).toHaveLength(0);
    expect(snap.diagnosticsSummary).toHaveLength(0);
    expect(snap.projectStartDate).toBe(PROJECT_START);
  });

  it("counts tasks, deps, and scheduled tasks correctly", () => {
    const t1 = makeTask({ id: "t1", name: "Task 1" });
    const t2 = makeTask({ id: "t2", name: "Task 2" });
    const dep: Dependency = { id: "d1", predId: "t1", succId: "t2", type: "FS", lagWorkMinutes: 0 as WorkMinutes };
    const results: ScheduleResultMap = { t1: makeResult(0, 2400, 0, 2400, 0, true) };

    const snap = buildScheduleSnapshot(
      [t1, t2],
      [makeRow(t1, { wbsCode: "1" }), makeRow(t2, { wbsCode: "2" })],
      [dep],
      results,
      NO_DIAGS,
      PROJECT_START,
      NO_VARIANCES,
    );

    expect(snap.taskCount).toBe(2);
    expect(snap.dependencyCount).toBe(1);
    expect(snap.scheduledCount).toBe(1);
    expect(snap.criticalCount).toBe(1);
  });

  it("populates criticalTasks for tasks with isCritical = true", () => {
    const t1 = makeTask({ id: "t1", name: "Critical" });
    const results: ScheduleResultMap = { t1: makeResult(0, 2400, 0, 2400, 0, true) };

    const snap = buildScheduleSnapshot(
      [t1],
      [makeRow(t1)],
      NO_DEPS,
      results,
      NO_DIAGS,
      PROJECT_START,
      NO_VARIANCES,
    );

    expect(snap.criticalTasks).toHaveLength(1);
    expect(snap.criticalTasks[0].id).toBe("t1");
    expect(snap.criticalTasks[0].isCritical).toBe(true);
    expect(snap.criticalTasks[0].totalFloatMinutes).toBe(0);
  });

  it("includes near-critical tasks (float <= 2 working days = 960 min) in criticalTasks", () => {
    const t1 = makeTask({ id: "t1", name: "Near-critical" });
    const t2 = makeTask({ id: "t2", name: "Comfortable" });
    const results: ScheduleResultMap = {
      t1: makeResult(0, 2400, 960, 3360, 960, false),           // float = 960 = exactly 2d
      t2: makeResult(0, 2400, 2400, 4800, 2400, false),          // float = 2400 > threshold
    };

    const snap = buildScheduleSnapshot(
      [t1, t2],
      [makeRow(t1, { wbsCode: "1" }), makeRow(t2, { wbsCode: "2" })],
      NO_DEPS,
      results,
      NO_DIAGS,
      PROJECT_START,
      NO_VARIANCES,
    );

    expect(snap.criticalTasks).toHaveLength(1);
    expect(snap.criticalTasks[0].id).toBe("t1");
  });

  it("excludes summary tasks from criticalTasks", () => {
    const t1 = makeTask({ id: "t1", name: "Summary" });
    const results: ScheduleResultMap = { t1: makeResult(0, 2400, 0, 2400, 0, true) };

    const snap = buildScheduleSnapshot(
      [t1],
      [makeRow(t1, { isSummary: true })],
      NO_DEPS,
      results,
      NO_DIAGS,
      PROJECT_START,
      NO_VARIANCES,
    );

    expect(snap.criticalTasks).toHaveLength(0);
  });

  it("detects milestones (zero-duration non-summary tasks)", () => {
    const milestone = makeTask({ id: "m1", name: "GO LIVE", durationWorkMinutes: 0 as WorkMinutes });
    const regular = makeTask({ id: "t1", name: "Normal" });

    const snap = buildScheduleSnapshot(
      [milestone, regular],
      [makeRow(milestone, { wbsCode: "1.1" }), makeRow(regular, { wbsCode: "1.2" })],
      NO_DEPS,
      {},
      NO_DIAGS,
      PROJECT_START,
      NO_VARIANCES,
    );

    expect(snap.milestones).toHaveLength(1);
    expect(snap.milestones[0].id).toBe("m1");
    expect(snap.tasks.find((t) => t.id === "m1")?.isMilestone).toBe(true);
    expect(snap.tasks.find((t) => t.id === "t1")?.isMilestone).toBe(false);
  });

  it("does not mark zero-duration summary rows as milestones", () => {
    const summary = makeTask({ id: "s1", name: "Phase 1", durationWorkMinutes: 0 as WorkMinutes });

    const snap = buildScheduleSnapshot(
      [summary],
      [makeRow(summary, { isSummary: true })],
      NO_DEPS,
      {},
      NO_DIAGS,
      PROJECT_START,
      NO_VARIANCES,
    );

    expect(snap.milestones).toHaveLength(0);
    expect(snap.tasks[0].isMilestone).toBe(false);
  });

  it("flags missing-logic candidates — no predecessor", () => {
    const t1 = makeTask({ id: "t1", name: "No pred" });
    const t2 = makeTask({ id: "t2", name: "Has pred" });
    const dep: Dependency = { id: "d1", predId: "t1", succId: "t2", type: "FS", lagWorkMinutes: 0 as WorkMinutes };

    const snap = buildScheduleSnapshot(
      [t1, t2],
      [makeRow(t1, { wbsCode: "1" }), makeRow(t2, { wbsCode: "2" })],
      [dep],
      {},
      NO_DIAGS,
      PROJECT_START,
      NO_VARIANCES,
    );

    // t1 has no predecessor but has successor → missing-logic
    // t2 has predecessor but no successor → missing-logic
    expect(snap.missingLogicCandidates).toHaveLength(2);
    const t1Cand = snap.missingLogicCandidates.find((c) => c.id === "t1");
    const t2Cand = snap.missingLogicCandidates.find((c) => c.id === "t2");
    expect(t1Cand?.hasPredecessor).toBe(false);
    expect(t1Cand?.hasSuccessor).toBe(true);
    expect(t2Cand?.hasPredecessor).toBe(true);
    expect(t2Cand?.hasSuccessor).toBe(false);
  });

  it("excludes fully-connected tasks from missing-logic candidates", () => {
    const t1 = makeTask({ id: "t1", name: "A" });
    const t2 = makeTask({ id: "t2", name: "B" });
    const t3 = makeTask({ id: "t3", name: "C" });
    const deps: Dependency[] = [
      { id: "d1", predId: "t1", succId: "t2", type: "FS", lagWorkMinutes: 0 as WorkMinutes },
      { id: "d2", predId: "t2", succId: "t3", type: "FS", lagWorkMinutes: 0 as WorkMinutes },
    ];

    const snap = buildScheduleSnapshot(
      [t1, t2, t3],
      [t1, t2, t3].map((t, i) => makeRow(t, { wbsCode: String(i + 1) })),
      deps,
      {},
      NO_DIAGS,
      PROJECT_START,
      NO_VARIANCES,
    );

    // t2 is fully connected; t1 (no pred) and t3 (no succ) remain
    const ids = snap.missingLogicCandidates.map((c) => c.id);
    expect(ids).not.toContain("t2");
    expect(ids).toContain("t1");
    expect(ids).toContain("t3");
  });

  it("excludes summary tasks and milestones from missing-logic candidates", () => {
    const summary = makeTask({ id: "s1", name: "Phase" });
    const milestone = makeTask({ id: "m1", name: "MS", durationWorkMinutes: 0 as WorkMinutes });

    const snap = buildScheduleSnapshot(
      [summary, milestone],
      [makeRow(summary, { isSummary: true }), makeRow(milestone)],
      NO_DEPS,
      {},
      NO_DIAGS,
      PROJECT_START,
      NO_VARIANCES,
    );

    expect(snap.missingLogicCandidates).toHaveLength(0);
  });

  it("flags long-duration candidates (>= 20 working days = 9600 min)", () => {
    const short = makeTask({ id: "t1", name: "Short", durationWorkMinutes: (5 * 480) as WorkMinutes });
    const long = makeTask({ id: "t2", name: "Long", durationWorkMinutes: (20 * 480) as WorkMinutes });
    const veryLong = makeTask({ id: "t3", name: "Very Long", durationWorkMinutes: (60 * 480) as WorkMinutes });

    const snap = buildScheduleSnapshot(
      [short, long, veryLong],
      [short, long, veryLong].map((t, i) => makeRow(t, { wbsCode: String(i + 1) })),
      NO_DEPS,
      {},
      NO_DIAGS,
      PROJECT_START,
      NO_VARIANCES,
    );

    expect(snap.longDurationCandidates).toHaveLength(2);
    const ids = snap.longDurationCandidates.map((c) => c.id);
    expect(ids).toContain("t2");
    expect(ids).toContain("t3");
    expect(ids).not.toContain("t1");
  });

  it("excludes summary tasks from long-duration candidates", () => {
    const summary = makeTask({ id: "s1", name: "Phase", durationWorkMinutes: (30 * 480) as WorkMinutes });

    const snap = buildScheduleSnapshot(
      [summary],
      [makeRow(summary, { isSummary: true })],
      NO_DEPS,
      {},
      NO_DIAGS,
      PROJECT_START,
      NO_VARIANCES,
    );

    expect(snap.longDurationCandidates).toHaveLength(0);
  });

  it("collects only non-ASAP constraints into constrainedTasks", () => {
    const asap = makeTask({ id: "t1", name: "ASAP", constraintType: "ASAP" });
    const snet = makeTask({ id: "t2", name: "SNET", constraintType: "SNET", constraintDateMinutes: 480 as WorkMinutes });
    const noConstraint = makeTask({ id: "t3", name: "No CT" });

    const snap = buildScheduleSnapshot(
      [asap, snet, noConstraint],
      [asap, snet, noConstraint].map((t, i) => makeRow(t, { wbsCode: String(i + 1) })),
      NO_DEPS,
      {},
      NO_DIAGS,
      PROJECT_START,
      NO_VARIANCES,
    );

    expect(snap.constrainedTasks).toHaveLength(1);
    expect(snap.constrainedTasks[0].id).toBe("t2");
    expect(snap.constrainedTasks[0].constraintType).toBe("SNET");
  });

  it("includes diagnostics in diagnosticsSummary", () => {
    const t1 = makeTask({ id: "t1", name: "Has diag" });
    const t2 = makeTask({ id: "t2", name: "No diag" });
    const diags: DiagnosticsMap = { t1: ["GENERATING_NEGATIVE_FLOAT", "MISSING_DATE_FOR_CONSTRAINT"] };

    const snap = buildScheduleSnapshot(
      [t1, t2],
      [makeRow(t1, { wbsCode: "1" }), makeRow(t2, { wbsCode: "2" })],
      NO_DEPS,
      {},
      diags,
      PROJECT_START,
      NO_VARIANCES,
    );

    expect(snap.diagnosticsSummary).toHaveLength(1);
    expect(snap.diagnosticsSummary[0].taskId).toBe("t1");
    expect(snap.diagnosticsSummary[0].taskName).toBe("Has diag");
    expect(snap.diagnosticsSummary[0].codes).toContain("GENERATING_NEGATIVE_FLOAT");
  });

  it("resolves dependency predecessor and successor names", () => {
    const t1 = makeTask({ id: "t1", name: "Foundation" });
    const t2 = makeTask({ id: "t2", name: "Structure" });
    const dep: Dependency = { id: "d1", predId: "t1", succId: "t2", type: "FS", lagWorkMinutes: 0 as WorkMinutes };

    const snap = buildScheduleSnapshot(
      [t1, t2],
      [makeRow(t1), makeRow(t2)],
      [dep],
      {},
      NO_DIAGS,
      PROJECT_START,
      NO_VARIANCES,
    );

    expect(snap.dependencies[0].predName).toBe("Foundation");
    expect(snap.dependencies[0].succName).toBe("Structure");
    expect(snap.dependencies[0].type).toBe("FS");
  });

  it("includes wbsCode and depth from visibleRows in wbsSummary", () => {
    const t1 = makeTask({ id: "t1", name: "Phase 1" });

    const snap = buildScheduleSnapshot(
      [t1],
      [makeRow(t1, { isSummary: true, wbsCode: "1", depth: 0, rollupStartMinutes: 0 as WorkMinutes, rollupFinishMinutes: 4800 as WorkMinutes })],
      NO_DEPS,
      {},
      NO_DIAGS,
      PROJECT_START,
      NO_VARIANCES,
    );

    expect(snap.wbsSummary).toHaveLength(1);
    expect(snap.wbsSummary[0].wbsCode).toBe("1");
    expect(snap.wbsSummary[0].depth).toBe(0);
    expect(snap.wbsSummary[0].rollupFinishMinutes).toBe(4800);
  });

  it("reports variance fields when baseline data is present", () => {
    const t1 = makeTask({ id: "t1", name: "Has variance" });
    const variances: VarianceMap = {
      t1: {
        startVarianceMinutes: 480 as WorkMinutes,
        finishVarianceMinutes: 960 as WorkMinutes,
        durationVarianceMinutes: 480 as WorkMinutes,
      },
    };

    const snap = buildScheduleSnapshot(
      [t1],
      [makeRow(t1)],
      NO_DEPS,
      {},
      NO_DIAGS,
      PROJECT_START,
      variances,
    );

    const taskSnap = snap.tasks[0];
    expect(taskSnap.startVarianceMinutes).toBe(480);
    expect(taskSnap.finishVarianceMinutes).toBe(960);
  });

  it("returns null variance fields when no baseline is present", () => {
    const t1 = makeTask({ id: "t1", name: "No baseline" });

    const snap = buildScheduleSnapshot([t1], [makeRow(t1)], NO_DEPS, {}, NO_DIAGS, PROJECT_START, {});

    expect(snap.tasks[0].startVarianceMinutes).toBeNull();
    expect(snap.tasks[0].finishVarianceMinutes).toBeNull();
  });

  it("does not mutate input arrays", () => {
    const tasks = [makeTask({ id: "t1", name: "T1" })];
    const rows = [makeRow(tasks[0])];
    const deps: Dependency[] = [];
    const tasksBefore = [...tasks];
    const rowsBefore = [...rows];

    buildScheduleSnapshot(tasks, rows, deps, {}, NO_DIAGS, PROJECT_START, {});

    expect(tasks).toEqual(tasksBefore);
    expect(rows).toEqual(rowsBefore);
  });

  it("durationDays is durationWorkMinutes / 480", () => {
    const t1 = makeTask({ id: "t1", name: "10d task", durationWorkMinutes: (10 * 480) as WorkMinutes });

    const snap = buildScheduleSnapshot([t1], [makeRow(t1)], NO_DEPS, {}, NO_DIAGS, PROJECT_START, {});

    expect(snap.tasks[0].durationDays).toBe(10);
  });
});
