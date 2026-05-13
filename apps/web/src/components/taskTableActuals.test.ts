/**
 * W4.4 — Source Actuals / Progress Columns
 *
 * Tests verify that:
 *   1. Source actual start appears in registry and renders correctly.
 *   2. Source actual finish appears in registry and renders correctly.
 *   3. Remaining duration appears.
 *   4. Physical % appears.
 *   5. Duration % appears.
 *   6. Units/work % appears.
 *   7. Missing source actual/progress values display "—".
 *   8. Non-imported projects (empty fidelity state) produce no errors.
 *   9. Recalculation does not overwrite source actual/progress columns
 *      (sourceActuals is only read from ctx, never from scheduleResults).
 *  10. All new columns have source: "imported" and are hidden by default.
 */

import type { SourceTaskActuals, SourceTaskProgress, VisibleRow, WorkMinutes } from "@planner/protocol";
import { MINUTES_PER_DAY } from "@planner/protocol";
import { describe, expect, it } from "vitest";
import { DEFAULT_DATE_DISPLAY_FORMAT, type DateDisplayFormat } from "../utils/dateProjection";
import { TASK_COLUMN_REGISTRY, type TaskTableContext } from "./TaskTable";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRow(id: string): VisibleRow {
  return {
    id,
    name: `Task ${id}`,
    durationWorkMinutes: (5 * MINUTES_PER_DAY) as WorkMinutes,
    constraintType: undefined,
    constraintDateMinutes: undefined,
    isSummary: false,
    canExpand: false,
    isCollapsed: false,
    depth: 0,
    wbsCode: "1",
    siblingOrder: "V",
    parentId: undefined,
    activityCode: undefined,
    sourceActivityId: id,
    rollupStartMinutes: null,
    rollupFinishMinutes: null,
    rollupDurationMinutes: null,
    rollupCost: null,
    rollupWorkMinutes: null,
    rollupPercentComplete: null,
  };
}

function makeCtx(
  sourceActuals: Record<string, SourceTaskActuals> = {},
  sourceProgress: Record<string, SourceTaskProgress> = {},
  projectStartDate = "2026-01-01",
  dateDisplayFormat: DateDisplayFormat = DEFAULT_DATE_DISPLAY_FORMAT,
): TaskTableContext {
  return {
    scheduleResults: {},
    variances: {},
    diagnosticsMap: undefined,
    onUpdateTask: () => {},
    onToggleCollapse: () => {},
    projectStartDate,
    rowHeight: 32,
    rowMeta: undefined,
    sourceActuals,
    sourceProgress,
    dateDisplayFormat,
  };
}

/** Stringify a ReactNode shallowly to extract text content for snapshot assertions. */
function nodeToText(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node === "object" && "props" in (node as object)) {
    const el = node as { props: { children?: unknown } };
    return nodeToText(el.props.children);
  }
  if (Array.isArray(node)) return node.map(nodeToText).join("");
  return "";
}

// ─── Registry existence checks ────────────────────────────────────────────────

describe("W4.4 — Column registry", () => {
  const W44_IDS = ["act-start", "act-finish", "rem-dur", "act-dur", "phys-pct", "dur-pct", "units-pct", "pct-comp"];

  it("all 8 W4.4 columns exist in TASK_COLUMN_REGISTRY", () => {
    const registered = TASK_COLUMN_REGISTRY.map((c) => c.id);
    for (const id of W44_IDS) {
      expect(registered).toContain(id);
    }
  });

  it("all W4.4 columns have source: 'imported'", () => {
    for (const id of W44_IDS) {
      const col = TASK_COLUMN_REGISTRY.find((c) => c.id === id);
      expect(col?.source, `${id}.source`).toBe("imported");
    }
  });

  it("all W4.4 columns are hidden by default (visibleByDefault: false)", () => {
    for (const id of W44_IDS) {
      const col = TASK_COLUMN_REGISTRY.find((c) => c.id === id);
      expect(col?.visibleByDefault, `${id}.visibleByDefault`).toBe(false);
    }
  });

  it("all W4.4 columns are non-editable", () => {
    for (const id of W44_IDS) {
      const col = TASK_COLUMN_REGISTRY.find((c) => c.id === id);
      expect(col?.editable ?? false, `${id}.editable`).toBe(false);
    }
  });
});

// ─── Rendering with data ──────────────────────────────────────────────────────

describe("W4.4 — Source actual start column", () => {
  const col = TASK_COLUMN_REGISTRY.find((c) => c.id === "act-start")!;
  // Project start 2026-01-05. Actual start 2026-05-08 = 123 calendar days later.
  // parseOffsetMinutes stores calendar minutes: 123 * 24 * 60 = 177120.
  const START = "2026-01-05";
  const MIN_MAY_8 = 123 * 24 * 60; // calendar minutes from Jan 5 to May 8

  it("1. renders DD-MMM-YY date string for 2026-05-08", () => {
    const row = makeRow("T1");
    const ctx = makeCtx({ T1: { actualStartMinutes: MIN_MAY_8 } }, {}, START);
    const text = nodeToText(col.renderCell(row, ctx));
    expect(text).toBe("08-May-26");
  });

  it("1b. renders DD-MMM-YYYY when format is DD-MMM-YYYY", () => {
    const row = makeRow("T1");
    const ctx = makeCtx({ T1: { actualStartMinutes: MIN_MAY_8 } }, {}, START, "DD-MMM-YYYY");
    const text = nodeToText(col.renderCell(row, ctx));
    expect(text).toBe("08-May-2026");
  });

  it("1c. renders YYYY-MM-DD when format is YYYY-MM-DD", () => {
    const row = makeRow("T1");
    const ctx = makeCtx({ T1: { actualStartMinutes: MIN_MAY_8 } }, {}, START, "YYYY-MM-DD");
    const text = nodeToText(col.renderCell(row, ctx));
    expect(text).toBe("2026-05-08");
  });

  it("1d. renders time portion when format includes HH:mm and time is stored", () => {
    // 08:00 on May 8 = 177120 + 480 calendar minutes
    const minWithTime = MIN_MAY_8 + 8 * 60;
    const row = makeRow("T1");
    const ctx = makeCtx({ T1: { actualStartMinutes: minWithTime } }, {}, START, "DD-MMM-YY HH:mm");
    const text = nodeToText(col.renderCell(row, ctx));
    expect(text).toBe("08-May-26 08:00");
  });

  it("7. renders '\u2014' when actualStartMinutes is absent", () => {
    const row = makeRow("T1");
    const ctx = makeCtx({ T1: {} }, {});
    const text = nodeToText(col.renderCell(row, ctx));
    expect(text).toBe("\u2014");
  });

  it("7b. renders '\u2014' when task has no entry in sourceActuals", () => {
    const row = makeRow("T1");
    const ctx = makeCtx({}, {});
    const text = nodeToText(col.renderCell(row, ctx));
    expect(text).toBe("\u2014");
  });
});

describe("W4.4 — Source actual finish column", () => {
  const col = TASK_COLUMN_REGISTRY.find((c) => c.id === "act-finish")!;
  // Project start 2026-01-05. Actual finish 2026-06-04 = 150 days later.
  const START = "2026-01-05";
  const MIN_JUN_4 = 150 * 24 * 60;

  it("2. renders DD-MMM-YY for 2026-06-04: 04-Jun-26", () => {
    const row = makeRow("T1");
    const ctx = makeCtx({ T1: { actualFinishMinutes: MIN_JUN_4 } }, {}, START);
    const text = nodeToText(col.renderCell(row, ctx));
    expect(text).toBe("04-Jun-26");
  });

  it("7. renders '\u2014' when actualFinishMinutes is absent", () => {
    const row = makeRow("T2");
    const ctx = makeCtx({ T2: { actualStartMinutes: 1 * 24 * 60 } }, {});
    const text = nodeToText(col.renderCell(row, ctx));
    expect(text).toBe("\u2014");
  });
});

describe("TD-CAL-VIS.4C — Start/Finish source-time fidelity", () => {
  const startCol = TASK_COLUMN_REGISTRY.find((c) => c.id === "start")!;
  const finishCol = TASK_COLUMN_REGISTRY.find((c) => c.id === "finish")!;

  it("renders Start with preserved HH:mm when schedule uses fractional day offset", () => {
    const row = makeRow("T1");
    const ctx: TaskTableContext = {
      ...makeCtx({}, {}, "2026-03-10", "DD-MMM-YY HH:mm"),
      scheduleResults: {
        T1: {
          earlyStartMinutes: (8 / 24) as WorkMinutes,
          earlyFinishMinutes: (6 + (16 / 24)) as WorkMinutes,
          lateStartMinutes: (8 / 24) as WorkMinutes,
          lateFinishMinutes: (6 + (16 / 24)) as WorkMinutes,
          totalFloatMinutes: 0 as WorkMinutes,
          isCritical: false,
        },
      },
    };

    const text = nodeToText(startCol.renderCell(row, ctx));
    expect(text).toBe("10-Mar-26 08:00");
  });

  it("renders Finish with preserved HH:mm when schedule uses fractional day offset", () => {
    const row = makeRow("T1");
    const ctx: TaskTableContext = {
      ...makeCtx({}, {}, "2026-03-10", "DD-MMM-YY HH:mm"),
      scheduleResults: {
        T1: {
          earlyStartMinutes: (8 / 24) as WorkMinutes,
          earlyFinishMinutes: (6 + (16 / 24)) as WorkMinutes,
          lateStartMinutes: (8 / 24) as WorkMinutes,
          lateFinishMinutes: (6 + (16 / 24)) as WorkMinutes,
          totalFloatMinutes: 0 as WorkMinutes,
          isCritical: false,
        },
      },
    };

    const text = nodeToText(finishCol.renderCell(row, ctx));
    expect(text).toBe("16-Mar-26 16:00");
  });
});

describe("TD-CAL-VIS.4D — Post-recalc planner date rendering", () => {
  const startCol = TASK_COLUMN_REGISTRY.find((c) => c.id === "start")!;
  const finishCol = TASK_COLUMN_REGISTRY.find((c) => c.id === "finish")!;

  it("renders planner-calculated Start/Finish from scheduleResults after recalculation", () => {
    const row = makeRow("A1000");
    const ctx: TaskTableContext = {
      ...makeCtx({}, {}, "2026-03-10", "DD-MMM-YY HH:mm"),
      scheduleResults: {
        A1000: {
          earlyStartMinutes: 0 as WorkMinutes,
          earlyFinishMinutes: 7 as WorkMinutes,
          lateStartMinutes: 0 as WorkMinutes,
          lateFinishMinutes: 7 as WorkMinutes,
          totalFloatMinutes: 0 as WorkMinutes,
          isCritical: false,
        },
      },
    };

    expect(nodeToText(startCol.renderCell(row, ctx))).toBe("10-Mar-26 00:00");
    expect(nodeToText(finishCol.renderCell(row, ctx))).toBe("17-Mar-26 00:00");
  });
});

describe("W4.4 — Remaining duration column", () => {
  const col = TASK_COLUMN_REGISTRY.find((c) => c.id === "rem-dur")!;

  it("3. renders days when remainingDurationWorkMinutes is present", () => {
    const row = makeRow("T1");
    const ctx = makeCtx({ T1: { remainingDurationWorkMinutes: (3 * MINUTES_PER_DAY) as WorkMinutes } }, {});
    const rendered = col.renderCell(row, ctx);
    const text = nodeToText(rendered);
    expect(text).toBe("3d");
  });

  it("7. renders '—' when remainingDurationWorkMinutes is absent", () => {
    const row = makeRow("T1");
    const ctx = makeCtx({ T1: {} }, {});
    const rendered = col.renderCell(row, ctx);
    const text = nodeToText(rendered);
    expect(text).toBe("—");
  });
});

describe("W4.4 — Actual duration column", () => {
  const col = TASK_COLUMN_REGISTRY.find((c) => c.id === "act-dur")!;

  it("3b. renders days when actualDurationWorkMinutes is present", () => {
    const row = makeRow("T1");
    const ctx = makeCtx({ T1: { actualDurationWorkMinutes: (2 * MINUTES_PER_DAY) as WorkMinutes } }, {});
    const rendered = col.renderCell(row, ctx);
    const text = nodeToText(rendered);
    expect(text).toBe("2d");
  });
});

describe("W4.4 — Physical % complete column", () => {
  const col = TASK_COLUMN_REGISTRY.find((c) => c.id === "phys-pct")!;

  it("4. renders percentage when physicalPercentComplete is present", () => {
    const row = makeRow("T1");
    const ctx = makeCtx({}, { T1: { physicalPercentComplete: 75 } });
    const rendered = col.renderCell(row, ctx);
    const text = nodeToText(rendered);
    expect(text).toBe("75%");
  });

  it("7. renders '—' when physicalPercentComplete is absent", () => {
    const row = makeRow("T1");
    const ctx = makeCtx({}, {});
    const rendered = col.renderCell(row, ctx);
    const text = nodeToText(rendered);
    expect(text).toBe("—");
  });
});

describe("W4.4 — Duration % complete column", () => {
  const col = TASK_COLUMN_REGISTRY.find((c) => c.id === "dur-pct")!;

  it("5. renders percentage when durationPercentComplete is present", () => {
    const row = makeRow("T1");
    const ctx = makeCtx({}, { T1: { durationPercentComplete: 50 } });
    const rendered = col.renderCell(row, ctx);
    const text = nodeToText(rendered);
    expect(text).toBe("50%");
  });

  it("renders '—' when absent", () => {
    const row = makeRow("T2");
    const ctx = makeCtx({}, { T2: { physicalPercentComplete: 30 } });
    const rendered = col.renderCell(row, ctx);
    const text = nodeToText(rendered);
    expect(text).toBe("—");
  });
});

describe("W4.4 — Units % complete column", () => {
  const col = TASK_COLUMN_REGISTRY.find((c) => c.id === "units-pct")!;

  it("6. renders percentage when unitsPercentComplete is present", () => {
    const row = makeRow("T1");
    const ctx = makeCtx({}, { T1: { unitsPercentComplete: 100 } });
    const rendered = col.renderCell(row, ctx);
    const text = nodeToText(rendered);
    expect(text).toBe("100%");
  });
});

describe("W4.4 — % Complete column", () => {
  const col = TASK_COLUMN_REGISTRY.find((c) => c.id === "pct-comp")!;

  it("6b. renders percentage when percentComplete is present", () => {
    const row = makeRow("T1");
    const ctx = makeCtx({}, { T1: { percentComplete: 25 } });
    const rendered = col.renderCell(row, ctx);
    const text = nodeToText(rendered);
    expect(text).toBe("25%");
  });

  it("7. renders '—' when percentComplete is absent", () => {
    const row = makeRow("T1");
    const ctx = makeCtx({}, {});
    const rendered = col.renderCell(row, ctx);
    const text = nodeToText(rendered);
    expect(text).toBe("—");
  });
});

describe("W4.4 — Non-imported project (empty fidelity)", () => {
  it("8. all W4.4 columns render '—' without crashing when no sourceActuals/sourceProgress", () => {
    const W44_IDS = ["act-start", "act-finish", "rem-dur", "act-dur", "phys-pct", "dur-pct", "units-pct", "pct-comp"];
    const row = makeRow("T1");
    const ctx = makeCtx();
    for (const id of W44_IDS) {
      const col = TASK_COLUMN_REGISTRY.find((c) => c.id === id)!;
      expect(() => col.renderCell(row, ctx)).not.toThrow();
      const text = nodeToText(col.renderCell(row, ctx));
      expect(text, `${id} empty state`).toBe("—");
    }
  });

  it("8b. ctx without sourceActuals/sourceProgress (undefined) renders '\u2014'", () => {
    const row = makeRow("T1");
    // Context with no sourceActuals/sourceProgress keys at all
    const ctxNoFidelity: TaskTableContext = {
      scheduleResults: {},
      variances: {},
      onUpdateTask: () => {},
      onToggleCollapse: () => {},
      projectStartDate: "2026-01-01",
      rowHeight: 32,
      dateDisplayFormat: DEFAULT_DATE_DISPLAY_FORMAT,
    };
    const col = TASK_COLUMN_REGISTRY.find((c) => c.id === "act-start")!;
    expect(() => col.renderCell(row, ctxNoFidelity)).not.toThrow();
    const text = nodeToText(col.renderCell(row, ctxNoFidelity));
    expect(text).toBe("\u2014");
  });
});

describe("W4.4 — Schedule results do not affect source actual columns", () => {
  it("9. act-start renders '—' even when scheduleResults has earlyStartMinutes for that task", () => {
    const row = makeRow("T1");
    const ctx: TaskTableContext = {
      scheduleResults: {
        T1: {
          earlyStartMinutes: (10 * MINUTES_PER_DAY) as WorkMinutes,
          earlyFinishMinutes: (15 * MINUTES_PER_DAY) as WorkMinutes,
          lateStartMinutes: (10 * MINUTES_PER_DAY) as WorkMinutes,
          lateFinishMinutes: (15 * MINUTES_PER_DAY) as WorkMinutes,
          totalFloatMinutes: 0 as WorkMinutes,
          isCritical: true,
        },
      },
      variances: {},
      onUpdateTask: () => {},
      onToggleCollapse: () => {},
      projectStartDate: "2026-01-01",
      rowHeight: 32,
      dateDisplayFormat: DEFAULT_DATE_DISPLAY_FORMAT,
      // No sourceActuals — ensure column reads from sidecar, not from scheduleResults
    };
    const col = TASK_COLUMN_REGISTRY.find((c) => c.id === "act-start")!;
    const text = nodeToText(col.renderCell(row, ctx));
    // Must be "—" since sourceActuals has no entry, regardless of scheduleResults
    expect(text).toBe("—");
  });
});
