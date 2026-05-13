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

describe("App import details access", () => {
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

  it("shows Import Details menu item only when sourceImportRecord exists", async () => {
    render(<App />);

    await waitFor(() => {
      expect(workers.length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByText("View"));
    expect(screen.queryByTestId("open-import-details")).toBeNull();

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
          scheduleLifecycle: "sourceImportedNotCalculated",
          sourceImportRecord: {
            format: "xer",
            sourceFileName: "demo.xer",
            importedAt: "2026-05-09T10:00:00Z",
            status: "sourceImportedNotCalculated",
            summary: {
              taskCount: 0,
              dependencyCount: 0,
              resourceCount: 0,
              assignmentCount: 0,
              calendarInfo: "none",
            },
            diagnostics: [],
          },
          sourceImportFidelityState: {
            actualsByTaskId: {},
            progressByTaskId: {},
          },
        },
      },
    } as MessageEvent);

    fireEvent.click(screen.getByText("View"));
    expect(await screen.findByTestId("open-import-details")).toBeTruthy();
  });
});
