/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIProposalCard } from "../services/aiProposals";
import { AIProposalCards } from "./AIProposalCards";

const proposal: AIProposalCard = {
  id: "p-1",
  type: "suggest-duration-change",
  title: "Review long duration: Foundation",
  rationale: "Long activity duration can hide risk.",
  confidence: "medium",
  severity: "risk",
  target: { taskId: "t-1" },
  proposedChange: {
    taskId: "t-1",
    currentDurationDays: 25,
    proposedDurationDays: 12,
    reason: "Split into smaller activities",
  },
  advisoryOnly: true,
};

describe("AIProposalCards", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders proposal card metadata", () => {
    render(
      <AIProposalCards
        proposals={[proposal]}
        decisions={{}}
        onSelect={() => {}}
        onReject={() => {}}
        onClearDecision={() => {}}
      />,
    );

    expect(screen.getByText("Review long duration: Foundation")).toBeTruthy();
    expect(screen.getByText("Long activity duration can hide risk.")).toBeTruthy();
    expect(screen.getByText("Advisory only")).toBeTruthy();
    expect(screen.queryByText(/apply/i)).toBeNull();
  });

  it("fires select/reject/clear handlers", () => {
    const onSelect = vi.fn();
    const onReject = vi.fn();
    const onClearDecision = vi.fn();

    render(
      <AIProposalCards
        proposals={[proposal]}
        decisions={{}}
        onSelect={onSelect}
        onReject={onReject}
        onClearDecision={onClearDecision}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(onSelect).toHaveBeenCalledWith("p-1");
    expect(onReject).toHaveBeenCalledWith("p-1");
    expect(onClearDecision).toHaveBeenCalledWith("p-1");
  });

  it("renders empty-state guidance when no proposals are present", () => {
    render(
      <AIProposalCards
        proposals={[]}
        decisions={{}}
        onSelect={() => {}}
        onReject={() => {}}
        onClearDecision={() => {}}
      />,
    );

    expect(screen.getByText(/No deterministic proposals/i)).toBeTruthy();
  });
});
