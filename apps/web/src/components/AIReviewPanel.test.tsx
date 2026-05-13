/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AIServiceError, runAiFeature } from "../services/aiClient";
import type { AIScheduleSnapshot } from "../services/scheduleSnapshot";
import { AIReviewPanel } from "./AIReviewPanel";

vi.mock("../services/aiClient", async () => {
  const actual = await vi.importActual<typeof import("../services/aiClient")>("../services/aiClient");
  return {
    ...actual,
    runAiFeature: vi.fn(),
  };
});

function makeSnapshot(): AIScheduleSnapshot {
  return {
    projectStartDate: "2026-01-01",
    taskCount: 3,
    dependencyCount: 1,
    scheduledCount: 3,
    criticalCount: 1,
    wbsSummary: [],
    tasks: [
      {
        id: "t1",
        name: "Task 1",
        wbsCode: "1",
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
        isCritical: true,
        diagnosticCodes: [],
        startVarianceMinutes: null,
        finishVarianceMinutes: null,
      },
    ],
    milestones: [],
    criticalTasks: [{ id: "t1", name: "Task 1", wbsCode: "1", totalFloatMinutes: 0, isCritical: true }],
    constrainedTasks: [],
    dependencies: [],
    missingLogicCandidates: [],
    longDurationCandidates: [],
    diagnosticsSummary: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AIReviewPanel", () => {
  it("shows a loading state and renders live content", async () => {
    const pending = deferred<{ content: string; warnings: readonly string[]; truncated: boolean; mode: "live"; model?: string }>();
    vi.mocked(runAiFeature).mockReturnValueOnce(pending.promise);

    render(<AIReviewPanel snapshot={makeSnapshot()} />);
    fireEvent.click(screen.getByRole("button", { name: "Run Health Review" }));

    expect(screen.getByText("Generating live response...")).toBeTruthy();

    pending.resolve({ content: "## Live Health Review", warnings: [], truncated: false, mode: "live" });

    await waitFor(() => {
      expect(screen.getByText("Live Health Review")).toBeTruthy();
      expect(screen.getByText(/AI-2 \(proxy\)/)).toBeTruthy();
    });
  });

  it("renders an error state and allows mock fallback", async () => {
    vi.mocked(runAiFeature).mockRejectedValueOnce(
      new AIServiceError("SERVICE_UNAVAILABLE", "AI proxy is not configured."),
    );

    render(<AIReviewPanel snapshot={makeSnapshot()} />);
    fireEvent.click(screen.getByRole("button", { name: "Run Health Review" }));

    await waitFor(() => {
      expect(screen.getByText("AI proxy is not configured.")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Use Mock Response" }));

    await waitFor(() => {
      expect(screen.getByText("Schedule Health Review")).toBeTruthy();
      expect(screen.getByText(/mock fallback/)).toBeTruthy();
    });
  });

  it("keeps suggestions on mock mode and does not call the live service", async () => {
    render(<AIReviewPanel snapshot={makeSnapshot()} />);

    fireEvent.click(screen.getByRole("button", { name: "Suggestions" }));
    fireEvent.click(screen.getByRole("button", { name: "Get Suggestions" }));

    expect(runAiFeature).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText("Advisory Suggestions")).toBeTruthy();
    });
  });

  it("shows command preview section after selecting a proposal", async () => {
    render(<AIReviewPanel snapshot={makeSnapshot()} />);

    fireEvent.click(screen.getByRole("button", { name: "Proposals" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate Proposals" }));

    await waitFor(() => {
      expect(screen.getByText("Select one or more proposals to preview the command plan.")).toBeTruthy();
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Select" })[0]);

    await waitFor(() => {
      expect(screen.getByText("Command Preview")).toBeTruthy();
      expect(screen.getByText("Preview only — no schedule changes will be made.")).toBeTruthy();
    });
  });

  it("routes rename Review Apply through callback for selected rename proposal", async () => {
    const onApplyRenameProposal = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <AIReviewPanel
        snapshot={makeSnapshot()}
        onApplyRenameProposal={onApplyRenameProposal}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Proposals" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate Proposals" }));

    await waitFor(() => {
      expect(screen.getByText("Select one or more proposals to preview the command plan.")).toBeTruthy();
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Select" })[0]);

    const reviewApply = await screen.findByRole("button", { name: "Review Apply" });
    fireEvent.click(reviewApply);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onApplyRenameProposal).toHaveBeenCalledTimes(1);
    expect(onApplyRenameProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalId: "proposal-rename-t1",
        taskId: "t1",
      }),
    );

    confirmSpy.mockRestore();
  });
});
