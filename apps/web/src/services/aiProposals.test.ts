import { describe, expect, it } from "vitest";
import { buildDeterministicProposals } from "./aiProposals";
import type { AIScheduleSnapshot } from "./scheduleSnapshot";

function makeSnapshot(): AIScheduleSnapshot {
  return {
    projectStartDate: "2026-01-01",
    taskCount: 5,
    dependencyCount: 1,
    scheduledCount: 5,
    criticalCount: 1,
    wbsSummary: [
      {
        id: "w1",
        name: "Area 1",
        wbsCode: "1",
        depth: 0,
        isSummary: true,
        rollupStartMinutes: 0,
        rollupFinishMinutes: 4800,
        rollupDurationMinutes: 4800,
        rollupPercentComplete: null,
      },
    ],
    tasks: [
      {
        id: "w1",
        name: "Area 1",
        wbsCode: "1",
        parentId: null,
        durationWorkMinutes: 4800,
        durationDays: 10,
        isMilestone: false,
        isSummary: true,
        constraintType: null,
        constraintDateMinutes: null,
        sourceActivityId: null,
        activityCode: null,
        earlyStartMinutes: 0,
        earlyFinishMinutes: 4800,
        lateStartMinutes: 0,
        lateFinishMinutes: 4800,
        totalFloatMinutes: 0,
        isCritical: false,
        diagnosticCodes: [],
        startVarianceMinutes: null,
        finishVarianceMinutes: null,
      },
      {
        id: "t1",
        name: "Task 1",
        wbsCode: "1.1",
        parentId: "w1",
        durationWorkMinutes: 480,
        durationDays: 1,
        isMilestone: false,
        isSummary: false,
        constraintType: null,
        constraintDateMinutes: null,
        sourceActivityId: null,
        activityCode: null,
        earlyStartMinutes: 0,
        earlyFinishMinutes: 480,
        lateStartMinutes: 0,
        lateFinishMinutes: 480,
        totalFloatMinutes: 0,
        isCritical: true,
        diagnosticCodes: [],
        startVarianceMinutes: null,
        finishVarianceMinutes: null,
      },
      {
        id: "t2",
        name: "Install Conduit",
        wbsCode: "1.2",
        parentId: "w1",
        durationWorkMinutes: 960,
        durationDays: 2,
        isMilestone: false,
        isSummary: false,
        constraintType: null,
        constraintDateMinutes: null,
        sourceActivityId: null,
        activityCode: null,
        earlyStartMinutes: 480,
        earlyFinishMinutes: 1440,
        lateStartMinutes: 480,
        lateFinishMinutes: 1440,
        totalFloatMinutes: 480,
        isCritical: false,
        diagnosticCodes: [],
        startVarianceMinutes: null,
        finishVarianceMinutes: null,
      },
      {
        id: "t3",
        name: "Long Work",
        wbsCode: "1.3",
        parentId: "w1",
        durationWorkMinutes: 12000,
        durationDays: 25,
        isMilestone: false,
        isSummary: false,
        constraintType: null,
        constraintDateMinutes: null,
        sourceActivityId: null,
        activityCode: null,
        earlyStartMinutes: 1440,
        earlyFinishMinutes: 13440,
        lateStartMinutes: 1440,
        lateFinishMinutes: 13440,
        totalFloatMinutes: 0,
        isCritical: false,
        diagnosticCodes: [],
        startVarianceMinutes: null,
        finishVarianceMinutes: null,
      },
      {
        id: "t4",
        name: "Task",
        wbsCode: "1.4",
        parentId: "w1",
        durationWorkMinutes: 960,
        durationDays: 2,
        isMilestone: false,
        isSummary: false,
        constraintType: null,
        constraintDateMinutes: null,
        sourceActivityId: null,
        activityCode: null,
        earlyStartMinutes: 13440,
        earlyFinishMinutes: 14400,
        lateStartMinutes: 13440,
        lateFinishMinutes: 14400,
        totalFloatMinutes: 0,
        isCritical: false,
        diagnosticCodes: [],
        startVarianceMinutes: null,
        finishVarianceMinutes: null,
      },
    ],
    milestones: [],
    criticalTasks: [
      {
        id: "t1",
        name: "Task 1",
        wbsCode: "1.1",
        totalFloatMinutes: 0,
        isCritical: true,
      },
    ],
    constrainedTasks: [],
    dependencies: [
      {
        id: "d1",
        predId: "t1",
        predName: "Task 1",
        succId: "t2",
        succName: "Install Conduit",
        type: "FS",
        lagWorkMinutes: 0,
      },
    ],
    missingLogicCandidates: [
      { id: "t2", name: "Install Conduit", wbsCode: "1.2", hasPredecessor: true, hasSuccessor: false },
      { id: "t3", name: "Long Work", wbsCode: "1.3", hasPredecessor: false, hasSuccessor: true },
    ],
    longDurationCandidates: [
      {
        id: "t3",
        name: "Long Work",
        wbsCode: "1.3",
        durationWorkMinutes: 12000,
        durationDays: 25,
      },
    ],
    diagnosticsSummary: [],
  };
}

describe("buildDeterministicProposals", () => {
  it("generates advisory proposal cards for AI-3 scope", () => {
    const proposals = buildDeterministicProposals(makeSnapshot());
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.every((proposal) => proposal.advisoryOnly)).toBe(true);
  });

  it("includes generate activities proposal when wbs summary exists", () => {
    const proposals = buildDeterministicProposals(makeSnapshot());
    const activityProposal = proposals.find((proposal) => proposal.type === "generate-activities-under-wbs");
    expect(activityProposal).toBeDefined();
    expect(activityProposal?.target?.wbsId).toBe("w1");
  });

  it("includes missing FS suggestions and duration/name/comment proposals", () => {
    const proposals = buildDeterministicProposals(makeSnapshot());
    expect(proposals.some((proposal) => proposal.type === "suggest-missing-fs")).toBe(true);
    expect(proposals.some((proposal) => proposal.type === "improve-activity-name")).toBe(true);
    expect(proposals.some((proposal) => proposal.type === "suggest-duration-change")).toBe(true);
    expect(proposals.some((proposal) => proposal.type === "management-comment")).toBe(true);
  });

  it("uses selected task context to target parent wbs when provided", () => {
    const proposals = buildDeterministicProposals(makeSnapshot(), { selectedTaskId: "t4" });
    const activityProposal = proposals.find((proposal) => proposal.type === "generate-activities-under-wbs");
    expect(activityProposal?.target?.wbsId).toBe("w1");
  });

  it("treats 'Work item' names as weak activity names for rename proposals", () => {
    const snapshot = makeSnapshot();
    const tasks = snapshot.tasks.map((task) => ({ ...task }));
    const workItem = tasks.find((task) => task.id === "t2");
    const workItemNumbered = tasks.find((task) => task.id === "t3");
    if (!workItem || !workItemNumbered) {
      throw new Error("Expected t2 and t3 tasks in fixture");
    }

    workItem.name = "Work item";
    workItemNumbered.name = "Work item 12";

    const proposals = buildDeterministicProposals({
      ...snapshot,
      tasks,
    });

    const renameTargets = proposals
      .filter((proposal) => proposal.type === "improve-activity-name")
      .map((proposal) => proposal.target?.taskId);

    expect(renameTargets).toContain("t2");
    expect(renameTargets).toContain("t3");
  });
});
