// TD-TRACE.2A — Right-click context menu for TaskTable activity rows.
// Read-only actions only. Does not mutate schedule, kernel, or WASM.

import { useEffect, useRef } from "react";

export type TaskContextMenuAction =
  | "open-relationships"
  | "show-driving-logic"
  | "set-float-path-target"
  | "show-float-paths";

export type TaskContextMenuProps = {
  taskId: string;
  isSummary: boolean;
  hasScheduleResult: boolean;
  /** True when dependencyDiagnosticsMap is non-empty (worker has projected diagnostics). */
  hasDrivingDiagnostics: boolean;
  position: { x: number; y: number };
  onAction: (action: TaskContextMenuAction) => void;
  onClose: () => void;
};

const MENU_STYLE: React.CSSProperties = {
  position: "fixed",
  background: "#fff",
  border: "1px solid #c8c8c8",
  borderRadius: 4,
  boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
  padding: "4px 0",
  minWidth: 220,
  zIndex: 9999,
  fontFamily: "Arial, sans-serif",
  fontSize: "0.875em",
};

const ITEM_STYLE: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  background: "none",
  border: "none",
  padding: "6px 16px",
  cursor: "pointer",
  color: "#1a1a1a",
  lineHeight: 1.4,
};

const ITEM_DISABLED_STYLE: React.CSSProperties = {
  ...ITEM_STYLE,
  color: "#999",
  cursor: "default",
};

const SEPARATOR_STYLE: React.CSSProperties = {
  margin: "3px 0",
  border: "none",
  borderTop: "1px solid #e8e8e8",
};

export function TaskContextMenu({
  taskId,
  isSummary,
  hasScheduleResult,
  hasDrivingDiagnostics,
  position,
  onAction,
  onClose,
}: TaskContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Clamp position so menu stays inside viewport
  const vpW = typeof window !== "undefined" ? window.innerWidth : 800;
  const vpH = typeof window !== "undefined" ? window.innerHeight : 600;
  const menuW = 224;
  const menuH = 120;
  const left = Math.min(position.x, vpW - menuW - 8);
  const top = Math.min(position.y, vpH - menuH - 8);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onClose]);

  const floatPathDisabled = isSummary || !hasScheduleResult;
  const floatPathTitle = isSummary
    ? "Not available for WBS/summary rows"
    : !hasScheduleResult
      ? "Activity has no schedule result yet"
      : undefined;

  const drivingDisabled = isSummary || !hasDrivingDiagnostics;
  const drivingTitle = isSummary
    ? "Not available for WBS/summary rows"
    : !hasDrivingDiagnostics
      ? "Driving diagnostics are not available for this activity"
      : undefined;

  function handleAction(action: TaskContextMenuAction) {
    onClose();
    onAction(action);
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Activity actions"
      data-testid="task-context-menu"
      data-task-id={taskId}
      style={{ ...MENU_STYLE, left, top }}
    >
      <button
        role="menuitem"
        style={ITEM_STYLE}
        onClick={() => handleAction("open-relationships")}
      >
        Open Relationships
      </button>

      <hr style={SEPARATOR_STYLE} aria-hidden="true" />

      <button
        role="menuitem"
        style={drivingDisabled ? ITEM_DISABLED_STYLE : ITEM_STYLE}
        disabled={drivingDisabled}
        title={drivingTitle}
        onClick={() => {
          if (!drivingDisabled) handleAction("show-driving-logic");
        }}
      >
        Show Driving Logic
      </button>

      <hr style={SEPARATOR_STYLE} aria-hidden="true" />

      <button
        role="menuitem"
        style={floatPathDisabled ? ITEM_DISABLED_STYLE : ITEM_STYLE}
        disabled={floatPathDisabled}
        title={floatPathTitle}
        onClick={() => {
          if (!floatPathDisabled) handleAction("set-float-path-target");
        }}
      >
        Set as Float Path Target
      </button>

      <button
        role="menuitem"
        style={floatPathDisabled ? ITEM_DISABLED_STYLE : ITEM_STYLE}
        disabled={floatPathDisabled}
        title={floatPathTitle}
        onClick={() => {
          if (!floatPathDisabled) handleAction("show-float-paths");
        }}
      >
        Show Float Paths to This Activity
      </button>
    </div>
  );
}
