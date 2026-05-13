import { describe, expect, it } from "vitest";
import {
    buildMockAiResponse,
    buildPromptTemplate,
    prepareSnapshotForFeature,
} from "./aiPrompts";
import type { AIScheduleSnapshot } from "./scheduleSnapshot";

function makeSnapshot(taskCount = 3): AIScheduleSnapshot {
  return {
    projectStartDate: "2026-01-01",
    taskCount,
    dependencyCount: 2,
    scheduledCount: taskCount,
    criticalCount: 1,
    wbsSummary: [{ id: "w1", name: "Area 1", wbsCode: "1", depth: 0, isSummary: true, rollupStartMinutes: 0, rollupFinishMinutes: 4800, rollupDurationMinutes: 4800, rollupPercentComplete: null }],
    tasks: Array.from({ length: taskCount }, (_, index) => ({
      id: `t-${index}`,
      name: `Task ${index}`,
      wbsCode: `${index + 1}`,
      parentId: null,
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
      isCritical: index === 0,
      diagnosticCodes: [],
      startVarianceMinutes: null,
      finishVarianceMinutes: null,
    })),
    milestones: [{ id: "m1", name: "Milestone", wbsCode: "M1", earlyFinishMinutes: 480, isCritical: true }],
    criticalTasks: [{ id: "t-0", name: "Task 0", wbsCode: "1", totalFloatMinutes: 0, isCritical: true }],
    constrainedTasks: [{ id: "t-1", name: "Task 1", wbsCode: "2", constraintType: "SNET", constraintDateMinutes: 480, isCritical: false, diagnosticCodes: [] }],
    dependencies: [{ id: "d1", predId: "t-0", predName: "Task 0", succId: "t-1", succName: "Task 1", type: "FS", lagWorkMinutes: 0 }],
    missingLogicCandidates: [{ id: "t-2", name: "Task 2", wbsCode: "3", hasPredecessor: false, hasSuccessor: true }],
    longDurationCandidates: [{ id: "t-3", name: "Long Task", wbsCode: "4", durationWorkMinutes: 9600, durationDays: 20 }],
    diagnosticsSummary: [{ taskId: "t-1", taskName: "Task 1", codes: ["MISSING_DATE_FOR_CONSTRAINT"] }],
  };
}

describe("aiPrompts", () => {
  it("builds a health review prompt with snapshot-only grounding", () => {
    const prompt = buildPromptTemplate(
      "health-review",
      prepareSnapshotForFeature(makeSnapshot(), "health-review"),
    );
    expect(prompt.system).toContain("answer only from the provided schedule snapshot");
    expect(prompt.user).toContain("AI Schedule Health Review");
    expect(prompt.user).toContain("Snapshot:");
    expect(prompt.user).toContain("Critical Path");
  });

  it("builds a management summary prompt with Problem / Impact / Action guidance", () => {
    const prompt = buildPromptTemplate(
      "management-summary",
      prepareSnapshotForFeature(makeSnapshot(), "management-summary"),
    );
    expect(prompt.user).toContain("Problem / Impact / Action");
    expect(prompt.user).toContain("milestone status");
  });

  it("builds an ask schedule prompt with the user question", () => {
    const prompt = buildPromptTemplate(
      "ask-schedule",
      prepareSnapshotForFeature(makeSnapshot(), "ask-schedule"),
      "Which tasks are critical?",
    );
    expect(prompt.user).toContain("User question: Which tasks are critical?");
    expect(prompt.user).toContain("not available in current snapshot");
  });

  it("trims large snapshots and marks them truncated", () => {
    const prepared = prepareSnapshotForFeature(makeSnapshot(1000), "management-summary");
    expect(prepared.tasks.length).toBeLessThan(1000);
    expect(prepared.truncated).toBe(true);
    expect(prepared.advisoryOnly).toBe(true);
  });

  it("still supports deterministic mock fallback for suggestions", () => {
    const response = buildMockAiResponse("suggestions", makeSnapshot());
    expect(response).toContain("Advisory Suggestions");
    expect(response).toContain("Advisory only");
  });
});
