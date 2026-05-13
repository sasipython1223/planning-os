# W5B-B2.12A.3 — AI003 Diagnostic Classifier Lookup Correction

> **Diagnostic classifier correction only.** No scheduling fix.
> No gate weakening. No tolerance change. No schedule output change.
> No authority/persistence/UAT/production change. Source dates
> remain protected. `unsupportedFeatureFlags` unchanged.
> `unexplainedDivergenceCount` unchanged. `fallbackReason` unchanged.
> AI003 remains blocked.

---

## 1. Executive Summary

The B2.12A read-only divergence bucket classifier was producing two
systematic mis-labels, both identified by the B2.12A.2 audit:

1. It looked up calendar metadata only in `State.calendarDefinitions`
   and `State.calendars` — neither of which is populated by the
   XER/MSP import path. The imported calendars actually live in
   `State.resolvedCalendarDefinitions`.
2. It detected structural summaries only via child-based scan
   (`State.isTaskSummary(id)`) and missed source-marked
   `task.isStructuralSummary === true` rows that have no children.

B2.12A.3 makes the two **inputs to the classifier** correct. The
classifier's priority order, its bucket set, and its public surface
are unchanged. The fix lives in a new pure helper
`buildTaskBucketHints(...)` in the existing
`UnexplainedDivergenceBuckets.ts` module, plus a one-call switch
inside the candidate-projection runner in `worker.ts`.

**Effect on AI003 (read-only, fresh rerun, same build):**

| Bucket | Before (B2.12A.1 / .2) | After (B2.12A.3) | Delta |
| --- | ---: | ---: | ---: |
| `missing_calendar_metadata_candidate` | **2569** (false positive) | **0** | −2569 |
| `summary_or_wbs_rollup_candidate` | 485 | **492** | +7 (the 7 previously-`unknown` childless summary rows now correctly classified) |
| `constraint_semantics_candidate` | 0 | **2569** (the formerly-mislabelled leaf rows; AI003 marks every task with a `constraintType`) | +2569 |
| `unknown_unclassified` | 7 | **0** | −7 |
| Other buckets | 0 | 0 | — |
| **Sum across buckets** | 3061 | **3061** | unchanged |

Gate-relevant invariants confirmed unchanged on the live rerun:

- `unexplainedDivergenceCount = 3061` (identical to B2.12A.1 / .2).
- `comparedTaskCount = 3062`, `identicalTaskCount = 0`,
  `expectedSummaryCriticalRollupDivergenceCount = 1`,
  `expectedCalendarDivergenceCount = 0`,
  `unsupportedFeatureDivergenceCount = 0`.
- `maxAbsStartVarianceMinutes = 970`,
  `maxAbsFinishVarianceMinutes = 1250`,
  `maxAbsTotalFloatVarianceMinutes = 1` (all unchanged).
- `unsupportedFeatureFlags = []`, `fallbackReason = null`.
- AI003 remains blocked by the existing `unexplained_divergence`
  comparator path under the existing tolerance.

---

## 2. Scope Confirmation

In scope:

- Diagnostic classifier hint construction only.
- New tests proving the corrected hint mappings.
- Operator-evidence rerun on AI003 to confirm bucket reclassification
  and gate-relevant invariants.

Out of scope (none of the following were modified):

- Slot scheduler logic.
- Temporal scheduler logic.
- `TemporalCandidateComparator` variance computation.
- `unexplainedDivergenceCount` semantics.
- `TemporalCandidateProjectionGate` decision logic.
- `fallbackReason`.
- Divergence tolerance / cutover gate.
- `unsupportedFeatureFlags` set.
- UAT / production / dogfood persistence enablement.
- Authority apply / rollback behaviour.
- Source-date mutation.
- AI003 passing (it does not, and the milestone does not attempt to
  make it pass).
- React layer (the dev-only `App.tsx` mirror added in B2.12A.2 is
  retained, see §5).

---

## 3. B2.12A.2 Root Cause Carried Forward

From the B2.12A.2 audit:

- **AI003 imports 11 source calendars** into
  `sourceImportRecord.{calendar,resolvedCalendar}Definitions` and
  into `State.resolvedCalendarDefinitions`.
- **Imports never populate** `State.calendarDefinitions` or
  `State.calendars`. The former is updated only by
  `UPSERT_PLANNER_CALENDAR` / `CLONE_IMPORTED_CALENDAR`; the latter
  has no production setter at all.
- The classifier's `hasMissingCalendarMetadata` hint queried only
  those two never-populated maps, producing 2569 false positives on
  AI003.
- 7 structural summary rows (`isStructuralSummary=true`) with no
  children fell through to `unknown_unclassified` because the
  classifier's `isSummary` hint only used the worker's child-scan
  predicate.

B2.12A.3 corrects both hint sources. The classifier itself was
already correct given accurate hints.

---

## 4. Classifier Lookup Correction Summary

### 4.1 Source change set

**Modified files:**

- `packages/worker/src/schedule/UnexplainedDivergenceBuckets.ts`
  - Added `BuildTaskBucketHintsInput` type and pure helper
    `buildTaskBucketHints(...)` that constructs an
    `UnexplainedDivergenceBucketHints` from one task, one project
    calendar id, three calendar registries
    (`calendarDefinitions`, `calendars`,
    `resolvedCalendarDefinitions`), plus precomputed
    `hasChildrenInHierarchy`, `hasNonZeroLag`, `predecessorCount`,
    `successorCount`.
  - No change to `classifyUnexplainedDivergenceBucket`,
    `attachUnexplainedDivergenceBuckets`,
    `summarizeUnexplainedDivergenceBuckets`, or the bucket priority
    order.

- `packages/worker/src/worker.ts`
  - Imports `buildTaskBucketHints`.
  - Replaces the inline hint construction in
    `runTemporalCandidateProjectionExecution` with a call to
    `buildTaskBucketHints`, passing the resolved registry from
    `State.getResolvedCalendarDefinitions()` and the
    `hasChildrenInHierarchy` value from `State.isTaskSummary(taskId)`.

**Tests added:** see §6.

### 4.2 Calendar lookup order (B2.12A.3)

Calendar metadata is considered **loaded** for a referenced calendar
id when it is present in **any** of the following three registries:

1. `State.calendarDefinitions` (planner/upserted calendars — existing).
2. `State.calendars` (legacy planner registry — existing fallback,
   preserved).
3. `State.resolvedCalendarDefinitions` (XER/MSP import resolved
   registry — **B2.12A.3 addition**).

Only when the referenced id is absent from **all three** does
`hasMissingCalendarMetadata` become `true`. Project calendar id is
still used as the fallback reference when a task has no
`assignedCalendarId`.

> Why include all three: planner-upserted calendars do not flow into
> the resolved registry, and imported calendars do not flow into the
> upsert registry. A correct classifier must accept either origin.

---

## 5. Structural Summary Detection Correction

`isSummary` is now `true` when **either** holds:

- `task.isStructuralSummary === true` (source marker, survives even
  when the row has no children in the imported hierarchy), **OR**
- The row has at least one child task in the imported hierarchy
  (the existing `State.isTaskSummary(taskId)` predicate, retained).

This matches the convention already used elsewhere in the worker
(e.g. `packages/worker/src/hierarchy.ts` and
`packages/worker/src/dependencyDiagnostics.ts`).

### App.tsx diagnostic hook retention

The B2.12A.2 dev-only `useEffect` that publishes
`window.__diagnosticState` is **retained**. Justification:

- It is gated by `import.meta.env.DEV` and never runs in production,
  Vitest, or any user-facing build.
- It only mirrors React state (`tasks`, `dependencies`,
  `plannerCalendars`, `sourceImportRecord`, `projectStartDate`);
  it never mutates state, never posts a worker command, and never
  emits a `DIFF_STATE`.
- It was the only practical way to capture the live operator
  evidence in §8/§9 for AI003. Future bucket audits (e.g. a
  reconciliation of B2.11D's 49) will need the same surface, so
  removing it would force re-implementation later.
- It does not affect any gate, tolerance, schedule output, or
  authority/persistence path.

---

## 6. Tests Added / Updated

File:
[`packages/worker/tests/schedule/w5b-b2-12a-unexplained-divergence-buckets.test.ts`](../../packages/worker/tests/schedule/w5b-b2-12a-unexplained-divergence-buckets.test.ts)

**Existing tests:** unchanged. Pre-B2.12A.3 baseline of 12 tests in
this file continues to pass.

**New tests (10 added, suite now 22 tests):**

`W5B-B2.12A.3 hint builder — calendar lookup correction`:

1. A task with `assignedCalendarId` present in
   `resolvedCalendarDefinitions` is not classified as
   `missing_calendar_metadata_candidate`.
2. A task with `assignedCalendarId` present in `calendarDefinitions`
   is treated as loaded (preserved fallback).
3. A task with `assignedCalendarId` present in `calendars` is
   treated as loaded (preserved fallback).
4. A task with `assignedCalendarId` absent from **all three**
   registries is still classified as
   `missing_calendar_metadata_candidate`.
5. With `assignedCalendarId = null`, the classifier falls back to
   `projectCalendarId` and uses the same three-registry lookup.
6. With both `assignedCalendarId` and `projectCalendarId` resolving
   nowhere, `hasMissingCalendarMetadata === true`.

`W5B-B2.12A.3 hint builder — structural-summary correction`:

7. A childless `task.isStructuralSummary === true` row classifies
   as `summary_or_wbs_rollup_candidate`.
8. Existing child-based summary detection (parent of ≥1 child)
   continues to classify as `summary_or_wbs_rollup_candidate`.
9. A leaf row (no children, `isStructuralSummary=false`) is not
   flagged as summary.

`W5B-B2.12A.3 bucket attachment — does not perturb gate-relevant fields`:

10. With the corrected hint builder, attaching buckets to a synthetic
    comparison containing (a) an imported-calendar leaf, (b) a
    ghost-calendar leaf, and (c) a childless structural summary row
    leaves `unexplainedDivergenceCount` unchanged, leaves
    classifications unchanged, and produces the corrected bucket
    labels (not missing-metadata for (a); still missing-metadata for
    (b); summary for (c)).

---

## 7. Validation Results

| Suite | Result |
| --- | --- |
| `pnpm -C packages/protocol exec tsc -b` | ✅ exit 0 |
| `pnpm -C packages/worker exec tsc --noEmit` | ✅ exit 0 |
| `pnpm -C apps/web exec tsc -b` | ✅ exit 0 |
| `pnpm -C packages/worker exec vitest run` | ✅ **1278 / 1278** tests in **65 / 65** files (was 1268 / 65; +10 new B2.12A.3 tests) |
| `pnpm -C apps/web exec vitest run` | ✅ **505 / 505** tests in **40 / 40** files (unchanged) |
| `pnpm -C apps/web test:wasm-browser` | ✅ **1 / 1** Playwright test passed (`W5B-B2.3D real WASM validation gate remains diagnostic-only`) |

All gates green. No prior test failed or was modified.

---

## 8. Corrected AI003 Candidate Projection Summary

Fresh AI003 import and projection captured live after the fix.

**Fixture:** `apps/web/tests/fixtures/local/AI003.xer` (3,421,670
bytes).

**WASM validation gate** (`__runTemporalWasmValidationGate`):

| Field | Value |
| --- | --- |
| `realWasmValidationPassed` | `true` |
| `wasmLoadMode` | `real` |
| `scenariosPlanned / Executed / Passed` | `7 / 7 / 7` |
| `scenariosFailed / Blocked` | `0 / 0` |
| `sourceProtectionStatus` | `ok` |
| `authorityApplied` | `false` |

**Candidate projection** (`__runTemporalCandidateProjection`, ring
`dogfood`, `runWasmGateFirst: true`,
`temporalCandidateProjectionEnabled: true`,
`useLastSuccessfulWasmGate: true`):

| Field | Value |
| --- | --- |
| `gateDecision.allowed` | `true` (gate is permission-to-run, not pass/fail) |
| `gateDecision.blockedReason` | `null` |
| `authorityApplied` | `false` |
| `fallbackReason` | `null` |
| `unsupportedFeatureFlags` | `[]` |
| `projection.candidateTasks.length` | `3062` |
| `comparedTaskCount` | `3062` |
| `identicalTaskCount` | `0` |
| `expectedCalendarDivergenceCount` | `0` |
| `expectedSummaryCriticalRollupDivergenceCount` | `1` |
| `unsupportedFeatureDivergenceCount` | `0` |
| `unexplainedDivergenceCount` | **`3061`** |
| `maxAbsStartVarianceMinutes` | `970` |
| `maxAbsFinishVarianceMinutes` | `1250` |
| `maxAbsTotalFloatVarianceMinutes` | `1` |
| `criticalFlagVarianceCount` | (unchanged from B2.12A.1/.2) |

Comparator outputs are byte-identical to B2.12A.1/.2 for all
gate-relevant fields. The only change is the bucket labels attached
to the `unexplained_divergence` rows.

---

## 9. Corrected Bucket Distribution

Computed live from `projection.comparison.taskComparisons` after the
rerun:

| Bucket | Count |
| --- | ---: |
| `summary_or_wbs_rollup_candidate` | **492** |
| `constraint_semantics_candidate` | **2569** |
| `missing_calendar_metadata_candidate` | **0** |
| `lag_semantics_candidate` | 0 |
| `calendar_boundary_candidate` | 0 |
| `relationship_chain_candidate` | 0 |
| `unknown_unclassified` | **0** |
| **Total over `unexplained_divergence` rows** | **3061** |

### Notes on the corrected distribution

- **`missing_calendar_metadata_candidate = 0`** — every leaf task
  with an imported `assignedCalendarId` (10288, 10285, 6693, 7701)
  now resolves through `State.resolvedCalendarDefinitions` and is
  no longer mis-flagged.
- **`summary_or_wbs_rollup_candidate = 492`** — 485 child-based
  summaries (unchanged) + the 7 childless `isStructuralSummary=true`
  rows previously labelled `unknown_unclassified`, now correctly
  surfaced.
- **`constraint_semantics_candidate = 2569`** — AI003's source data
  marks **every** task with a `constraintType` (3062/3062: summaries
  carry `ASAP`; the 2569 leaves carry mixed `ALAP` / other values).
  Summary rows hit the higher-priority summary bucket first; the
  2569 non-summary leaves fall to the constraint bucket because the
  classifier currently treats `constraintType != null` as a
  constraint-semantics signal.
- **`unknown_unclassified = 0`** — the 7 previously-unknown rows
  are now in the summary bucket.

> Heuristic limitation (not in this milestone's scope): "ASAP" is
> P6's no-op default constraint and most P6 exports stamp it on
> every activity. A future refinement could treat `ASAP` as
> equivalent to "no constraint" so the constraint bucket reflects
> only genuinely constrained rows. This would not change any gate or
> count; it would simply move many of the 2569 leaves to one of the
> remaining buckets (likely `calendar_boundary_candidate` for those
> few with ≥ 480-minute variance, or `unknown_unclassified` for the
> sub-workday rows). **Out of scope for B2.12A.3** — the brief
> covers calendar-lookup and structural-summary corrections only.

### Bucket sample evidence

A few representative `summary_or_wbs_rollup_candidate` rows
(including the newly-recovered childless summaries) and
`constraint_semantics_candidate` rows were spot-checked live; bucket
totals reproducibly match the table above and total to **3061**
(= `unexplainedDivergenceCount`).

---

## 10. Comparison Against B2.12A.1 / B2.12A.2

| Metric | B2.12A.1 / B2.12A.2 | B2.12A.3 | Δ |
| --- | ---: | ---: | ---: |
| `unexplainedDivergenceCount` | 3061 | **3061** | 0 |
| `comparedTaskCount` | 3062 | 3062 | 0 |
| `identicalTaskCount` | 0 | 0 | 0 |
| `expectedSummaryCriticalRollupDivergenceCount` | 1 | 1 | 0 |
| `expectedCalendarDivergenceCount` | 0 | 0 | 0 |
| `unsupportedFeatureDivergenceCount` | 0 | 0 | 0 |
| `maxAbsStartVarianceMinutes` | 970 | 970 | 0 |
| `maxAbsFinishVarianceMinutes` | 1250 | 1250 | 0 |
| `maxAbsTotalFloatVarianceMinutes` | 1 | 1 | 0 |
| `unsupportedFeatureFlags` | `[]` | `[]` | 0 |
| `fallbackReason` | `null` | `null` | 0 |
| `sourceProtectionStatus` | `ok` | `ok` | 0 |
| `realWasmValidationPassed` | `true` | `true` | 0 |
| `wasmLoadMode` | `real` | `real` | 0 |
| `authorityApplied` | `false` | `false` | 0 |
| `persistenceApplied` | `false` | `false` | 0 |
| Bucket `missing_calendar_metadata_candidate` | 2569 | **0** | −2569 |
| Bucket `summary_or_wbs_rollup_candidate` | 485 | **492** | +7 |
| Bucket `constraint_semantics_candidate` | 0 | **2569** | +2569 |
| Bucket `unknown_unclassified` | 7 | **0** | −7 |
| **Total bucketed** | 3061 | **3061** | 0 |
| AI003 blocked? | yes | **yes** | unchanged |

Every gate-relevant field is byte-identical. Only the labels move.
AI003 remains blocked.

---

## 11. Safety Confirmation

Live diagnostics (`__getTemporalAuthorityDiagnostics`) after the
corrected projection rerun:

| Field | Value |
| --- | --- |
| `currentAuthorityEngineMode` | `slot_authoritative` |
| `previousAuthorityEngineMode` | `slot_authoritative` |
| `authorityApplied` | `false` |
| `persistenceApplied` | `false` |
| `sourceProtectionStatus` | `ok` |
| `realWasmValidationPassed` | `true` |
| `wasmLoadMode` | `real` |
| `fallbackReason` | `null` |
| `unsupportedFeatureFlags` | `[]` |

Confirmations against the milestone brief:

- ✅ No schedule output change.
- ✅ No slot calculation change.
- ✅ No temporal calculation change.
- ✅ No comparator variance-logic change.
- ✅ No `unexplainedDivergenceCount` change.
- ✅ No gate decision change.
- ✅ No `fallbackReason` change.
- ✅ No divergence-tolerance change.
- ✅ No `unsupportedFeatureFlags` change.
- ✅ No UAT / production / persistence enablement.
- ✅ AI003 not made to pass.
- ✅ No source-date mutation.
- ✅ No dogfood-apply or rollback behaviour change.
- ✅ No scheduling semantics added.
- ✅ No scheduling logic moved into React.

Bucket fields remain read-only and optional. The classifier's
public surface is unchanged.

---

## 12. Recommendation

Accept B2.12A.3 as the diagnostic classifier correction. Bucket
labels now accurately reflect available signals; the project-level
divergence numbers are unchanged; AI003 remains correctly blocked.

Suggested follow-up milestones (out of scope here):

- **B2.12A.4 — Constraint signal refinement (heuristic-only).**
  Treat `ASAP` as equivalent to no constraint in the
  `hasConstraint` hint, so the `constraint_semantics_candidate`
  bucket reflects genuinely constrained rows only. Read-only,
  no gate impact.
- **B2.11D reconciliation.** Re-run B2.11D's `49` figure capture
  against the current build with recorded fixture sha to determine
  whether the 49-vs-3061 gap is a build/fixture provenance issue
  (likely) or a different diagnostic path (also likely).
- **Underlying scheduling investigation.** The 2569 leaf
  divergences are real (≤3-minute variances each); the 492 summary
  divergences are large (up to 1250 min). Both are unaffected by
  this milestone. A separate investigation (minute-precision
  rounding between slot and temporal engines on non-default
  calendars) is recommended but firmly out of scope here.

**AI003 remains blocked.** Do not weaken the divergence gate. Do
not enable UAT / production / persistence.

---

*End of W5B-B2.12A.3.*
