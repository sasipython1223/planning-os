// @vitest-environment jsdom
// TD-TRACE.2A/2B — TaskContextMenu unit tests

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskContextMenu, type TaskContextMenuAction } from "./TaskContextMenu";

afterEach(() => {
  cleanup();
});

// ── Fixtures ──────────────────────────────────────────────────────────────

const DEFAULT_POSITION = { x: 100, y: 200 };

function renderMenu(overrides?: {
  isSummary?: boolean;
  hasScheduleResult?: boolean;
  hasDrivingDiagnostics?: boolean;
  onAction?: (a: TaskContextMenuAction) => void;
  onClose?: () => void;
}) {
  const onAction = overrides?.onAction ?? vi.fn();
  const onClose = overrides?.onClose ?? vi.fn();
  render(
    <TaskContextMenu
      taskId="task-abc"
      isSummary={overrides?.isSummary ?? false}
      hasScheduleResult={overrides?.hasScheduleResult ?? true}
      hasDrivingDiagnostics={overrides?.hasDrivingDiagnostics ?? true}
      position={DEFAULT_POSITION}
      onAction={onAction}
      onClose={onClose}
    />,
  );
  return { onAction, onClose };
}

// ── 1. Right-click opens context menu ─────────────────────────────────────
// (Tested at integration level via TaskTable; here we verify the menu renders)
describe("TaskContextMenu renders", () => {
  it("renders all four menu items", () => {
    renderMenu();
    expect(screen.getByRole("menuitem", { name: /open relationships/i })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: /show driving logic/i })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: /set as float path target/i })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: /show float paths to this activity/i })).toBeDefined();
  });

  it("has role=menu on the container", () => {
    renderMenu();
    expect(screen.getByRole("menu")).toBeDefined();
  });

  it("exposes data-task-id attribute", () => {
    renderMenu();
    expect(screen.getByRole("menu").getAttribute("data-task-id")).toBe("task-abc");
  });
});

// ── 2. Escape closes menu ──────────────────────────────────────────────────
describe("Escape closes menu", () => {
  it("calls onClose when Escape is pressed", () => {
    const { onClose } = renderMenu();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose for non-Escape keys", () => {
    const { onClose } = renderMenu();
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ── 3. Outside click closes menu ──────────────────────────────────────────
describe("outside click closes menu", () => {
  it("calls onClose when pointer down fires outside the menu", () => {
    const { onClose } = renderMenu();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when pointer down is inside the menu", () => {
    const { onClose } = renderMenu();
    const menu = screen.getByRole("menu");
    fireEvent.pointerDown(menu);
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ── 4. Open Relationships ──────────────────────────────────────────────────
describe("Open Relationships action", () => {
  it("dispatches open-relationships and closes menu", () => {
    const { onAction, onClose } = renderMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /open relationships/i }));
    expect(onAction).toHaveBeenCalledWith("open-relationships");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ── 5. Set as Float Path Target ────────────────────────────────────────────
describe("Set as Float Path Target action", () => {
  it("dispatches set-float-path-target for normal scheduled activity", () => {
    const { onAction } = renderMenu({ isSummary: false, hasScheduleResult: true });
    fireEvent.click(screen.getByRole("menuitem", { name: /set as float path target/i }));
    expect(onAction).toHaveBeenCalledWith("set-float-path-target");
  });

  it("does not dispatch for summary rows", () => {
    const { onAction } = renderMenu({ isSummary: true, hasScheduleResult: true });
    fireEvent.click(screen.getByRole("menuitem", { name: /set as float path target/i }));
    expect(onAction).not.toHaveBeenCalled();
  });

  it("does not dispatch for unscheduled rows", () => {
    const { onAction } = renderMenu({ isSummary: false, hasScheduleResult: false });
    fireEvent.click(screen.getByRole("menuitem", { name: /set as float path target/i }));
    expect(onAction).not.toHaveBeenCalled();
  });
});

// ── 6. Show Float Paths to This Activity ──────────────────────────────────
describe("Show Float Paths to This Activity action", () => {
  it("dispatches show-float-paths for normal scheduled activity", () => {
    const { onAction } = renderMenu({ isSummary: false, hasScheduleResult: true });
    fireEvent.click(screen.getByRole("menuitem", { name: /show float paths to this activity/i }));
    expect(onAction).toHaveBeenCalledWith("show-float-paths");
  });

  it("does not dispatch for summary rows", () => {
    const { onAction } = renderMenu({ isSummary: true });
    fireEvent.click(screen.getByRole("menuitem", { name: /show float paths to this activity/i }));
    expect(onAction).not.toHaveBeenCalled();
  });
});

// ── 7. WBS/summary row disables float path actions ────────────────────────
describe("summary row disabled state", () => {
  it("renders Float Path buttons as disabled for summary rows", () => {
    renderMenu({ isSummary: true, hasScheduleResult: true });
    const items = screen.getAllByRole("menuitem");
    const setBtn = items.find((el) => el.textContent?.includes("Set as Float Path Target"));
    const showBtn = items.find((el) => el.textContent?.includes("Show Float Paths to This Activity"));
    expect(setBtn?.getAttribute("disabled")).not.toBeNull();
    expect(showBtn?.getAttribute("disabled")).not.toBeNull();
  });

  it("renders Float Path buttons as disabled when no schedule result", () => {
    renderMenu({ isSummary: false, hasScheduleResult: false });
    const items = screen.getAllByRole("menuitem");
    const setBtn = items.find((el) => el.textContent?.includes("Set as Float Path Target"));
    const showBtn = items.find((el) => el.textContent?.includes("Show Float Paths to This Activity"));
    expect(setBtn?.getAttribute("disabled")).not.toBeNull();
    expect(showBtn?.getAttribute("disabled")).not.toBeNull();
  });

  it("Open Relationships is always enabled", () => {
    renderMenu({ isSummary: true, hasScheduleResult: false });
    const items = screen.getAllByRole("menuitem");
    const relBtn = items.find((el) => el.textContent?.includes("Open Relationships"));
    expect(relBtn?.getAttribute("disabled")).toBeNull();
  });

  it("Show Driving Logic is disabled for summary rows", () => {
    renderMenu({ isSummary: true, hasDrivingDiagnostics: true });
    const items = screen.getAllByRole("menuitem");
    const btn = items.find((el) => el.textContent?.includes("Show Driving Logic"));
    expect(btn?.getAttribute("disabled")).not.toBeNull();
  });

  it("Show Driving Logic is disabled when diagnostics unavailable", () => {
    renderMenu({ isSummary: false, hasDrivingDiagnostics: false });
    const items = screen.getAllByRole("menuitem");
    const btn = items.find((el) => el.textContent?.includes("Show Driving Logic"));
    expect(btn?.getAttribute("disabled")).not.toBeNull();
  });

  it("Show Driving Logic is enabled for normal activity with diagnostics", () => {
    renderMenu({ isSummary: false, hasDrivingDiagnostics: true });
    const items = screen.getAllByRole("menuitem");
    const btn = items.find((el) => el.textContent?.includes("Show Driving Logic"));
    expect(btn?.getAttribute("disabled")).toBeNull();
  });
});

// ── Show Driving Logic action ──────────────────────────────────────────────
describe("Show Driving Logic action", () => {
  it("appears in the menu for a normal activity", () => {
    renderMenu();
    expect(screen.getByRole("menuitem", { name: /show driving logic/i })).toBeDefined();
  });

  it("dispatches show-driving-logic and closes menu", () => {
    const { onAction, onClose } = renderMenu({ isSummary: false, hasDrivingDiagnostics: true });
    fireEvent.click(screen.getByRole("menuitem", { name: /show driving logic/i }));
    expect(onAction).toHaveBeenCalledWith("show-driving-logic");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch show-driving-logic for summary row", () => {
    const { onAction } = renderMenu({ isSummary: true });
    fireEvent.click(screen.getByRole("menuitem", { name: /show driving logic/i }));
    expect(onAction).not.toHaveBeenCalled();
  });

  it("does not call Float Path Analysis when show-driving-logic is clicked", () => {
    const { onAction } = renderMenu({ isSummary: false, hasDrivingDiagnostics: true });
    fireEvent.click(screen.getByRole("menuitem", { name: /show driving logic/i }));
    const call = (onAction as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("show-driving-logic");
    expect(call[0]).not.toBe("show-float-paths");
    expect(call[0]).not.toBe("set-float-path-target");
  });

  it("does not mutate — action is a plain string identifier only", () => {
    const { onAction } = renderMenu({ isSummary: false, hasDrivingDiagnostics: true });
    fireEvent.click(screen.getByRole("menuitem", { name: /show driving logic/i }));
    const call = (onAction as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(typeof call[0]).toBe("string");
  });
});

// ── 8. No dependency mutation or CPM invoked ─────────────────────────────
// These are verified structurally: TaskContextMenu emits only an action string
// to onAction and calls onClose. It has no direct access to workerRef,
// scheduleResults computation, or dependencies list.
describe("no mutation or computation side effects", () => {
  it("onAction receives only a string action identifier, not a worker command", () => {
    const { onAction } = renderMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /open relationships/i }));
    const call = (onAction as ReturnType<typeof vi.fn>).mock.calls[0];
    // Action must be a plain string constant, not an object
    expect(typeof call[0]).toBe("string");
    expect(call[0]).toBe("open-relationships");
  });
});
