import { describe, expect, it } from "vitest";
import { validateAiRunRequest } from "./validation.ts";

const snapshot = {
  projectStartDate: "2026-01-01",
  taskCount: 2,
  dependencyCount: 1,
  scheduledCount: 2,
  criticalCount: 1,
  wbsSummary: [],
  tasks: [],
  milestones: [],
  criticalTasks: [],
  constrainedTasks: [],
  dependencies: [],
  missingLogicCandidates: [],
  longDurationCandidates: [],
  diagnosticsSummary: [],
  advisoryOnly: true,
  truncated: false,
  includedTaskCount: 0,
  includedDependencyCount: 0,
};

describe("validateAiRunRequest", () => {
  it("accepts a valid health review request", () => {
    const result = validateAiRunRequest({
      feature: "health-review",
      snapshot,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects unsupported features", () => {
    const result = validateAiRunRequest({
      feature: "mutate-schedule",
      snapshot,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
    }
  });

  it("rejects ask-schedule without a question", () => {
    const result = validateAiRunRequest({
      feature: "ask-schedule",
      snapshot,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("requires a question");
    }
  });

  it("rejects malformed snapshots", () => {
    const result = validateAiRunRequest({
      feature: "health-review",
      snapshot: { taskCount: 1 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid AI snapshot");
    }
  });
});
