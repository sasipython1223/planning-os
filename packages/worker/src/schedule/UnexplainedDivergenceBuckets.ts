/**
 * W5B-B2.12A — Diagnostic classification of `unexplained_divergence` rows.
 *
 * READ-ONLY. This module produces hypothesis-grade buckets to help operators
 * triage where slot-authoritative vs temporal-candidate divergences are
 * coming from. It MUST NOT:
 *   - change `unexplainedDivergenceCount`
 *   - change the cutover gate decision
 *   - change `fallbackReason`
 *   - change `unsupportedFeatureFlags`
 *   - change `authorityApplied`, `sourceProtectionStatus`, or persistence
 *   - emit DIFF_STATE or mutate any State
 *
 * The classifier is heuristic. Buckets are mutually exclusive. The first
 * matching bucket in the documented priority order wins. When no signal
 * matches, the bucket is `"unknown_unclassified"`.
 *
 * Priority order (deterministic, first-match wins) — W5B-B2.12A.5 refined:
 *   1. summary_or_wbs_rollup_candidate     (task is a summary / WBS row)
 *   2. missing_calendar_metadata_candidate (task references a calendar but
 *                                           metadata is not loaded for it)
 *   3. constraint_semantics_candidate      (task carries a *meaningful*
 *                                           constraint — non-ASAP type, OR
 *                                           ASAP with a non-null
 *                                           constraintDateMinutes; default
 *                                           ASAP+null is NOT meaningful and
 *                                           does not fire this bucket)
 *   4. calendar_boundary_candidate         (slot-vs-temporal calendar
 *                                           binding differs at the immediate
 *                                           task level, OR variance magnitude
 *                                           looks like a working-day boundary
 *                                           effect)
 *   5. lag_semantics_candidate             (task has any incident dependency
 *                                           with non-zero lag)
 *   6. relationship_chain_candidate        (task has >=2 predecessors or
 *                                           >=2 successors — likely chain-
 *                                           propagated variance)
 *   7. unknown_unclassified                (default)
 *
 * W5B-B2.12A.5 refinements (diagnostic-only, no scheduling change):
 *   - `hasMeaningfulConstraint` separates P6's no-op default ASAP from real
 *     constraints. Default ASAP (constraintType==='ASAP' AND
 *     constraintDateMinutes==null) is the over-firing case discovered in
 *     B2.12A.4 and must not be bucketed as constraint_semantics_candidate.
 *   - `slotVsTemporalCalendarBindingDiffers` is an O(1) immediate-task check
 *     comparing `task.assignedCalendarId` against the project / temporal
 *     calendar id. It does NOT traverse WBS hierarchy and does NOT resolve
 *     inherited calendars in this milestone.
 */

import type {
    TemporalCandidateTaskComparison,
    TemporalCandidateUnexplainedDivergenceBucket,
    WorkMinutes,
} from "@planner/protocol";

export type UnexplainedDivergenceBucketHints = {
  /** True if the task is a structural summary / WBS row. */
  isSummary: boolean;
  /** True if any calendar id referenced by the task is not present in loaded calendar metadata. */
  hasMissingCalendarMetadata: boolean;
  /**
   * Legacy (B2.12A): true if the task carries any non-null constraintType.
   * Retained for backward compatibility with existing callers/tests. The
   * classifier now prefers `hasMeaningfulConstraint` when supplied.
   */
  hasConstraint: boolean;
  /**
   * W5B-B2.12A.5: true ONLY when the task carries a *meaningful* constraint.
   * Definition: `constraintType` is non-null AND either
   *   - `constraintType !== "ASAP"`, OR
   *   - `constraintType === "ASAP"` with a non-null `constraintDateMinutes`.
   *
   * Rationale (B2.12A.4): P6 stamps `ASAP` as a no-op default on every
   * exported activity. Treating it as a constraint over-fires the
   * constraint_semantics_candidate bucket. When this field is `undefined`,
   * the classifier falls back to `hasConstraint` (legacy behaviour).
   */
  hasMeaningfulConstraint?: boolean;
  /**
   * W5B-B2.12A.5: true when the immediate task assigned calendar differs
   * from the project / temporal calendar id. O(1) per task — no WBS
   * hierarchy traversal, no inherited-calendar resolution.
   */
  slotVsTemporalCalendarBindingDiffers?: boolean;
  /** True if any incident dependency (predecessor or successor) has non-zero lag. */
  hasNonZeroLag: boolean;
  /** Count of incoming (predecessor) relationships. */
  predecessorCount: number;
  /** Count of outgoing (successor) relationships. */
  successorCount: number;
};

/**
 * W5B-B2.12A.3 — Inputs for the pure hint-builder. Kept narrow on purpose:
 * the builder reads only the fields it needs from a task and from each
 * calendar registry. The classifier itself remains unchanged; only its
 * inputs are corrected so that imported-XER calendars and source-marked
 * structural summary rows are recognised.
 *
 * Calendar lookup order (all are checked; presence in ANY counts as
 * "metadata loaded"):
 *   1. `calendarDefinitions`         — planner/upserted calendars
 *   2. `calendars`                   — legacy planner registry
 *   3. `resolvedCalendarDefinitions` — XER/MSP import resolved registry
 *      (NOTE: `resolvedCalendarDefinitions` is the registry that imports
 *      actually populate; B2.12A.2 audit confirmed it is the source of
 *      truth for imported calendar metadata.)
 *
 * Structural-summary signal:
 *   `isSummary` is `true` when EITHER (a) `task.isStructuralSummary === true`
 *   (source marker, survives childless rows) OR (b) the row has at least
 *   one child task (`hasChildrenInHierarchy`).
 */
export type BuildTaskBucketHintsInput = {
  task: {
    assignedCalendarId?: string | null;
    constraintType?: string | null;
    /**
     * W5B-B2.12A.5: required to distinguish P6's no-op ASAP default from
     * an ASAP with an explicit anchor date. `null`/`undefined` ⇒ no anchor.
     */
    constraintDateMinutes?: number | null;
    isStructuralSummary?: boolean;
  } | null | undefined;
  projectCalendarId: string | null | undefined;
  calendarDefinitions: Readonly<Record<string, unknown>>;
  calendars: Readonly<Record<string, unknown>>;
  resolvedCalendarDefinitions: Readonly<Record<string, unknown>>;
  hasChildrenInHierarchy: boolean;
  hasNonZeroLag: boolean;
  predecessorCount: number;
  successorCount: number;
};

/**
 * Pure helper: build classifier hints for one task. Performs the
 * B2.12A.3 corrections (resolved-calendar registry consultation + source
 * structural-summary acceptance) so the classifier's downstream priority
 * order can be trusted.
 *
 * Pure: reads only the inputs supplied; mutates nothing.
 */
export const buildTaskBucketHints = (
  input: BuildTaskBucketHintsInput,
): UnexplainedDivergenceBucketHints => {
  const referencedCalendarId =
    input.task?.assignedCalendarId ?? input.projectCalendarId ?? null;
  const calendarMetadataLoaded =
    referencedCalendarId != null
    && (input.calendarDefinitions[referencedCalendarId] != null
      || input.calendars[referencedCalendarId] != null
      || input.resolvedCalendarDefinitions[referencedCalendarId] != null);

  const isSummary =
    input.task?.isStructuralSummary === true
    || input.hasChildrenInHierarchy === true;

  const constraintType = input.task?.constraintType ?? null;
  const constraintDateMinutes = input.task?.constraintDateMinutes ?? null;

  // W5B-B2.12A.5: meaningful = non-ASAP type, OR ASAP with explicit anchor.
  // Default ASAP+null is P6's no-op stamp and is NOT meaningful.
  const hasMeaningfulConstraint =
    constraintType != null
    && (constraintType !== "ASAP" || constraintDateMinutes != null);

  // W5B-B2.12A.5: O(1) immediate-task binding mismatch. Only fires when the
  // task explicitly carries `assignedCalendarId` AND that id differs from
  // the project/temporal calendar. No hierarchy traversal, no inheritance.
  const assignedCalendarId = input.task?.assignedCalendarId ?? null;
  const slotVsTemporalCalendarBindingDiffers =
    assignedCalendarId != null
    && input.projectCalendarId != null
    && String(assignedCalendarId) !== String(input.projectCalendarId);

  return {
    isSummary,
    hasMissingCalendarMetadata: !calendarMetadataLoaded,
    hasConstraint: constraintType != null,
    hasMeaningfulConstraint,
    slotVsTemporalCalendarBindingDiffers,
    hasNonZeroLag: input.hasNonZeroLag,
    predecessorCount: input.predecessorCount,
    successorCount: input.successorCount,
  };
};

/**
 * One working-day in minutes for the calendar-boundary heuristic.
 * Standard planner default is 480 work minutes/day. Variances that are an
 * integer multiple of this magnitude are *candidates* for a calendar-boundary
 * effect. This is a heuristic — confirmation requires per-task calendar
 * inspection (out of scope for B2.12A).
 */
const WORK_MINUTES_PER_DAY = 480;

const absOrZero = (value: WorkMinutes | null): number =>
  value == null ? 0 : Math.abs(value as number);

const looksLikeWorkdayMultiple = (minutes: number): boolean => {
  if (minutes <= 0) return false;
  if (minutes < WORK_MINUTES_PER_DAY) return false;
  return minutes % WORK_MINUTES_PER_DAY === 0;
};

export const classifyUnexplainedDivergenceBucket = (
  hints: UnexplainedDivergenceBucketHints,
  comparison: Pick<
    TemporalCandidateTaskComparison,
    "startVarianceMinutes" | "finishVarianceMinutes" | "totalFloatVarianceMinutes"
  >,
): TemporalCandidateUnexplainedDivergenceBucket => {
  if (hints.isSummary) {
    return "summary_or_wbs_rollup_candidate";
  }
  if (hints.hasMissingCalendarMetadata) {
    return "missing_calendar_metadata_candidate";
  }

  // W5B-B2.12A.5: prefer the refined hint when supplied; otherwise fall
  // back to the legacy any-non-null-constraint hint for backward
  // compatibility with callers that have not migrated.
  const effectiveConstraintFires =
    hints.hasMeaningfulConstraint !== undefined
      ? hints.hasMeaningfulConstraint
      : hints.hasConstraint;
  if (effectiveConstraintFires) {
    return "constraint_semantics_candidate";
  }

  // W5B-B2.12A.5: calendar_boundary moves ahead of lag_semantics. Fires when
  // either the immediate-task binding mismatch hint is set (B2.12A.4 finding)
  // OR the legacy workday-multiple variance heuristic matches. Both signal a
  // working-time-boundary effect rather than a per-task semantic divergence.
  const maxAbsVariance = Math.max(
    absOrZero(comparison.startVarianceMinutes),
    absOrZero(comparison.finishVarianceMinutes),
    absOrZero(comparison.totalFloatVarianceMinutes),
  );
  if (
    hints.slotVsTemporalCalendarBindingDiffers === true
    || looksLikeWorkdayMultiple(maxAbsVariance)
  ) {
    return "calendar_boundary_candidate";
  }

  if (hints.hasNonZeroLag) {
    return "lag_semantics_candidate";
  }

  if (hints.predecessorCount >= 2 || hints.successorCount >= 2) {
    return "relationship_chain_candidate";
  }

  return "unknown_unclassified";
};

export type AttachBucketsInput = {
  taskComparisons: readonly TemporalCandidateTaskComparison[];
  hintsByTaskId: ReadonlyMap<string, UnexplainedDivergenceBucketHints>;
};

/**
 * Returns a new `taskComparisons` array with `unexplainedDivergenceBucket`
 * attached to every row whose `classification === "unexplained_divergence"`.
 * Non-unexplained rows are returned unchanged. Counts and classifications
 * are never altered.
 */
export const attachUnexplainedDivergenceBuckets = (
  input: AttachBucketsInput,
): TemporalCandidateTaskComparison[] => {
  return input.taskComparisons.map((row) => {
    if (row.classification !== "unexplained_divergence") {
      return row;
    }
    const hints = input.hintsByTaskId.get(row.taskId);
    const bucket = hints
      ? classifyUnexplainedDivergenceBucket(hints, row)
      : ("unknown_unclassified" as const);
    return { ...row, unexplainedDivergenceBucket: bucket };
  });
};

/**
 * Aggregate per-bucket counts for the markdown / operator-evidence note.
 * Pure function — does not consult state and does not mutate input.
 */
export const summarizeUnexplainedDivergenceBuckets = (
  taskComparisons: readonly TemporalCandidateTaskComparison[],
): Record<TemporalCandidateUnexplainedDivergenceBucket, number> => {
  const counts: Record<TemporalCandidateUnexplainedDivergenceBucket, number> = {
    calendar_boundary_candidate: 0,
    lag_semantics_candidate: 0,
    constraint_semantics_candidate: 0,
    relationship_chain_candidate: 0,
    summary_or_wbs_rollup_candidate: 0,
    missing_calendar_metadata_candidate: 0,
    unknown_unclassified: 0,
  };
  for (const row of taskComparisons) {
    if (row.classification !== "unexplained_divergence") continue;
    const bucket = row.unexplainedDivergenceBucket;
    if (!bucket) continue;
    counts[bucket] += 1;
  }
  return counts;
};
