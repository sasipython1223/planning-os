/** @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AICommandPlanPreview } from "../services/aiCommandPlan";
import { AICommandPlanPreview as AICommandPlanPreviewView } from "./AICommandPlanPreview";

describe("AICommandPlanPreview", () => {
  it("shows empty state when no plan exists", () => {
    render(<AICommandPlanPreviewView plan={null} />);
    expect(screen.getByText("Select one or more proposals to preview the command plan.")).toBeTruthy();
  });

  it("renders command items, notices, and advisory text", () => {
    const plan: AICommandPlanPreview = {
      selectedProposalCount: 2,
      generatedAtIso: "2026-01-01T00:00:00.000Z",
      previewOnlyLabel: "Preview only — no schedule changes will be made.",
      globalNotices: [],
      summary: {
        totalItems: 2,
        commandItems: 1,
        advisoryItems: 1,
        readyItems: 1,
        warningItems: 0,
        blockedItems: 1,
      },
      items: [
        {
          id: "item-1",
          proposalId: "p1",
          proposalType: "suggest-duration-change",
          proposalTitle: "Duration proposal",
          category: "command",
          commandKind: "UPDATE_TASK",
          targetLabel: "Task: t1",
          payloadSummary: "durationDays: 10 -> 8",
          status: "blocked",
          notices: [
            { severity: "warning", message: "Duration changes affect schedule calculation and require user approval in AI-4.2." },
            { severity: "blocker", message: "Target task no longer exists." },
          ],
        },
        {
          id: "item-2",
          proposalId: "p2",
          proposalType: "management-comment",
          proposalTitle: "Comment",
          category: "advisory-only",
          advisoryLabel: "No command generated — report/comment only.",
          payloadSummary: "Status comment",
          notices: [],
          status: "ready",
        },
      ],
    };

    render(<AICommandPlanPreviewView plan={plan} />);

    expect(screen.getByText("Command Preview")).toBeTruthy();
    expect(screen.getByText("Preview only — no schedule changes will be made.")).toBeTruthy();
    expect(screen.getByText("UPDATE_TASK")).toBeTruthy();
    expect(screen.getByText("Task: t1")).toBeTruthy();
    expect(screen.getByText("durationDays: 10 -> 8")).toBeTruthy();
    expect(screen.getByText("Warning:")).toBeTruthy();
    expect(screen.getByText("Blocker:")).toBeTruthy();
    expect(screen.getByText("No command generated — report/comment only.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review Apply" })).toBeNull();
  });

  it("renders rename Review Apply and invokes handler", () => {
    const onReviewApply = vi.fn();
    const plan: AICommandPlanPreview = {
      selectedProposalCount: 1,
      generatedAtIso: "2026-01-01T00:00:00.000Z",
      previewOnlyLabel: "Preview only — no schedule changes will be made.",
      globalNotices: [],
      summary: {
        totalItems: 1,
        commandItems: 1,
        advisoryItems: 0,
        readyItems: 1,
        warningItems: 0,
        blockedItems: 0,
      },
      items: [
        {
          id: "rename-1",
          proposalId: "proposal-rename-t1",
          proposalType: "improve-activity-name",
          proposalTitle: "Improve activity name: Task 1",
          category: "command",
          commandKind: "UPDATE_TASK",
          targetLabel: "Task: t1",
          payloadSummary: "name: Task 1 -> Define deliverable for WBS 1",
          status: "ready",
          notices: [],
        },
      ],
    };

    render(
      <AICommandPlanPreviewView
        plan={plan}
        onReviewApply={onReviewApply}
        getApplyState={() => ({ status: "requested", message: "Rename requested." })}
        isReviewApplyEnabled={() => true}
      />,
    );

    const button = screen.getByRole("button", { name: "Review Apply" });
    fireEvent.click(button);

    expect(onReviewApply).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Requested: Rename requested.")).toBeTruthy();
  });
});
