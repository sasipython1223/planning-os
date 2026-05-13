// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("App recalculation guardrail", () => {
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

  function pushSourceImportedState(worker: MockWorker, highRisk: boolean): void {
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
          scheduleLifecycle: "sourceImportedNotCalculated",
          sourceImportRecord: {
            format: "xer",
            sourceFileName: "high-risk.xer",
            importedAt: "2026-05-09T10:00:00Z",
            status: "sourceImportedNotCalculated",
            summary: {
              taskCount: 0,
              dependencyCount: 0,
              resourceCount: 0,
              assignmentCount: 0,
              calendarInfo: "none",
              calendarFidelity: {
                totalCalendars: 1,
                taskCalendarAssignments: highRisk ? 67 : 0,
                resourceCalendarAssignments: 0,
                exceptionCount: 0,
                calendarsWithInheritance: 0,
                calendarsSimplifiedForEngine: highRisk ? 1 : 0,
                unresolvedInheritanceCount: 0,
              },
            },
            diagnostics: highRisk
              ? [
                  {
                    code: "TASK_CALENDAR_IGNORED_BY_ENGINE",
                    severity: "info",
                    message: "Task calendars preserved but inactive",
                  },
                ]
              : [],
          },
          sourceImportFidelityState: {
            actualsByTaskId: {},
            progressByTaskId: {},
          },
        },
      },
    } as MessageEvent);
  }

  function hasRecalculationCall(worker: MockWorker): boolean {
    return worker.postMessage.mock.calls.some((call) => call[0]?.type === "RUN_IMPORTED_SCHEDULE_RECALCULATION");
  }

  it("shows confirmation and blocks recalculation when user cancels on high-risk import", async () => {
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmSpy as unknown as typeof window.confirm);

    render(<App />);

    await waitFor(() => {
      expect(workers.length).toBeGreaterThan(0);
    });

    const worker = workers[0];
    pushSourceImportedState(worker, true);

    fireEvent.click(await screen.findByText("Run Planner Recalculation"));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(hasRecalculationCall(worker)).toBe(false);
    expect(screen.getByText(/High calendar-risk import:/)).toBeTruthy();
  });

  it("dispatches recalculation without confirmation on low-risk import", async () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy as unknown as typeof window.confirm);

    render(<App />);

    await waitFor(() => {
      expect(workers.length).toBeGreaterThan(0);
    });

    const worker = workers[0];
    pushSourceImportedState(worker, false);

    fireEvent.click(await screen.findByText("Run Planner Recalculation"));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(hasRecalculationCall(worker)).toBe(true);
  });
});
