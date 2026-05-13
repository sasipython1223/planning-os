/**
 * W5B-B2.12A — Read-only invariants for unexplained-divergence bucket
 * diagnostics.
 *
 * These tests assert the classifier's behaviour AND the project-level
 * invariants the milestone requires:
 *   - bucket attachment does not change `unexplainedDivergenceCount`
 *   - bucket attachment does not change row `classification` values
 *   - bucket attachment does not change variance counts / max-variance fields
 *   - bucket is set ONLY on `unexplained_divergence` rows
 *   - priority order is deterministic (first-match wins)
 *
 * The classifier is hypothesis-grade. Tests assert what the classifier
 * DOES, not that any bucket corresponds to a real root cause in any
 * particular project.
 */

import type {
    ScheduleResultMap,
    TemporalCandidateTaskComparison,
    TemporalCandidateTaskResult,
    WorkMinutes,
} from "@planner/protocol";
import { describe, expect, it } from "vitest";
import { compareSlotVsTemporalCandidate } from "../../src/schedule/TemporalCandidateComparator.js";
import {
    attachUnexplainedDivergenceBuckets,
    buildTaskBucketHints,
    classifyUnexplainedDivergenceBucket,
    summarizeUnexplainedDivergenceBuckets,
    type UnexplainedDivergenceBucketHints,
} from "../../src/schedule/UnexplainedDivergenceBuckets.js";

const wm = (value: number): WorkMinutes => value as WorkMinutes;

const slot = (overrides?: Partial<ScheduleResultMap[string]>): ScheduleResultMap[string] => ({
  earlyStartMinutes: wm(0),
  earlyFinishMinutes: wm(5),
  lateStartMinutes: wm(0),
  lateFinishMinutes: wm(5),
  totalFloatMinutes: wm(0),
  isCritical: false,
  ...overrides,
});

const temporal = (
  taskId: string,
  overrides?: Partial<TemporalCandidateTaskResult>,
): TemporalCandidateTaskResult => ({
  taskId,
  earlyStart: wm(0),
  earlyFinish: wm(5),
  lateStart: wm(0),
  lateFinish: wm(5),
  totalFloat: wm(0),
  freeFloat: wm(0),
  critical: false,
  calendarIdUsed: null,
  ...overrides,
});

const baseHints = (overrides?: Partial<UnexplainedDivergenceBucketHints>): UnexplainedDivergenceBucketHints => ({
  isSummary: false,
  hasMissingCalendarMetadata: false,
  hasConstraint: false,
  hasNonZeroLag: false,
  predecessorCount: 0,
  successorCount: 0,
  ...overrides,
});

const noVariance: Pick<
  TemporalCandidateTaskComparison,
  "startVarianceMinutes" | "finishVarianceMinutes" | "totalFloatVarianceMinutes"
> = {
  startVarianceMinutes: wm(0),
  finishVarianceMinutes: wm(0),
  totalFloatVarianceMinutes: wm(0),
};

describe("W5B-B2.12A unexplained-divergence bucket classifier (priority order)", () => {
  it("returns summary_or_wbs_rollup_candidate first when isSummary=true (highest priority)", () => {
    // Even with every other signal set, summary wins.
    expect(
      classifyUnexplainedDivergenceBucket(
        baseHints({
          isSummary: true,
          hasMissingCalendarMetadata: true,
          hasConstraint: true,
          hasNonZeroLag: true,
          predecessorCount: 5,
          successorCount: 5,
        }),
        { startVarianceMinutes: wm(480), finishVarianceMinutes: wm(480), totalFloatVarianceMinutes: wm(0) },
      ),
    ).toBe("summary_or_wbs_rollup_candidate");
  });

  it("returns missing_calendar_metadata_candidate when summary=false and metadata absent", () => {
    expect(
      classifyUnexplainedDivergenceBucket(
        baseHints({ hasMissingCalendarMetadata: true, hasConstraint: true, hasNonZeroLag: true }),
        noVariance,
      ),
    ).toBe("missing_calendar_metadata_candidate");
  });

  it("returns constraint_semantics_candidate when constraint set and no higher-priority signal", () => {
    expect(
      classifyUnexplainedDivergenceBucket(
        baseHints({ hasConstraint: true, hasNonZeroLag: true, predecessorCount: 5 }),
        noVariance,
      ),
    ).toBe("constraint_semantics_candidate");
  });

  it("returns lag_semantics_candidate when non-zero lag and no higher-priority signal", () => {
    // W5B-B2.12A.5: calendar_boundary now precedes lag in priority order, so
    // we use a non-workday-multiple variance to ensure lag fires.
    expect(
      classifyUnexplainedDivergenceBucket(
        baseHints({ hasNonZeroLag: true, predecessorCount: 5, successorCount: 5 }),
        { startVarianceMinutes: wm(17), finishVarianceMinutes: wm(0), totalFloatVarianceMinutes: wm(0) },
      ),
    ).toBe("lag_semantics_candidate");
  });

  it("returns calendar_boundary_candidate when variance is a positive multiple of one work-day", () => {
    expect(
      classifyUnexplainedDivergenceBucket(
        baseHints({ predecessorCount: 5, successorCount: 5 }),
        { startVarianceMinutes: wm(960), finishVarianceMinutes: wm(0), totalFloatVarianceMinutes: wm(0) },
      ),
    ).toBe("calendar_boundary_candidate");
  });

  it("returns relationship_chain_candidate when only relationship counts are elevated", () => {
    expect(
      classifyUnexplainedDivergenceBucket(
        baseHints({ predecessorCount: 3, successorCount: 0 }),
        { startVarianceMinutes: wm(17), finishVarianceMinutes: wm(0), totalFloatVarianceMinutes: wm(0) },
      ),
    ).toBe("relationship_chain_candidate");
  });

  it("returns unknown_unclassified when nothing matches", () => {
    expect(classifyUnexplainedDivergenceBucket(baseHints(), noVariance)).toBe("unknown_unclassified");
  });

  it("does not treat sub-workday variance as calendar_boundary_candidate", () => {
    expect(
      classifyUnexplainedDivergenceBucket(
        baseHints(),
        { startVarianceMinutes: wm(60), finishVarianceMinutes: wm(0), totalFloatVarianceMinutes: wm(0) },
      ),
    ).toBe("unknown_unclassified");
  });
});

describe("W5B-B2.12A bucket attachment — read-only invariants", () => {
  it("does not change unexplainedDivergenceCount, classifications, or variance maxima", () => {
    const result = compareSlotVsTemporalCandidate({
      slotResults: {
        A: slot({ earlyStartMinutes: wm(0), earlyFinishMinutes: wm(5) }),
        B: slot({ earlyStartMinutes: wm(0), earlyFinishMinutes: wm(5) }),
      },
      candidateTasks: [
        // A is identical
        temporal("A"),
        // B has unexplained divergence (no expected/unsupported flags)
        temporal("B", { earlyStart: wm(120), earlyFinish: wm(125) }),
      ],
      expectedCalendarDivergenceTaskIds: [],
      unsupportedFeatureFlags: [],
    });

    const before = {
      count: result.summary.unexplainedDivergenceCount,
      classifications: result.summary.taskComparisons.map((r) => r.classification),
      maxStart: result.summary.maxAbsStartVarianceMinutes,
      maxFinish: result.summary.maxAbsFinishVarianceMinutes,
      maxFloat: result.summary.maxAbsTotalFloatVarianceMinutes,
      identical: result.summary.identicalTaskCount,
    };

    const enriched = attachUnexplainedDivergenceBuckets({
      taskComparisons: result.summary.taskComparisons,
      hintsByTaskId: new Map([["B", baseHints({ predecessorCount: 3 })]]),
    });

    // count and classifications unchanged
    expect(before.count).toBe(1);
    expect(enriched.map((r) => r.classification)).toEqual(before.classifications);

    // bucket only on unexplained rows
    const aRow = enriched.find((r) => r.taskId === "A")!;
    const bRow = enriched.find((r) => r.taskId === "B")!;
    expect(aRow.unexplainedDivergenceBucket ?? null).toBeNull();
    expect(bRow.unexplainedDivergenceBucket).toBe("relationship_chain_candidate");

    // summary aggregates do not change (we attached buckets but the comparator
    // already produced these — re-reading them post-attach must match)
    expect(result.summary.maxAbsStartVarianceMinutes).toBe(before.maxStart);
    expect(result.summary.maxAbsFinishVarianceMinutes).toBe(before.maxFinish);
    expect(result.summary.maxAbsTotalFloatVarianceMinutes).toBe(before.maxFloat);
    expect(result.summary.identicalTaskCount).toBe(before.identical);
  });

  it("defaults to unknown_unclassified when no hints are provided for an unexplained row", () => {
    const result = compareSlotVsTemporalCandidate({
      slotResults: { B: slot() },
      candidateTasks: [temporal("B", { earlyStart: wm(7) })],
      expectedCalendarDivergenceTaskIds: [],
      unsupportedFeatureFlags: [],
    });
    const enriched = attachUnexplainedDivergenceBuckets({
      taskComparisons: result.summary.taskComparisons,
      hintsByTaskId: new Map(),
    });
    expect(enriched[0]?.unexplainedDivergenceBucket).toBe("unknown_unclassified");
  });

  it("never sets a bucket on non-unexplained_divergence rows", () => {
    const result = compareSlotVsTemporalCandidate({
      slotResults: { A: slot() },
      candidateTasks: [temporal("A")], // identical -> no_difference
      expectedCalendarDivergenceTaskIds: [],
      unsupportedFeatureFlags: [],
    });
    const enriched = attachUnexplainedDivergenceBuckets({
      taskComparisons: result.summary.taskComparisons,
      hintsByTaskId: new Map([["A", baseHints({ isSummary: true })]]),
    });
    expect(enriched[0]?.classification).toBe("no_difference");
    expect(enriched[0]?.unexplainedDivergenceBucket ?? null).toBeNull();
  });
});

describe("W5B-B2.12A bucket summary aggregator", () => {
  it("aggregates per-bucket counts and ignores non-unexplained rows", () => {
    const rows: TemporalCandidateTaskComparison[] = [
      {
        taskId: "A",
        classification: "unexplained_divergence",
        unexplainedDivergenceBucket: "summary_or_wbs_rollup_candidate",
        startVarianceMinutes: wm(0),
        finishVarianceMinutes: wm(0),
        lateStartVarianceMinutes: wm(0),
        lateFinishVarianceMinutes: wm(0),
        totalFloatVarianceMinutes: wm(0),
        freeFloatVarianceMinutes: null,
        criticalVariance: false,
      },
      {
        taskId: "B",
        classification: "unexplained_divergence",
        unexplainedDivergenceBucket: "lag_semantics_candidate",
        startVarianceMinutes: wm(0),
        finishVarianceMinutes: wm(0),
        lateStartVarianceMinutes: wm(0),
        lateFinishVarianceMinutes: wm(0),
        totalFloatVarianceMinutes: wm(0),
        freeFloatVarianceMinutes: null,
        criticalVariance: false,
      },
      {
        taskId: "C",
        classification: "no_difference", // must be ignored
        unexplainedDivergenceBucket: "unknown_unclassified", // even if set
        startVarianceMinutes: wm(0),
        finishVarianceMinutes: wm(0),
        lateStartVarianceMinutes: wm(0),
        lateFinishVarianceMinutes: wm(0),
        totalFloatVarianceMinutes: wm(0),
        freeFloatVarianceMinutes: null,
        criticalVariance: false,
      },
    ];
    const summary = summarizeUnexplainedDivergenceBuckets(rows);
    expect(summary.summary_or_wbs_rollup_candidate).toBe(1);
    expect(summary.lag_semantics_candidate).toBe(1);
    expect(summary.unknown_unclassified).toBe(0); // C ignored (classification mismatch)
    // every key present
    expect(summary.calendar_boundary_candidate).toBe(0);
    expect(summary.constraint_semantics_candidate).toBe(0);
    expect(summary.relationship_chain_candidate).toBe(0);
    expect(summary.missing_calendar_metadata_candidate).toBe(0);
  });
});

describe("W5B-B2.12A.3 hint builder — calendar lookup correction", () => {
  const stubCalendarDef = {}; // truthy value is all the classifier checks for
  const baseInput = () => ({
    task: { assignedCalendarId: null as string | null, constraintType: null as string | null, isStructuralSummary: false },
    projectCalendarId: "default" as string | null,
    calendarDefinitions: { default: stubCalendarDef } as Record<string, unknown>,
    calendars: {} as Record<string, unknown>,
    resolvedCalendarDefinitions: {} as Record<string, unknown>,
    hasChildrenInHierarchy: false,
    hasNonZeroLag: false,
    predecessorCount: 0,
    successorCount: 0,
  });

  it("treats an assignedCalendarId present in resolvedCalendarDefinitions as loaded", () => {
    const hints = buildTaskBucketHints({
      ...baseInput(),
      task: { assignedCalendarId: "10288", constraintType: null, isStructuralSummary: false },
      calendarDefinitions: { default: stubCalendarDef },
      calendars: {},
      resolvedCalendarDefinitions: { "10288": stubCalendarDef },
    });
    expect(hints.hasMissingCalendarMetadata).toBe(false);
    expect(
      classifyUnexplainedDivergenceBucket(hints, {
        startVarianceMinutes: wm(1),
        finishVarianceMinutes: wm(1),
        totalFloatVarianceMinutes: wm(0),
      }),
    ).not.toBe("missing_calendar_metadata_candidate");
  });

  it("treats an assignedCalendarId present in calendarDefinitions as loaded (preserved fallback)", () => {
    const hints = buildTaskBucketHints({
      ...baseInput(),
      task: { assignedCalendarId: "planner-A", constraintType: null, isStructuralSummary: false },
      calendarDefinitions: { "planner-A": stubCalendarDef },
      calendars: {},
      resolvedCalendarDefinitions: {},
    });
    expect(hints.hasMissingCalendarMetadata).toBe(false);
  });

  it("treats an assignedCalendarId present in calendars as loaded (preserved fallback)", () => {
    const hints = buildTaskBucketHints({
      ...baseInput(),
      task: { assignedCalendarId: "legacy-B", constraintType: null, isStructuralSummary: false },
      calendarDefinitions: {},
      calendars: { "legacy-B": stubCalendarDef },
      resolvedCalendarDefinitions: {},
    });
    expect(hints.hasMissingCalendarMetadata).toBe(false);
  });

  it("flags missing_calendar_metadata when the assignedCalendarId is absent from ALL three registries", () => {
    const hints = buildTaskBucketHints({
      ...baseInput(),
      task: { assignedCalendarId: "ghost-999", constraintType: null, isStructuralSummary: false },
      calendarDefinitions: { default: stubCalendarDef },
      calendars: {},
      resolvedCalendarDefinitions: { "10288": stubCalendarDef },
    });
    expect(hints.hasMissingCalendarMetadata).toBe(true);
    expect(
      classifyUnexplainedDivergenceBucket(hints, noVariance),
    ).toBe("missing_calendar_metadata_candidate");
  });

  it("falls back to the project calendar id when assignedCalendarId is null/undefined", () => {
    const hints = buildTaskBucketHints({
      ...baseInput(),
      task: { assignedCalendarId: null, constraintType: null, isStructuralSummary: false },
      projectCalendarId: "default",
      calendarDefinitions: { default: stubCalendarDef },
    });
    expect(hints.hasMissingCalendarMetadata).toBe(false);
  });

  it("flags missing metadata when neither assignedCalendarId nor projectCalendarId resolve anywhere", () => {
    const hints = buildTaskBucketHints({
      ...baseInput(),
      task: { assignedCalendarId: null, constraintType: null, isStructuralSummary: false },
      projectCalendarId: null,
      calendarDefinitions: {},
      calendars: {},
      resolvedCalendarDefinitions: {},
    });
    expect(hints.hasMissingCalendarMetadata).toBe(true);
  });
});

describe("W5B-B2.12A.3 hint builder — structural-summary correction", () => {
  const baseInput = () => ({
    task: { assignedCalendarId: null as string | null, constraintType: null as string | null, isStructuralSummary: false },
    projectCalendarId: "default" as string | null,
    calendarDefinitions: { default: {} } as Record<string, unknown>,
    calendars: {} as Record<string, unknown>,
    resolvedCalendarDefinitions: {} as Record<string, unknown>,
    hasChildrenInHierarchy: false,
    hasNonZeroLag: false,
    predecessorCount: 0,
    successorCount: 0,
  });

  it("classifies a childless task.isStructuralSummary=true row as summary_or_wbs_rollup_candidate", () => {
    const hints = buildTaskBucketHints({
      ...baseInput(),
      task: { assignedCalendarId: null, constraintType: null, isStructuralSummary: true },
      hasChildrenInHierarchy: false,
    });
    expect(hints.isSummary).toBe(true);
    expect(classifyUnexplainedDivergenceBucket(hints, noVariance)).toBe("summary_or_wbs_rollup_candidate");
  });

  it("still classifies a child-based summary (parent of >=1 child) as summary_or_wbs_rollup_candidate", () => {
    const hints = buildTaskBucketHints({
      ...baseInput(),
      task: { assignedCalendarId: null, constraintType: null, isStructuralSummary: false },
      hasChildrenInHierarchy: true,
    });
    expect(hints.isSummary).toBe(true);
    expect(classifyUnexplainedDivergenceBucket(hints, noVariance)).toBe("summary_or_wbs_rollup_candidate");
  });

  it("does not flag a leaf row (no children, isStructuralSummary=false) as summary", () => {
    const hints = buildTaskBucketHints({
      ...baseInput(),
      task: { assignedCalendarId: null, constraintType: null, isStructuralSummary: false },
      hasChildrenInHierarchy: false,
    });
    expect(hints.isSummary).toBe(false);
  });
});

describe("W5B-B2.12A.3 bucket attachment — does not perturb gate-relevant fields", () => {
  it("does not change unexplainedDivergenceCount when corrected hints reclassify rows", () => {
    const result = compareSlotVsTemporalCandidate({
      slotResults: {
        leafImported: slot({ earlyStartMinutes: wm(0), earlyFinishMinutes: wm(5) }),
        leafGhost: slot({ earlyStartMinutes: wm(0), earlyFinishMinutes: wm(5) }),
        childlessSummary: slot({ earlyStartMinutes: wm(0), earlyFinishMinutes: wm(5) }),
      },
      candidateTasks: [
        temporal("leafImported", { earlyStart: wm(1), earlyFinish: wm(6) }),
        temporal("leafGhost", { earlyStart: wm(1), earlyFinish: wm(6) }),
        temporal("childlessSummary", { earlyStart: wm(1), earlyFinish: wm(6) }),
      ],
      expectedCalendarDivergenceTaskIds: [],
      unsupportedFeatureFlags: [],
    });
    const beforeCount = result.summary.unexplainedDivergenceCount;
    const beforeClassifications = result.summary.taskComparisons.map((r) => r.classification);

    // Build hints with the corrected helper for three representative rows.
    const stub = {};
    const hintsByTaskId = new Map<string, UnexplainedDivergenceBucketHints>([
      [
        "leafImported",
        buildTaskBucketHints({
          task: { assignedCalendarId: "10288", constraintType: null, isStructuralSummary: false },
          projectCalendarId: "default",
          calendarDefinitions: { default: stub },
          calendars: {},
          resolvedCalendarDefinitions: { "10288": stub },
          hasChildrenInHierarchy: false,
          hasNonZeroLag: false,
          predecessorCount: 0,
          successorCount: 0,
        }),
      ],
      [
        "leafGhost",
        buildTaskBucketHints({
          task: { assignedCalendarId: "ghost-999", constraintType: null, isStructuralSummary: false },
          projectCalendarId: "default",
          calendarDefinitions: { default: stub },
          calendars: {},
          resolvedCalendarDefinitions: { "10288": stub },
          hasChildrenInHierarchy: false,
          hasNonZeroLag: false,
          predecessorCount: 0,
          successorCount: 0,
        }),
      ],
      [
        "childlessSummary",
        buildTaskBucketHints({
          task: { assignedCalendarId: null, constraintType: null, isStructuralSummary: true },
          projectCalendarId: "default",
          calendarDefinitions: { default: stub },
          calendars: {},
          resolvedCalendarDefinitions: {},
          hasChildrenInHierarchy: false,
          hasNonZeroLag: false,
          predecessorCount: 0,
          successorCount: 0,
        }),
      ],
    ]);

    const enriched = attachUnexplainedDivergenceBuckets({
      taskComparisons: result.summary.taskComparisons,
      hintsByTaskId,
    });

    // Gate-relevant invariants: count and classifications unchanged.
    expect(result.summary.unexplainedDivergenceCount).toBe(beforeCount);
    expect(enriched.map((r) => r.classification)).toEqual(beforeClassifications);

    // B2.12A.3 corrected behaviour:
    const leafImported = enriched.find((r) => r.taskId === "leafImported")!;
    const leafGhost = enriched.find((r) => r.taskId === "leafGhost")!;
    const childlessSummary = enriched.find((r) => r.taskId === "childlessSummary")!;
    expect(leafImported.unexplainedDivergenceBucket).not.toBe("missing_calendar_metadata_candidate");
    expect(leafGhost.unexplainedDivergenceBucket).toBe("missing_calendar_metadata_candidate");
    expect(childlessSummary.unexplainedDivergenceBucket).toBe("summary_or_wbs_rollup_candidate");
  });
});

// =============================================================================
// W5B-B2.12A.5 — ASAP-default + calendar-binding hints refinement.
//
// These tests pin down the diagnostic refinement. They prove the classifier:
//   (a) no longer fires constraint_semantics_candidate for the P6 no-op
//       ASAP default (constraintType==="ASAP" AND constraintDateMinutes==null);
//   (b) routes effectively-unconstrained ASAP rows with a slot-vs-temporal
//       immediate-task calendar binding mismatch to calendar_boundary_candidate;
//   (c) keeps constraint_semantics_candidate for non-ASAP types and for ASAP
//       with an explicit anchor date;
//   (d) preserves all read-only invariants: unexplainedDivergenceCount,
//       classifications, variance maxima, fallbackReason, gate are untouched.
//
// Diagnostic-only: no scheduling change, no WBS hierarchy traversal, no
// calendar-inheritance resolution. O(1) per task.
// =============================================================================
describe("W5B-B2.12A.5 hint builder — hasMeaningfulConstraint", () => {
  const baseInput = () => ({
    task: {
      assignedCalendarId: null as string | null,
      constraintType: null as string | null,
      constraintDateMinutes: null as number | null,
      isStructuralSummary: false,
    },
    projectCalendarId: "default" as string | null,
    calendarDefinitions: { default: {} } as Record<string, unknown>,
    calendars: {} as Record<string, unknown>,
    resolvedCalendarDefinitions: {} as Record<string, unknown>,
    hasChildrenInHierarchy: false,
    hasNonZeroLag: false,
    predecessorCount: 0,
    successorCount: 0,
  });

  it("(c) ASAP + valid constraintDateMinutes ⇒ hasMeaningfulConstraint=true ⇒ constraint_semantics_candidate", () => {
    const hints = buildTaskBucketHints({
      ...baseInput(),
      task: {
        assignedCalendarId: null,
        constraintType: "ASAP",
        constraintDateMinutes: 480,
        isStructuralSummary: false,
      },
    });
    expect(hints.hasMeaningfulConstraint).toBe(true);
    expect(classifyUnexplainedDivergenceBucket(hints, noVariance)).toBe(
      "constraint_semantics_candidate",
    );
  });

  it("(e) non-ASAP constraint types (MSO/SNET/FNLT/ALAP/MFO) ⇒ hasMeaningfulConstraint=true ⇒ constraint_semantics_candidate", () => {
    for (const ct of ["MSO", "SNET", "FNLT", "ALAP", "MFO"]) {
      const hints = buildTaskBucketHints({
        ...baseInput(),
        task: {
          assignedCalendarId: null,
          constraintType: ct,
          constraintDateMinutes: null,
          isStructuralSummary: false,
        },
      });
      expect(hints.hasMeaningfulConstraint, `ct=${ct}`).toBe(true);
      expect(classifyUnexplainedDivergenceBucket(hints, noVariance), `ct=${ct}`).toBe(
        "constraint_semantics_candidate",
      );
    }
  });

  it("(d) MFO + valid constraintDateMinutes + calendar mismatch ⇒ constraint_semantics_candidate (constraint wins)", () => {
    const hints = buildTaskBucketHints({
      ...baseInput(),
      task: {
        assignedCalendarId: "imported-7",
        constraintType: "MFO",
        constraintDateMinutes: 960,
        isStructuralSummary: false,
      },
      projectCalendarId: "default",
      resolvedCalendarDefinitions: { "imported-7": {}, default: {} },
    });
    expect(hints.hasMeaningfulConstraint).toBe(true);
    expect(hints.slotVsTemporalCalendarBindingDiffers).toBe(true);
    expect(classifyUnexplainedDivergenceBucket(hints, noVariance)).toBe(
      "constraint_semantics_candidate",
    );
  });

  it("ASAP + null constraintDateMinutes ⇒ hasMeaningfulConstraint=false (P6 no-op default)", () => {
    const hints = buildTaskBucketHints({
      ...baseInput(),
      task: {
        assignedCalendarId: null,
        constraintType: "ASAP",
        constraintDateMinutes: null,
        isStructuralSummary: false,
      },
    });
    expect(hints.hasMeaningfulConstraint).toBe(false);
    // No other signal ⇒ unknown.
    expect(classifyUnexplainedDivergenceBucket(hints, noVariance)).toBe("unknown_unclassified");
  });

  it("ASAP + absent constraintDateMinutes (undefined) ⇒ hasMeaningfulConstraint=false", () => {
    const hints = buildTaskBucketHints({
      ...baseInput(),
      task: {
        assignedCalendarId: null,
        constraintType: "ASAP",
        // constraintDateMinutes: omitted entirely
        isStructuralSummary: false,
      },
    });
    expect(hints.hasMeaningfulConstraint).toBe(false);
  });

  it("null constraintType (any) ⇒ hasMeaningfulConstraint=false (no constraint at all)", () => {
    const hints = buildTaskBucketHints({
      ...baseInput(),
      task: {
        assignedCalendarId: null,
        constraintType: null,
        constraintDateMinutes: null,
        isStructuralSummary: false,
      },
    });
    expect(hints.hasMeaningfulConstraint).toBe(false);
  });
});

describe("W5B-B2.12A.5 hint builder — slotVsTemporalCalendarBindingDiffers (O(1))", () => {
  const baseInput = () => ({
    task: {
      assignedCalendarId: null as string | null,
      constraintType: null as string | null,
      constraintDateMinutes: null as number | null,
      isStructuralSummary: false,
    },
    projectCalendarId: "default" as string | null,
    calendarDefinitions: { default: {} } as Record<string, unknown>,
    calendars: {} as Record<string, unknown>,
    resolvedCalendarDefinitions: {} as Record<string, unknown>,
    hasChildrenInHierarchy: false,
    hasNonZeroLag: false,
    predecessorCount: 0,
    successorCount: 0,
  });

  it("(a) ASAP + null date + assignedCalendarId differs from project ⇒ calendar_boundary_candidate", () => {
    const hints = buildTaskBucketHints({
      ...baseInput(),
      task: {
        assignedCalendarId: "imported-A",
        constraintType: "ASAP",
        constraintDateMinutes: null,
        isStructuralSummary: false,
      },
      projectCalendarId: "default",
      resolvedCalendarDefinitions: { "imported-A": {}, default: {} },
    });
    expect(hints.slotVsTemporalCalendarBindingDiffers).toBe(true);
    expect(hints.hasMissingCalendarMetadata).toBe(false);
    expect(classifyUnexplainedDivergenceBucket(hints, noVariance)).toBe(
      "calendar_boundary_candidate",
    );
  });

  it("(b) ASAP + absent date + assignedCalendarId differs from project ⇒ calendar_boundary_candidate", () => {
    const hints = buildTaskBucketHints({
      ...baseInput(),
      task: {
        assignedCalendarId: "imported-B",
        constraintType: "ASAP",
        // constraintDateMinutes omitted
        isStructuralSummary: false,
      },
      projectCalendarId: "default",
      resolvedCalendarDefinitions: { "imported-B": {}, default: {} },
    });
    expect(hints.slotVsTemporalCalendarBindingDiffers).toBe(true);
    expect(classifyUnexplainedDivergenceBucket(hints, noVariance)).toBe(
      "calendar_boundary_candidate",
    );
  });

  it("assignedCalendarId === projectCalendarId ⇒ slotVsTemporalCalendarBindingDiffers=false", () => {
    const hints = buildTaskBucketHints({
      ...baseInput(),
      task: {
        assignedCalendarId: "default",
        constraintType: "ASAP",
        constraintDateMinutes: null,
        isStructuralSummary: false,
      },
      projectCalendarId: "default",
    });
    expect(hints.slotVsTemporalCalendarBindingDiffers).toBe(false);
  });

  it("assignedCalendarId null ⇒ slotVsTemporalCalendarBindingDiffers=false (no binding)", () => {
    const hints = buildTaskBucketHints({
      ...baseInput(),
      task: {
        assignedCalendarId: null,
        constraintType: "ASAP",
        constraintDateMinutes: null,
        isStructuralSummary: false,
      },
      projectCalendarId: "default",
    });
    expect(hints.slotVsTemporalCalendarBindingDiffers).toBe(false);
  });

  it("(f) summary + ASAP-default + calendar mismatch ⇒ summary wins (highest priority)", () => {
    const hints = buildTaskBucketHints({
      ...baseInput(),
      task: {
        assignedCalendarId: "imported-S",
        constraintType: "ASAP",
        constraintDateMinutes: null,
        isStructuralSummary: true,
      },
      projectCalendarId: "default",
      resolvedCalendarDefinitions: { "imported-S": {}, default: {} },
    });
    expect(hints.isSummary).toBe(true);
    expect(hints.slotVsTemporalCalendarBindingDiffers).toBe(true);
    expect(classifyUnexplainedDivergenceBucket(hints, noVariance)).toBe(
      "summary_or_wbs_rollup_candidate",
    );
  });

  it("(g) missing calendar metadata + calendar mismatch ⇒ missing_calendar_metadata wins (higher priority)", () => {
    const hints = buildTaskBucketHints({
      ...baseInput(),
      task: {
        assignedCalendarId: "ghost-99",
        constraintType: "ASAP",
        constraintDateMinutes: null,
        isStructuralSummary: false,
      },
      projectCalendarId: "default",
      // ghost-99 is in NONE of the registries
      resolvedCalendarDefinitions: { default: {} },
    });
    expect(hints.hasMissingCalendarMetadata).toBe(true);
    expect(classifyUnexplainedDivergenceBucket(hints, noVariance)).toBe(
      "missing_calendar_metadata_candidate",
    );
  });

  it("(h1) ASAP + null + no mismatch + no other signal + relationship evidence ⇒ relationship_chain_candidate", () => {
    const hints = buildTaskBucketHints({
      ...baseInput(),
      task: {
        assignedCalendarId: null,
        constraintType: "ASAP",
        constraintDateMinutes: null,
        isStructuralSummary: false,
      },
      projectCalendarId: "default",
      predecessorCount: 3,
      successorCount: 0,
    });
    expect(hints.slotVsTemporalCalendarBindingDiffers).toBe(false);
    expect(hints.hasMeaningfulConstraint).toBe(false);
    // variance 17 ⇒ not a workday multiple ⇒ falls through to relationship_chain
    expect(
      classifyUnexplainedDivergenceBucket(hints, {
        startVarianceMinutes: wm(17),
        finishVarianceMinutes: wm(0),
        totalFloatVarianceMinutes: wm(0),
      }),
    ).toBe("relationship_chain_candidate");
  });

  it("(h2) ASAP + null + no mismatch + no relationship evidence ⇒ unknown_unclassified", () => {
    const hints = buildTaskBucketHints({
      ...baseInput(),
      task: {
        assignedCalendarId: null,
        constraintType: "ASAP",
        constraintDateMinutes: null,
        isStructuralSummary: false,
      },
      projectCalendarId: "default",
    });
    expect(
      classifyUnexplainedDivergenceBucket(hints, {
        startVarianceMinutes: wm(17),
        finishVarianceMinutes: wm(0),
        totalFloatVarianceMinutes: wm(0),
      }),
    ).toBe("unknown_unclassified");
  });
});

describe("W5B-B2.12A.5 read-only invariants — relabelling never perturbs gate-relevant fields", () => {
  it("(i) relabelling ASAP-default rows does not change unexplainedDivergenceCount or classifications", () => {
    const result = compareSlotVsTemporalCandidate({
      slotResults: {
        // Three rows that DIVERGE → unexplained_divergence:
        asapDefault: slot({ earlyStartMinutes: wm(0), earlyFinishMinutes: wm(5) }),
        asapWithDate: slot({ earlyStartMinutes: wm(0), earlyFinishMinutes: wm(5) }),
        msoRow: slot({ earlyStartMinutes: wm(0), earlyFinishMinutes: wm(5) }),
      },
      candidateTasks: [
        temporal("asapDefault", { earlyStart: wm(1), earlyFinish: wm(6) }),
        temporal("asapWithDate", { earlyStart: wm(1), earlyFinish: wm(6) }),
        temporal("msoRow", { earlyStart: wm(1), earlyFinish: wm(6) }),
      ],
      expectedCalendarDivergenceTaskIds: [],
      unsupportedFeatureFlags: [],
    });
    const beforeCount = result.summary.unexplainedDivergenceCount;
    const beforeClassifications = result.summary.taskComparisons.map((r) => r.classification);
    const beforeMaxStart = result.summary.maxAbsStartVarianceMinutes;
    const beforeMaxFinish = result.summary.maxAbsFinishVarianceMinutes;

    const stub = {};
    const hintsByTaskId = new Map<string, UnexplainedDivergenceBucketHints>([
      [
        "asapDefault",
        buildTaskBucketHints({
          task: {
            assignedCalendarId: "imported-A",
            constraintType: "ASAP",
            constraintDateMinutes: null,
            isStructuralSummary: false,
          },
          projectCalendarId: "default",
          calendarDefinitions: { default: stub },
          calendars: {},
          resolvedCalendarDefinitions: { "imported-A": stub, default: stub },
          hasChildrenInHierarchy: false,
          hasNonZeroLag: false,
          predecessorCount: 0,
          successorCount: 0,
        }),
      ],
      [
        "asapWithDate",
        buildTaskBucketHints({
          task: {
            assignedCalendarId: null,
            constraintType: "ASAP",
            constraintDateMinutes: 480,
            isStructuralSummary: false,
          },
          projectCalendarId: "default",
          calendarDefinitions: { default: stub },
          calendars: {},
          resolvedCalendarDefinitions: { default: stub },
          hasChildrenInHierarchy: false,
          hasNonZeroLag: false,
          predecessorCount: 0,
          successorCount: 0,
        }),
      ],
      [
        "msoRow",
        buildTaskBucketHints({
          task: {
            assignedCalendarId: null,
            constraintType: "MSO",
            constraintDateMinutes: 960,
            isStructuralSummary: false,
          },
          projectCalendarId: "default",
          calendarDefinitions: { default: stub },
          calendars: {},
          resolvedCalendarDefinitions: { default: stub },
          hasChildrenInHierarchy: false,
          hasNonZeroLag: false,
          predecessorCount: 0,
          successorCount: 0,
        }),
      ],
    ]);

    const enriched = attachUnexplainedDivergenceBuckets({
      taskComparisons: result.summary.taskComparisons,
      hintsByTaskId,
    });

    // (i) Gate-relevant invariants: unexplainedDivergenceCount,
    // classifications, variance maxima are unchanged by relabelling.
    expect(result.summary.unexplainedDivergenceCount).toBe(beforeCount);
    expect(enriched.map((r) => r.classification)).toEqual(beforeClassifications);
    expect(result.summary.maxAbsStartVarianceMinutes).toBe(beforeMaxStart);
    expect(result.summary.maxAbsFinishVarianceMinutes).toBe(beforeMaxFinish);

    // B2.12A.5 expected bucket reassignments:
    const asapDefault = enriched.find((r) => r.taskId === "asapDefault")!;
    const asapWithDate = enriched.find((r) => r.taskId === "asapWithDate")!;
    const msoRow = enriched.find((r) => r.taskId === "msoRow")!;
    expect(asapDefault.unexplainedDivergenceBucket).toBe("calendar_boundary_candidate");
    expect(asapWithDate.unexplainedDivergenceBucket).toBe("constraint_semantics_candidate");
    expect(msoRow.unexplainedDivergenceBucket).toBe("constraint_semantics_candidate");
  });

  it("(j) every bucket reassignment is on a row with classification='unexplained_divergence'", () => {
    // Rows: one identical (no_difference), one expected-cal, one unexplained.
    const result = compareSlotVsTemporalCandidate({
      slotResults: {
        identical: slot(),
        expectedCal: slot({ earlyStartMinutes: wm(0), earlyFinishMinutes: wm(5) }),
        unexplained: slot({ earlyStartMinutes: wm(0), earlyFinishMinutes: wm(5) }),
      },
      candidateTasks: [
        temporal("identical"),
        temporal("expectedCal", { earlyStart: wm(1), earlyFinish: wm(6) }),
        temporal("unexplained", { earlyStart: wm(1), earlyFinish: wm(6) }),
      ],
      expectedCalendarDivergenceTaskIds: ["expectedCal"],
      unsupportedFeatureFlags: [],
    });

    const stub = {};
    const asapDefaultHints = buildTaskBucketHints({
      task: {
        assignedCalendarId: "imported-X",
        constraintType: "ASAP",
        constraintDateMinutes: null,
        isStructuralSummary: false,
      },
      projectCalendarId: "default",
      calendarDefinitions: { default: stub },
      calendars: {},
      resolvedCalendarDefinitions: { "imported-X": stub, default: stub },
      hasChildrenInHierarchy: false,
      hasNonZeroLag: false,
      predecessorCount: 0,
      successorCount: 0,
    });

    const enriched = attachUnexplainedDivergenceBuckets({
      taskComparisons: result.summary.taskComparisons,
      // attempt to relabel ALL three rows; helper must only stamp unexplained
      hintsByTaskId: new Map([
        ["identical", asapDefaultHints],
        ["expectedCal", asapDefaultHints],
        ["unexplained", asapDefaultHints],
      ]),
    });

    const identical = enriched.find((r) => r.taskId === "identical")!;
    const expectedCal = enriched.find((r) => r.taskId === "expectedCal")!;
    const unexplained = enriched.find((r) => r.taskId === "unexplained")!;
    expect(identical.unexplainedDivergenceBucket ?? null).toBeNull();
    expect(expectedCal.unexplainedDivergenceBucket ?? null).toBeNull();
    expect(unexplained.classification).toBe("unexplained_divergence");
    expect(unexplained.unexplainedDivergenceBucket).toBe("calendar_boundary_candidate");
  });
});
