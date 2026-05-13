// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

class MockWorker {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App temporal shadow status note", () => {
  const workers: MockWorker[] = [];

  beforeEach(() => {
    workers.length = 0;

    class WorkerCtor extends MockWorker {
      constructor() {
        super();
        workers.push(this);
      }
    }
    vi.stubGlobal("Worker", WorkerCtor as unknown as typeof Worker);

    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
      unobserve() {}
    });
  });

  it("renders temporal shadow status note in source variance diagnostics panel", async () => {
    render(<App />);

    await waitFor(() => {
      expect(workers.length).toBeGreaterThan(0);
    });

    const worker = workers[0];
    worker.onmessage?.({
      data: {
        type: "DIFF_STATE",
        v: 1,
        payload: {
          tasks: [],
          dependencies: [],
          scheduleResults: {},
          baselines: {},
          variances: {},
          projectStartDate: "2026-05-08",
          nonWorkingDays: [],
          resources: [],
          assignments: [],
          resourceHistogram: {},
          canUndo: false,
          canRedo: false,
          visibleRows: [],
          collapsedIds: [],
          scheduleLifecycle: "plannerCalculatedWithVariance",
          sourceImportRecord: {
            format: "xer",
            sourceFileName: "demo.xer",
            importedAt: "2026-05-09T10:00:00Z",
            status: "plannerCalculatedWithVariance",
            summary: {
              taskCount: 0,
              dependencyCount: 0,
              resourceCount: 0,
              assignmentCount: 0,
              calendarInfo: "none",
            },
            sourceProjectSettings: {
              defaultCalendarId: "default",
            },
            diagnostics: [],
          },
          sourceCalculatedVarianceReport: {
            totalCompared: 1,
            noVarianceCount: 0,
            startVarianceCount: 0,
            finishVarianceCount: 1,
            majorVarianceCount: 0,
            taskVariances: [
              {
                taskId: "T1",
                taskName: "Task 1",
                sourceStartMinutes: 0,
                sourceFinishMinutes: 480,
                plannerStartMinutes: 0,
                plannerFinishMinutes: 960,
                startVarianceMinutes: 0,
                finishVarianceMinutes: 480,
                varianceSeverity: "minor",
              },
            ],
          },
          sourceImportFidelityState: {
            actualsByTaskId: {},
            progressByTaskId: {},
            sourceDatesByTaskId: {},
            immutableSourceDateTaskIds: [],
            resourceCalendarDiagnosticsByTaskId: {},
            lagCalendarDiagnosticsByDependencyId: {},
            expectedFinishByTaskId: {},
            progressOverrideByTaskId: {},
            retainedLogicByDependencyId: {},
          },
        },
      },
    } as MessageEvent);

    const statusNote = await screen.findByTestId("temporal-shadow-status-note");
    expect(statusNote.textContent).toContain(
      "Temporal calendar-aware shadow calculation is available. Authority remains slot engine.",
    );
  });
});
