import type { VisibleRow, WorkMinutes } from "@planner/protocol";
import { describe, expect, it } from "vitest";
import { computeBusinessRollups } from "../src/businessRollup.js";
import { clearCollapsedIds, filterVisibleRows, setCollapsedIds, setFullProjection } from "../src/hierarchy.js";
import { wm } from "./helpers.js";

/** Helper to build a minimal VisibleRow for testing. */
function row(
  id: string,
  opts: {
    parentId?: string;
    depth?: number;
    isSummary?: boolean;
    durationWorkMinutes?: WorkMinutes;
  } = {},
): VisibleRow {
  return {
    id,
    name: id,
    durationWorkMinutes: opts.durationWorkMinutes ?? wm(480),
    siblingOrder: "A",
    depth: opts.depth ?? 0,
    isSummary: opts.isSummary ?? false,
    parentId: opts.parentId,
    isCollapsed: false,
    canExpand: opts.isSummary ?? false,
    wbsCode: "1",
    rollupStartMinutes: null,
    rollupFinishMinutes: null,
    rollupDurationMinutes: null,
    rollupCost: null,
    rollupWorkMinutes: null,
    rollupPercentComplete: null,
  };
}

describe("computeBusinessRollups", () => {
  // ── 1. Leaf business values projected correctly ──

  it("leaf task projects durationWorkMinutes as rollupWorkMinutes", () => {
    const rows = [row("A", { durationWorkMinutes: wm(960) })];
    const result = computeBusinessRollups(rows);
    expect(result[0].rollupWorkMinutes).toBe(960);
  });

  it("leaf task projects null cost (no canonical cost field yet)", () => {
    const rows = [row("A")];
    const result = computeBusinessRollups(rows);
    expect(result[0].rollupCost).toBeNull();
  });

  it("leaf task projects null percentComplete (no canonical field yet)", () => {
    const rows = [row("A")];
    const result = computeBusinessRollups(rows);
    expect(result[0].rollupPercentComplete).toBeNull();
  });

  // ── 2. Summary cost = sum(children) ──

  it("summary cost sums children costs", () => {
    // Cost is currently null for all leaves (no canonical cost field).
    // When null, parent should also be null.
    const rows = [
      row("S", { isSummary: true, depth: 0 }),
      row("A", { parentId: "S", depth: 1 }),
      row("B", { parentId: "S", depth: 1 }),
    ];
    const result = computeBusinessRollups(rows);
    const summary = result.find(r => r.id === "S")!;
    expect(summary.rollupCost).toBeNull();
  });

  // ── 3. Summary work = sum(children) ──

  it("summary work sums children work", () => {
    const rows = [
      row("S", { isSummary: true, depth: 0 }),
      row("A", { parentId: "S", depth: 1, durationWorkMinutes: wm(480) }),
      row("B", { parentId: "S", depth: 1, durationWorkMinutes: wm(960) }),
    ];
    const result = computeBusinessRollups(rows);
    const summary = result.find(r => r.id === "S")!;
    expect(summary.rollupWorkMinutes).toBe(480 + 960);
  });

  // ── 4. Summary percent complete weighted correctly ──

  it("summary percent complete is null when all children are null", () => {
    // No canonical percentComplete yet, so all leaves are null
    const rows = [
      row("S", { isSummary: true, depth: 0 }),
      row("A", { parentId: "S", depth: 1, durationWorkMinutes: wm(480) }),
      row("B", { parentId: "S", depth: 1, durationWorkMinutes: wm(960) }),
    ];
    const result = computeBusinessRollups(rows);
    const summary = result.find(r => r.id === "S")!;
    expect(summary.rollupPercentComplete).toBeNull();
  });

  // ── 5. Nested summaries aggregate bottom-up ──

  it("nested summaries aggregate work bottom-up", () => {
    const rows = [
      row("Root", { isSummary: true, depth: 0 }),
      row("Mid", { parentId: "Root", isSummary: true, depth: 1 }),
      row("A", { parentId: "Mid", depth: 2, durationWorkMinutes: wm(480) }),
      row("B", { parentId: "Mid", depth: 2, durationWorkMinutes: wm(960) }),
      row("C", { parentId: "Root", depth: 1, durationWorkMinutes: wm(240) }),
    ];
    const result = computeBusinessRollups(rows);

    const mid = result.find(r => r.id === "Mid")!;
    expect(mid.rollupWorkMinutes).toBe(480 + 960);

    const root = result.find(r => r.id === "Root")!;
    // Root = Mid (1440) + C (240) = 1680
    expect(root.rollupWorkMinutes).toBe(480 + 960 + 240);
  });

  // ── 6. Null handling ──

  it("summary with no children stays null", () => {
    const rows = [
      row("S", { isSummary: true, depth: 0 }),
    ];
    const result = computeBusinessRollups(rows);
    const s = result[0];
    expect(s.rollupCost).toBeNull();
    expect(s.rollupWorkMinutes).toBeNull();
    expect(s.rollupPercentComplete).toBeNull();
  });

  it("does not coerce null cost to zero", () => {
    const rows = [
      row("S", { isSummary: true, depth: 0 }),
      row("A", { parentId: "S", depth: 1 }),
    ];
    const result = computeBusinessRollups(rows);
    const summary = result.find(r => r.id === "S")!;
    // Cost is null on leaf, so parent stays null (not zero)
    expect(summary.rollupCost).toBeNull();
  });

  // ── 7. Collapsed summary retains same rollup values ──

  it("collapsed summary retains same business rollup values as expanded", () => {
    const rows = [
      row("S", { isSummary: true, depth: 0 }),
      row("A", { parentId: "S", depth: 1, durationWorkMinutes: wm(480) }),
      row("B", { parentId: "S", depth: 1, durationWorkMinutes: wm(960) }),
    ];

    // Compute business rollups on full projection (all rows)
    const fullRolled = computeBusinessRollups(rows);
    const summaryExpanded = fullRolled.find(r => r.id === "S")!;
    expect(summaryExpanded.rollupWorkMinutes).toBe(1440);

    // Simulate collapse: set projection, then filter
    setFullProjection(fullRolled);
    setCollapsedIds(new Set(["S"]));

    const collapsed = filterVisibleRows(fullRolled);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].id).toBe("S");
    // Business rollup values are preserved from full projection
    expect(collapsed[0].rollupWorkMinutes).toBe(1440);

    clearCollapsedIds();
  });

  // ── 8. Visible filtering does not change parent business totals ──

  it("visible filtering does not change parent business totals", () => {
    const rows = [
      row("Root", { isSummary: true, depth: 0 }),
      row("Mid", { parentId: "Root", isSummary: true, depth: 1 }),
      row("A", { parentId: "Mid", depth: 2, durationWorkMinutes: wm(480) }),
      row("B", { parentId: "Mid", depth: 2, durationWorkMinutes: wm(960) }),
    ];

    const fullRolled = computeBusinessRollups(rows);
    const rootFull = fullRolled.find(r => r.id === "Root")!;
    expect(rootFull.rollupWorkMinutes).toBe(1440);

    // Collapse Mid — hides A and B
    setFullProjection(fullRolled);
    setCollapsedIds(new Set(["Mid"]));
    const visible = filterVisibleRows(fullRolled);

    expect(visible).toHaveLength(2); // Root + Mid
    const rootVisible = visible.find(r => r.id === "Root")!;
    // Parent total unchanged despite hidden descendants
    expect(rootVisible.rollupWorkMinutes).toBe(1440);

    clearCollapsedIds();
  });

  // ── 9. Reference stability when rollup values unchanged ──

  it("preserves reference equality when business rollup values unchanged", () => {
    const rows = [
      row("A", { durationWorkMinutes: wm(480) }),
    ];

    const first = computeBusinessRollups(rows);
    // Run again with the already-stamped rows — values haven't changed
    const second = computeBusinessRollups(first);
    expect(second[0]).toBe(first[0]); // same object reference
  });

  it("creates new object when business rollup values change", () => {
    const original = row("A", { durationWorkMinutes: wm(480) });
    const first = computeBusinessRollups([original]);
    expect(first[0]).not.toBe(original); // new object (null → 480 for workMinutes)
    expect(first[0].rollupWorkMinutes).toBe(480);
  });

  it("preserves row order in output", () => {
    const rows = [
      row("S", { isSummary: true, depth: 0 }),
      row("A", { parentId: "S", depth: 1 }),
      row("B", { parentId: "S", depth: 1 }),
    ];
    const result = computeBusinessRollups(rows);
    expect(result.map(r => r.id)).toEqual(["S", "A", "B"]);
  });
});
