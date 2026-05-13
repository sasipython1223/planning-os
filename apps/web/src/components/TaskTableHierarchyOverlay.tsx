import { useEffect, useMemo, type CSSProperties } from "react";
import { WBS_BAND_STEP, WBS_BAND_WIDTH } from "./hierarchyLayout";
import type { RowHierarchyRenderMeta } from "./taskHierarchyRenderMeta";

// Visual tuning constants — adjust here only.
const DEBUG_FLAG = "hierarchyDebug";

// Production mode: clearly visible but not harsh
const PROD_BAND_OPACITY = 0.68;

// Debug/proof mode: high contrast to verify band continuity
const DEBUG_BAND_OPACITY = 0.88;

interface ContainerSpan {
  key: string;
  summaryRowIndex: number;
  endRowIndex: number;
  laneIndex: number;
  depth: number;
  colorToken: string; // e.g. "--hier-lane-0"
}

function deriveContainerSpans(meta: RowHierarchyRenderMeta[]): ContainerSpan[] {
  const result: ContainerSpan[] = [];
  for (const m of meta) {
    if (!m.isSummary || m.summaryEndIndex === null) continue;
    const selfLane = m.laneSegments.find((s) => s.isSelfSummary);
    if (!selfLane) continue;
    result.push({
      key: selfLane.summaryId,
      summaryRowIndex: m.rowIndex,
      endRowIndex: m.summaryEndIndex,
      laneIndex: selfLane.laneIndex,
      depth: selfLane.depth,
      colorToken: selfLane.colorToken,
    });
  }
  return result;
}

interface TaskTableHierarchyOverlayProps {
  /** Full hierarchy metadata for all tasks (not just visible slice). */
  hierarchyMeta: RowHierarchyRenderMeta[];
  /** Row height in px — must match the current density metric used by TaskTable. */
  rowHeight: number;
  /** First visible row index (from virtual window). */
  startIndex: number;
  /** Last visible row index (from virtual window). -1 = no rows. */
  endIndex: number;
  /** Absolute top pixel offset of the visible slice within the phantom spacer. */
  offsetY: number;
  /** Width of the SVG overlay — must equal WBS_BAND_FIELD_WIDTH. */
  overlayWidth: number;
}

/**
 * Dedicated structural WBS band field rendered as an absolutely-positioned SVG.
 *
 * Each visible summary span renders a continuous narrow vertical pillar — a filled
 * rect spanning from the summary row through all its visible descendants. Deeper
 * nesting levels are inset by WBS_BAND_STEP so parent and child pillars are
 * simultaneously visible side-by-side within the dedicated WBS column.
 *
 * The SVG is clipped to WBS_BAND_FIELD_WIDTH (the wbs table column width) and
 * sits at z-index 2 above the empty wbs <td> spacer cells.
 *
 * Owns: WBS band pillar geometry only.
 * Does NOT own: row text, Act ID values, summary row styling, any data semantics.
 */
export function TaskTableHierarchyOverlay({
  hierarchyMeta,
  rowHeight,
  startIndex,
  endIndex,
  offsetY,
  overlayWidth,
}: TaskTableHierarchyOverlayProps) {
  const allSpans = useMemo(() => deriveContainerSpans(hierarchyMeta), [hierarchyMeta]);
  const isDebugProofMode =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get(DEBUG_FLAG) === "1";

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (isDebugProofMode) {
      document.body.setAttribute("data-hierarchy-debug", "1");
    } else {
      document.body.removeAttribute("data-hierarchy-debug");
    }
    return () => {
      document.body.removeAttribute("data-hierarchy-debug");
    };
  }, [isDebugProofMode]);

  const bandOpacity = isDebugProofMode ? DEBUG_BAND_OPACITY : PROD_BAND_OPACITY;

  const visibleHeight = Math.max(0, (endIndex - startIndex + 1) * rowHeight);

  // In production, the row-owned WBS band system (renderRowOwnedWbsBands) is the
  // sole paint owner. The SVG overlay only activates in debug mode so that band
  // continuity can be verified without overwriting the production fill model.
  // Keeping both active at once would stack semi-transparent SVG fills on top of
  // the already-opaque row-owned fills, producing darker corners and inconsistent
  // wall colors across row types.
  if (!isDebugProofMode) return null;

  // Filter to only spans that intersect the visible window.
  const visibleSpans = allSpans.filter(
    (s) => s.endRowIndex >= startIndex && s.summaryRowIndex <= endIndex,
  );

  if (visibleSpans.length === 0 || visibleHeight === 0) return null;

  // Convert an absolute row index to an SVG-local y coordinate.
  const svgY = (rowAbsIndex: number) => (rowAbsIndex - startIndex) * rowHeight;

  return (
    <svg
      style={{
        position: "absolute",
        top: offsetY,
        left: 0,
        width: overlayWidth,
        height: visibleHeight,
        pointerEvents: "none",
        overflow: "hidden",
        zIndex: 2,
      } as CSSProperties}
      aria-hidden="true"
      data-overlay-debug={isDebugProofMode ? "true" : "false"}
    >
      {visibleSpans.map((span) => {
        const rawTopY = svgY(span.summaryRowIndex);
        const rawBottomY = svgY(span.endRowIndex + 1);

        const clampedTopY = Math.max(0, Math.min(visibleHeight, rawTopY));
        const clampedBottomY = Math.min(visibleHeight, rawBottomY);

        if (clampedBottomY <= clampedTopY) return null;

        const pillarX = span.laneIndex * WBS_BAND_STEP;
        const pillarW = WBS_BAND_WIDTH;
        const showRoof = rawTopY >= 0 && rawTopY < visibleHeight;

        // ── Unified branch container geometry ─────────────────────────────
        //
        // Summary row  → wide cap rect: spans the full wbs cell from pillarX to
        //                overlayWidth, height = rowHeight. This fills the wbs cell
        //                with branch color so the summary row reads as one continuous
        //                surface across the wbs column and the tinted Act ID/Desc cells.
        //
        // Descendants  → narrow pillar rect: width = WBS_BAND_WIDTH from pillarX.
        //                Starts immediately below the summary row.
        //
        // Both rects use identical fill/opacity — no seam, same material.
        const summaryRoofY = clampedTopY;
        const summaryRoofH = showRoof ? Math.min(rowHeight, clampedBottomY - summaryRoofY) : 0;
        const roofCapWidth = overlayWidth - pillarX;

        // Wall starts immediately after the roof and continues through descendants.
        const wallY = summaryRoofY + summaryRoofH;
        const wallH = Math.max(0, clampedBottomY - wallY);

        return (
          <g key={span.key} style={{ color: `var(${span.colorToken})` }}>
            {/* Wide cap: fills wbs cell on the summary (roof) row — bridges to Act ID gradient */}
            {summaryRoofH > 0 && (
              <rect
                x={pillarX}
                y={summaryRoofY}
                width={roofCapWidth}
                height={summaryRoofH}
                fill="currentColor"
                fillOpacity={bandOpacity}
              />
            )}
            {/* Narrow wall: starts at summary-row boundary and continues through descendants */}
            {wallH > 0 && (
              <rect
                x={pillarX}
                y={wallY}
                width={pillarW}
                height={wallH}
                fill="currentColor"
                fillOpacity={bandOpacity}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
