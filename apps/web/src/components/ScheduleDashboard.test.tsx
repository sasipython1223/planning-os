/** @vitest-environment jsdom */

import { MINUTES_PER_DAY } from "@planner/protocol";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AIScheduleSnapshot } from "../services/scheduleSnapshot";
import {
    deriveFloatBuckets,
    deriveNearCriticalCount,
    deriveProjectFinish,
    ScheduleDashboard,
} from "./ScheduleDashboard";

afterEach(() => {
  cleanup();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<AIScheduleSnapshot> = {}): AIScheduleSnapshot {
  return {
    projectStartDate: "2026-01-01",
    taskCount: 4,
    dependencyCount: 3,
    scheduledCount: 4,
    criticalCount: 1,
    wbsSummary: [
      {
        id: "w1",
        name: "Phase 1",
        wbsCode: "1",
        depth: 0,
        isSummary: true,
        rollupStartMinutes: 0,
        rollupFinishMinutes: 10 * MINUTES_PER_DAY,
        rollupDurationMinutes: 10 * MINUTES_PER_DAY,
        rollupPercentComplete: null,
      },
    ],
    tasks: [
      {
        id: "t0",
        name: "Summary A",
        wbsCode: "1",
        parentId: null,
        durationWorkMinutes: 0,
        durationDays: 0,
        isMilestone: false,
        isSummary: true,
        constraintType: null,
        constraintDateMinutes: null,
        sourceActivityId: null,
        activityCode: null,
        earlyStartMinutes: 0,
        earlyFinishMinutes: 10 * MINUTES_PER_DAY,
        lateStartMinutes: 0,
        lateFinishMinutes: 10 * MINUTES_PER_DAY,
        totalFloatMinutes: 0,
        isCritical: false,
        diagnosticCodes: [],
        startVarianceMinutes: null,
        finishVarianceMinutes: null,
      },
      {
        id: "t1",
        name: "Critical Task",
        wbsCode: "1.1",
        parentId: "t0",
        durationWorkMinutes: 5 * MINUTES_PER_DAY,
        durationDays: 5,
        isMilestone: false,
        isSummary: false,
        constraintType: null,
        constraintDateMinutes: null,
        sourceActivityId: null,
        activityCode: null,
        earlyStartMinutes: 0,
        earlyFinishMinutes: 5 * MINUTES_PER_DAY,
        lateStartMinutes: 0,
        lateFinishMinutes: 5 * MINUTES_PER_DAY,
        totalFloatMinutes: 0,
        isCritical: true,
        diagnosticCodes: [],
        startVarianceMinutes: null,
        finishVarianceMinutes: null,
      },
      {
        id: "t2",
        name: "Near-critical Task",
        wbsCode: "1.2",
        parentId: "t0",
        durationWorkMinutes: 5 * MINUTES_PER_DAY,
        durationDays: 5,
        isMilestone: false,
        isSummary: false,
        constraintType: null,
        constraintDateMinutes: null,
        sourceActivityId: null,
        activityCode: null,
        earlyStartMinutes: 5 * MINUTES_PER_DAY,
        earlyFinishMinutes: 10 * MINUTES_PER_DAY,
        lateStartMinutes: 5 * MINUTES_PER_DAY,
        lateFinishMinutes: 10 * MINUTES_PER_DAY,
        totalFloatMinutes: MINUTES_PER_DAY, // 1 day float — near-critical
        isCritical: false,
        diagnosticCodes: [],
        startVarianceMinutes: null,
        finishVarianceMinutes: null,
      },
      {
        id: "t3",
        name: "Unscheduled Task",
        wbsCode: "1.3",
        parentId: "t0",
        durationWorkMinutes: 3 * MINUTES_PER_DAY,
        durationDays: 3,
        isMilestone: false,
        isSummary: false,
        constraintType: null,
        constraintDateMinutes: null,
        sourceActivityId: null,
        activityCode: null,
        earlyStartMinutes: null,
        earlyFinishMinutes: null,
        lateStartMinutes: null,
        lateFinishMinutes: null,
        totalFloatMinutes: null,
        isCritical: false,
        diagnosticCodes: [],
        startVarianceMinutes: null,
        finishVarianceMinutes: null,
      },
    ],
    milestones: [
      { id: "m1", name: "M1", wbsCode: "1.4", earlyFinishMinutes: 10 * MINUTES_PER_DAY, isCritical: false },
    ],
    criticalTasks: [
      { id: "t1", name: "Critical Task", wbsCode: "1.1", totalFloatMinutes: 0, isCritical: true },
      { id: "t2", name: "Near-critical Task", wbsCode: "1.2", totalFloatMinutes: MINUTES_PER_DAY, isCritical: false },
    ],
    constrainedTasks: [],
    dependencies: [
      { id: "d1", predId: "t1", predName: "Critical Task", succId: "t2", succName: "Near-critical Task", type: "FS", lagWorkMinutes: 0 },
    ],
    missingLogicCandidates: [],
    longDurationCandidates: [],
    diagnosticsSummary: [],
    ...overrides,
  };
}

// ─── deriveProjectFinish ──────────────────────────────────────────────────────

describe("deriveProjectFinish", () => {
  it("returns null when all tasks are unscheduled", () => {
    const snap = makeSnapshot();
    const noFinish = {
      ...snap,
      tasks: snap.tasks.map((t) => ({ ...t, earlyFinishMinutes: null })),
    };
    expect(deriveProjectFinish(noFinish)).toBeNull();
  });

  it("returns the ISO date of the max leaf earlyFinishMinutes", () => {
    const snap = makeSnapshot();
    // max non-summary earlyFinishMinutes = 10 * MINUTES_PER_DAY → 10 days from 2026-01-01 = 2026-01-11
    const finish = deriveProjectFinish(snap);
    expect(finish).toBe("2026-01-11");
  });

  it("ignores summary task earlyFinishMinutes", () => {
    const snap = makeSnapshot();
    // Summary t0 has earlyFinishMinutes = 10*MPD, same as max leaf — result unchanged
    const finish = deriveProjectFinish(snap);
    expect(finish).toBe("2026-01-11");
  });
});

// ─── deriveNearCriticalCount ──────────────────────────────────────────────────

describe("deriveNearCriticalCount", () => {
  it("counts criticalTasks entries where isCritical is false", () => {
    const snap = makeSnapshot();
    expect(deriveNearCriticalCount(snap)).toBe(1);
  });

  it("returns 0 when there are no near-critical tasks", () => {
    const snap = makeSnapshot({
      criticalTasks: [{ id: "t1", name: "Critical Task", wbsCode: "1.1", totalFloatMinutes: 0, isCritical: true }],
    });
    expect(deriveNearCriticalCount(snap)).toBe(0);
  });
});

// ─── deriveFloatBuckets ───────────────────────────────────────────────────────

describe("deriveFloatBuckets", () => {
  it("puts zero-float leaf tasks in the Critical bucket", () => {
    const snap = makeSnapshot();
    const buckets = deriveFloatBuckets(snap);
    const critical = buckets.find((b) => b.label === "Critical (0d)");
    expect(critical).toBeDefined();
    expect(critical!.count).toBe(1); // t1
  });

  it("puts null-float leaf tasks in the Unscheduled bucket", () => {
    const snap = makeSnapshot();
    const buckets = deriveFloatBuckets(snap);
    const unscheduled = buckets.find((b) => b.label === "Unscheduled");
    expect(unscheduled).toBeDefined();
    expect(unscheduled!.count).toBe(1); // t3
  });

  it("omits buckets with zero count", () => {
    const snap = makeSnapshot();
    const buckets = deriveFloatBuckets(snap);
    for (const b of buckets) {
      expect(b.count).toBeGreaterThan(0);
    }
  });

  it("does not include summary task float in buckets", () => {
    const snap = makeSnapshot();
    const buckets = deriveFloatBuckets(snap);
    const total = buckets.reduce((sum, b) => sum + b.count, 0);
    // 3 leaf tasks: t1 (critical), t2 (≤2d), t3 (unscheduled) — not t0 (summary)
    expect(total).toBe(3);
  });
});

// ─── ScheduleDashboard rendering ─────────────────────────────────────────────

describe("ScheduleDashboard", () => {
  it("shows empty-state message when snapshot is null", () => {
    render(<ScheduleDashboard snapshot={null} />);
    expect(screen.getByText("No schedule data to display.")).toBeDefined();
  });

  it("shows empty-state message when taskCount is 0", () => {
    render(<ScheduleDashboard snapshot={makeSnapshot({ taskCount: 0 })} />);
    expect(screen.getByText("No schedule data to display.")).toBeDefined();
  });

  it("renders activity and schedule metric cards", () => {
    render(<ScheduleDashboard snapshot={makeSnapshot()} />);
    expect(screen.getByText("Activities")).toBeDefined();
    expect(screen.getByText("Scheduled")).toBeDefined();
    expect(screen.getByText("Critical")).toBeDefined();
    expect(screen.getByText("Milestones")).toBeDefined();
    expect(screen.getByText("Dependencies")).toBeDefined();
  });

  it("renders project start date", () => {
    render(<ScheduleDashboard snapshot={makeSnapshot()} />);
    expect(screen.getByText("2026-01-01")).toBeDefined();
  });

  it("renders the advisory disclaimer", () => {
    render(<ScheduleDashboard snapshot={makeSnapshot()} />);
    expect(screen.getByText(/Advisory display only/)).toBeDefined();
  });

  it("renders float distribution section when leaf tasks exist", () => {
    render(<ScheduleDashboard snapshot={makeSnapshot()} />);
    expect(screen.getByText(/Float distribution/)).toBeDefined();
  });

  it("does not render float distribution section when there are no tasks", () => {
    const snap = makeSnapshot({ tasks: [], taskCount: 5 }); // taskCount > 0 to avoid empty state
    render(<ScheduleDashboard snapshot={snap} />);
    expect(screen.queryByText(/Float distribution/)).toBeNull();
  });
});
