import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AIServiceError, runAiFeature } from "./aiClient";
import { MAX_AI_REQUEST_BYTES } from "./aiPrompts";
import type { AIScheduleSnapshot } from "./scheduleSnapshot";

function makeSnapshot(taskCount = 3): AIScheduleSnapshot {
  return {
    projectStartDate: "2026-01-01",
    taskCount,
    dependencyCount: 2,
    scheduledCount: taskCount,
    criticalCount: 1,
    wbsSummary: [],
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
    milestones: [],
    criticalTasks: [],
    constrainedTasks: [],
    dependencies: [],
    missingLogicCandidates: [],
    longDurationCandidates: [],
    diagnosticsSummary: [],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("runAiFeature", () => {
  it("posts the expected backend request shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ content: "Live response", model: "test-model" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await runAiFeature({
      feature: "health-review",
      snapshot: makeSnapshot(),
    });

    expect(response.content).toBe("Live response");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as {
      feature: string;
      snapshot: { advisoryOnly: boolean };
      question?: string;
    };
    expect(body.feature).toBe("health-review");
    expect(body.snapshot.advisoryOnly).toBe(true);
    expect(body.question).toBeUndefined();
  });

  it("rejects overlong ask questions before making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runAiFeature({
        feature: "ask-schedule",
        snapshot: makeSnapshot(),
        question: "x".repeat(501),
      }),
    ).rejects.toMatchObject({ code: "INVALID_QUESTION" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps backend 503 to a service unavailable error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "AI proxy is not configured." }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(
      runAiFeature({ feature: "health-review", snapshot: makeSnapshot() }),
    ).rejects.toEqual(expect.objectContaining<Partial<AIServiceError>>({ code: "SERVICE_UNAVAILABLE" }));
  });

  it("shows a clearer message for non-JSON 500 proxy failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("Internal Server Error", {
          status: 500,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );

    await expect(
      runAiFeature({ feature: "health-review", snapshot: makeSnapshot() }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AIServiceError>>({
        status: 500,
        message:
          "AI proxy request failed. The proxy or provider may be unavailable. Check the ai-proxy server logs.",
      }),
    );
  });

  it("shows configuration guidance for non-JSON 503 failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("Service Unavailable", {
          status: 503,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );

    await expect(
      runAiFeature({ feature: "health-review", snapshot: makeSnapshot() }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AIServiceError>>({
        code: "SERVICE_UNAVAILABLE",
        status: 503,
        message: "AI proxy is not configured. Set OPENAI_API_KEY in apps/ai-proxy/.env.",
      }),
    );
  });

  it("contains no browser-side OpenAI configuration or direct provider calls", () => {
    const file = readFileSync(new URL("./aiClient.ts", import.meta.url), "utf8");
    expect(file).not.toContain("VITE_OPENAI_API_KEY");
    expect(file).not.toContain("import.meta.env");
    expect(file).not.toContain("api.openai.com");
    expect(file).not.toContain("/chat/completions");
  });

  it("compresses oversized ask-schedule payloads before posting", async () => {
    const largeSnapshot = makeLargeSnapshot();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ content: "Live response", model: "test-model" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await runAiFeature({
      feature: "ask-schedule",
      snapshot: largeSnapshot,
      question: "What are the biggest schedule risks?",
    });

    expect(response.content).toBe("Live response");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const rawBody = String(init.body);
    const body = JSON.parse(rawBody) as {
      feature: string;
      snapshot: { truncated: boolean; tasks: unknown[]; dependencies: unknown[] };
      question: string;
    };

    expect(new TextEncoder().encode(rawBody).length).toBeLessThanOrEqual(MAX_AI_REQUEST_BYTES);
    expect(body.feature).toBe("ask-schedule");
    expect(body.question).toBe("What are the biggest schedule risks?");
    expect(body.snapshot.truncated).toBe(true);
    expect(body.snapshot.tasks.length).toBeLessThan(largeSnapshot.tasks.length);
    expect(body.snapshot.dependencies.length).toBeLessThan(largeSnapshot.dependencies.length);
  });
});

function makeLargeSnapshot(): AIScheduleSnapshot {
  const base = makeSnapshot(1000);
  const largeText = "x".repeat(400);

  return {
    ...base,
    dependencyCount: 1800,
    tasks: Array.from({ length: 1000 }, (_, index) => ({
      ...base.tasks[index % base.tasks.length],
      id: `lt-${index}`,
      name: `Large Task ${index} ${largeText}`,
      wbsCode: `WBS-${index}`,
      diagnosticCodes: [largeText, largeText],
    })),
    dependencies: Array.from({ length: 1800 }, (_, index) => ({
      id: `ld-${index}`,
      predId: `lt-${index % 1000}`,
      predName: `Pred ${index} ${largeText}`,
      succId: `lt-${(index + 1) % 1000}`,
      succName: `Succ ${index} ${largeText}`,
      type: "FS",
      lagWorkMinutes: 0,
    })),
    wbsSummary: Array.from({ length: 300 }, (_, index) => ({
      id: `lw-${index}`,
      name: `Area ${index} ${largeText}`,
      wbsCode: `${index}`,
      depth: 0,
      isSummary: true,
      rollupStartMinutes: 0,
      rollupFinishMinutes: 480,
      rollupDurationMinutes: 480,
      rollupPercentComplete: null,
    })),
    milestones: Array.from({ length: 200 }, (_, index) => ({
      id: `lm-${index}`,
      name: `Milestone ${index} ${largeText}`,
      wbsCode: `${index}`,
      earlyFinishMinutes: null,
      isCritical: false,
    })),
    criticalTasks: Array.from({ length: 200 }, (_, index) => ({
      id: `lc-${index}`,
      name: `Critical ${index} ${largeText}`,
      wbsCode: `${index}`,
      totalFloatMinutes: 0,
      isCritical: true,
    })),
    constrainedTasks: Array.from({ length: 200 }, (_, index) => ({
      id: `lct-${index}`,
      name: `Constrained ${index} ${largeText}`,
      wbsCode: `${index}`,
      constraintType: "SNET",
      constraintDateMinutes: null,
      isCritical: false,
      diagnosticCodes: [largeText],
    })),
    missingLogicCandidates: Array.from({ length: 250 }, (_, index) => ({
      id: `lml-${index}`,
      name: `Logic ${index} ${largeText}`,
      wbsCode: `${index}`,
      hasPredecessor: false,
      hasSuccessor: true,
    })),
    longDurationCandidates: Array.from({ length: 250 }, (_, index) => ({
      id: `lld-${index}`,
      name: `Long ${index} ${largeText}`,
      wbsCode: `${index}`,
      durationWorkMinutes: 20000,
      durationDays: 41.67,
    })),
    diagnosticsSummary: Array.from({ length: 250 }, (_, index) => ({
      taskId: `lt-${index}`,
      taskName: `Task ${index} ${largeText}`,
      codes: ["MISSING_DATE_FOR_CONSTRAINT", largeText],
    })),
  };
}
