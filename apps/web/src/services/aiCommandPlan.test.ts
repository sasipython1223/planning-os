import { describe, expect, it } from "vitest";
import { buildCommandPlanPreview } from "./aiCommandPlan";
import type { AIProposalCard } from "./aiProposals";
import type { AIScheduleSnapshot } from "./scheduleSnapshot";

function makeSnapshot(): AIScheduleSnapshot {
  return {
    projectStartDate: "2026-01-01",
    taskCount: 3,
    dependencyCount: 1,
    scheduledCount: 3,
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
        name: "Task 2",
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
        totalFloatMinutes: 0,
        isCritical: false,
        diagnosticCodes: [],
        startVarianceMinutes: null,
        finishVarianceMinutes: null,
      },
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
    ],
    milestones: [],
    criticalTasks: [],
    constrainedTasks: [],
    dependencies: [
      {
        id: "d1",
        predId: "t1",
        predName: "Task 1",
        succId: "t2",
        succName: "Task 2",
        type: "FS",
        lagWorkMinutes: 0,
      },
    ],
    missingLogicCandidates: [],
    longDurationCandidates: [],
    diagnosticsSummary: [],
  };
}

function proposalBase<T extends AIProposalCard>(proposal: T): T {
  return proposal;
}

describe("buildCommandPlanPreview", () => {
  it("builds one ADD_TASK item per generated activity", () => {
    const proposals: AIProposalCard[] = [
      proposalBase({
        id: "p-gen",
        type: "generate-activities-under-wbs",
        title: "Generate",
        rationale: "r",
        proposedChange: {
          parentWbsId: "w1",
          activities: [
            { tempKey: "a", name: "A", durationDays: 5 },
            { tempKey: "b", name: "B", durationDays: 3 },
          ],
        },
        advisoryOnly: true,
      }),
    ];

    const plan = buildCommandPlanPreview({
      snapshot: makeSnapshot(),
      proposals,
      selectedProposalIds: new Set(["p-gen"]),
      nowIso: "2026-01-01T00:00:00.000Z",
    });

    expect(plan.items).toHaveLength(2);
    expect(plan.items.every((i) => i.category === "command")).toBe(true);
    expect(plan.items.every((i) => i.category === "command" && i.commandKind === "ADD_TASK")).toBe(true);
    expect(plan.previewOnlyLabel).toBe("Preview only — no schedule changes will be made.");
  });

  it("marks missing-fs with warning when dependency already exists", () => {
    const proposals: AIProposalCard[] = [
      proposalBase({
        id: "p-fs",
        type: "suggest-missing-fs",
        title: "FS",
        rationale: "r",
        proposedChange: {
          predTaskId: "t1",
          succTaskId: "t2",
          dependencyType: "FS",
          lagDays: 0,
        },
        advisoryOnly: true,
      }),
    ];

    const plan = buildCommandPlanPreview({
      snapshot: makeSnapshot(),
      proposals,
      selectedProposalIds: new Set(["p-fs"]),
    });

    expect(plan.items).toHaveLength(1);
    const item = plan.items[0];
    expect(item.category).toBe("command");
    if (item.category === "command") {
      expect(item.commandKind).toBe("ADD_DEPENDENCY");
      expect(item.status).toBe("warning");
      expect(item.notices.some((n) => n.message.includes("already exists"))).toBe(true);
    }
  });

  it("adds required duration warning and blocker for invalid duration", () => {
    const proposals: AIProposalCard[] = [
      proposalBase({
        id: "p-dur",
        type: "suggest-duration-change",
        title: "Dur",
        rationale: "r",
        proposedChange: {
          taskId: "t1",
          currentDurationDays: 10,
          proposedDurationDays: 0,
          reason: "x",
        },
        advisoryOnly: true,
      }),
    ];

    const plan = buildCommandPlanPreview({
      snapshot: makeSnapshot(),
      proposals,
      selectedProposalIds: new Set(["p-dur"]),
    });

    const item = plan.items[0];
    expect(item.status).toBe("blocked");
    expect(item.notices.some((n) => n.message.includes("Duration changes affect schedule calculation"))).toBe(true);
    expect(item.notices.some((n) => n.message.includes("invalid"))).toBe(true);
  });

  it("creates advisory-only item for management-comment", () => {
    const proposals: AIProposalCard[] = [
      proposalBase({
        id: "p-comment",
        type: "management-comment",
        title: "Comment",
        rationale: "r",
        proposedChange: {
          scope: "project",
          text: "Status comment",
        },
        advisoryOnly: true,
      }),
    ];

    const plan = buildCommandPlanPreview({
      snapshot: makeSnapshot(),
      proposals,
      selectedProposalIds: new Set(["p-comment"]),
    });

    expect(plan.items).toHaveLength(1);
    const item = plan.items[0];
    expect(item.category).toBe("advisory-only");
    if (item.category === "advisory-only") {
      expect(item.advisoryLabel).toBe("No command generated — report/comment only.");
    }
  });
});
