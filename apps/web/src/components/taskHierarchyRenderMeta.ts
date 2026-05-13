import type { VisibleRow } from "@planner/protocol";

export interface LaneSegment {
  summaryId: string;
  summaryRowIndex: number;
  depth: number;
  laneIndex: number;
  startsHere: boolean;
  continuesBelow: boolean;
  endsHere: boolean;
  isSelfSummary: boolean;
  colorToken: string;
}

export interface RowHierarchyRenderMeta {
  rowIndex: number;
  isSummary: boolean;
  depth: number;
  summaryEndIndex: number | null;
  activeAncestorDepths: number[];
  laneSegments: LaneSegment[];
}

interface SummarySpan {
  id: string;
  rowIndex: number;
  depth: number;
  endIndex: number;
}

const MAX_PALETTE_DEPTH = 5;

export function buildHierarchyRenderMeta(rows: VisibleRow[]): RowHierarchyRenderMeta[] {
  if (rows.length === 0) return [];

  const summaryEndByIndex = new Map<number, number>();
  const openSummaries: Array<{ rowIndex: number; depth: number }> = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    while (openSummaries.length > 0 && row.depth <= openSummaries[openSummaries.length - 1].depth) {
      const completed = openSummaries.pop();
      if (completed) summaryEndByIndex.set(completed.rowIndex, i - 1);
    }
    if (row.isSummary) {
      openSummaries.push({ rowIndex: i, depth: row.depth });
    }
  }

  while (openSummaries.length > 0) {
    const completed = openSummaries.pop();
    if (completed) summaryEndByIndex.set(completed.rowIndex, rows.length - 1);
  }

  const summarySpans: SummarySpan[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    if (!rows[i].isSummary) continue;
    const endIndex = summaryEndByIndex.get(i) ?? i;
    summarySpans.push({ id: rows[i].id, rowIndex: i, depth: rows[i].depth, endIndex });
  }

  const activeSpans: SummarySpan[] = [];
  let spanCursor = 0;

  return rows.map((row, rowIndex) => {
    while (activeSpans.length > 0 && activeSpans[activeSpans.length - 1].endIndex < rowIndex) {
      activeSpans.pop();
    }

    while (spanCursor < summarySpans.length && summarySpans[spanCursor].rowIndex === rowIndex) {
      activeSpans.push(summarySpans[spanCursor]);
      spanCursor += 1;
    }

    const laneSegments: LaneSegment[] = activeSpans.map((span, laneIndex) => ({
      summaryId: span.id,
      summaryRowIndex: span.rowIndex,
      depth: span.depth,
      laneIndex,
      startsHere: rowIndex === span.rowIndex,
      continuesBelow: rowIndex < span.endIndex,
      endsHere: rowIndex === span.endIndex,
      isSelfSummary: row.id === span.id,
      colorToken: `--hier-lane-${Math.min(span.depth, MAX_PALETTE_DEPTH - 1)}`,
    }));

    return {
      rowIndex,
      isSummary: row.isSummary,
      depth: row.depth,
      summaryEndIndex: row.isSummary ? summaryEndByIndex.get(rowIndex) ?? rowIndex : null,
      activeAncestorDepths: laneSegments.map((lane) => lane.depth),
      laneSegments,
    };
  });
}