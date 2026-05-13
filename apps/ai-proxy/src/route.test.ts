import { describe, expect, it, vi } from "vitest";
import { handleAiRunRequest } from "./route.ts";

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

describe("handleAiRunRequest", () => {
  it("returns 503 when backend key is not configured", async () => {
    const result = await handleAiRunRequest(
      { feature: "health-review", snapshot },
      { openAiModel: "gpt-4.1-mini" },
    );
    expect(result.status).toBe(503);
    expect(result.body.error).toContain("not configured");
  });

  it("returns AI content on success", async () => {
    const transport = vi.fn().mockResolvedValue({
      content: "Live AI response",
      model: "test-model",
    });

    const result = await handleAiRunRequest(
      { feature: "health-review", snapshot },
      { openAiApiKey: "secret", openAiModel: "test-model" },
      transport,
    );

    expect(result.status).toBe(200);
    expect(result.body.content).toBe("Live AI response");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("returns validation errors directly", async () => {
    const result = await handleAiRunRequest(
      { feature: "ask-schedule", snapshot },
      { openAiApiKey: "secret", openAiModel: "test-model" },
    );
    expect(result.status).toBe(400);
    expect(result.body.error).toContain("requires a question");
  });
});
