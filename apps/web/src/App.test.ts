import { describe, expect, it } from "vitest";
import { buildWorkspaceShellMetrics, getWorkspaceWorkerBadge } from "./App";

describe("W5B-UI.RECOVERY.2 — workspace shell helpers", () => {
  it("builds core workspace metrics from current main state", () => {
    expect(
      buildWorkspaceShellMetrics({
        taskCount: 8,
        visibleTaskCount: 5,
        dependencyCount: 3,
        scheduledCount: 4,
        resourceCount: 2,
      }),
    ).toEqual([
      { label: "Tasks", value: 8 },
      { label: "Visible", value: 5 },
      { label: "Links", value: 3 },
      { label: "Scheduled", value: 4 },
      { label: "Resources", value: 2 },
    ]);
  });

  it("appends the selected histogram resource only when present", () => {
    expect(
      buildWorkspaceShellMetrics({
        taskCount: 2,
        visibleTaskCount: 2,
        dependencyCount: 1,
        scheduledCount: 2,
        resourceCount: 1,
        selectedResourceName: "Crane Crew",
      }).at(-1),
    ).toEqual({ label: "Histogram", value: "Crane Crew" });
  });

  it("reports worker readiness badge text without affecting authority", () => {
    expect(getWorkspaceWorkerBadge(true)).toBe("Worker ready");
    expect(getWorkspaceWorkerBadge(false)).toBe("Worker starting");
  });
});
