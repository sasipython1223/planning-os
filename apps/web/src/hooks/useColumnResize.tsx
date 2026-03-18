import type { CSSProperties } from "react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

/* ── Shared types ───────────────────────────────────────────────── */

/** Describes one column in a resizable CSS-grid mini-table. */
export type GridColumn = {
  key: string;
  initWidth: number;
  /** Minimum width during resize (default 24). */
  minWidth?: number;
};

/* ── Internal constants ─────────────────────────────────────────── */

const DEFAULT_MIN_W = 24;

const handleStyle: CSSProperties = {
  position: "absolute",
  top: 0,
  right: -4,
  width: 8,
  height: "100%",
  cursor: "col-resize",
  zIndex: 1,
};

/* ── ColumnResizer ──────────────────────────────────────────────── */

/** Thin invisible resize hit-area — place inside a header cell with position: relative. */
export function ColumnResizer({ index, startResize }: {
  index: number;
  startResize: (index: number, e: React.MouseEvent) => void;
}) {
  return <div onMouseDown={(e) => startResize(index, e)} style={handleStyle} />;
}

/* ── Template builder ───────────────────────────────────────────── */

function buildTemplate(columns: readonly GridColumn[], widths: readonly number[]): string {
  return columns.map((_col, i) => `${widths[i]}px`).join(" ");
}

/* ── Hook ────────────────────────────────────────────────────────── */

/**
 * Manages resizable column widths for a CSS-grid mini-table.
 *
 * Sets `--grid-cols` on a container ref so header, body, and footer rows share
 * one grid template via `gridTemplateColumns: "var(--grid-cols)"`.
 *
 * During drag the property is updated imperatively (no React state changes).
 * On mouseup the final widths are committed in a single setState call.
 */
export function useColumnResize(columns: readonly GridColumn[]) {
  const [colWidths, setColWidths] = useState(() => columns.map((c) => c.initWidth));
  const containerRef = useRef<HTMLDivElement>(null);

  const widthsRef = useRef(colWidths);
  widthsRef.current = colWidths;
  const colsRef = useRef(columns);
  colsRef.current = columns;

  const template = buildTemplate(columns, colWidths);

  useLayoutEffect(() => {
    containerRef.current?.style.setProperty("--grid-cols", template);
  }, [template]);

  const startResize = useCallback((colIndex: number, e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = widthsRef.current[colIndex];
    const minW = colsRef.current[colIndex]?.minWidth ?? DEFAULT_MIN_W;

    const onMove = (ev: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const newW = Math.max(minW, startW + (ev.clientX - startX));
      const next = [...widthsRef.current];
      next[colIndex] = newW;
      el.style.setProperty("--grid-cols", buildTemplate(colsRef.current, next));
    };

    const onUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      const newW = Math.max(minW, startW + (ev.clientX - startX));
      setColWidths((prev) => {
        const next = [...prev];
        next[colIndex] = newW;
        return next;
      });
    };

    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  return { containerRef, startResize };
}
