# W5B-B2.12A.6 — AI003 Lag + Relationship-Chain Decomposition Audit (Phase 2)

Status: DIAGNOSTIC ONLY — documentation + transient browser capture. No source code, schema, protocol, kernel, WASM, UI, or test files were modified by this milestone.
Authority: AI003 remains BLOCKED. No live cutover. No authority flip. Slot remains authoritative in all surfaces.
Scope: This document is the deliverable of Phase 2 (B2.12A.6) approved after Phase 1 inspection (B2.12A.5 §13 baseline + B2.12A.6 §Phase 1 notes).

---

## 1. Executive Summary

The B2.12A.5 classifier reports the live AI003 candidate-projection corpus as:

| classification | count |
|---|---:|
| `no_difference` | 8 |
| `expected_summary_critical_rollup_divergence` | 2 |
| `unexplained_divergence` | **3053** |

Within the 3053 unexplained tasks the bucket distribution (after B2.12A.5 priority order: missing_calendar → constraint(meaningful) → calendar_boundary → lag → relationship_chain → unknown) is:

| bucket | count | % of unexplained |
|---|---:|---:|
| `summary_or_wbs_rollup_candidate` | 492 | 16.1% |
| `constraint_semantics_candidate` | 122 | 4.0% |
| `calendar_boundary_candidate` | 0 | 0.0% |
| `lag_semantics_candidate` | 740 | 24.2% |
| `relationship_chain_candidate` | 1167 | 38.2% |
| `unknown_unclassified` | 532 | 17.4% |
| **total** | **3053** | 100% |

**Headline finding (Phase 2):** The three largest "explanation-bearing" buckets — `lag_semantics_candidate` (740), `relationship_chain_candidate` (1167), and `unknown_unclassified` (532) — are **statistically indistinguishable by variance magnitude**. All three buckets show `avgSv ≈ 1.40–1.48` work-min and `avgFv ≈ 1.36–1.39` work-min, with `maxSv = maxFv = 3` work-min in every bucket. The maximum absolute total-float variance across the entire corpus is 1.002 work-min. Stratifying by lag value, dependency type, immediate topology, or milestone status does **not** produce within-bucket variance differentiation: each bucket's variance footprint is a uniform sub-minute residue.

This is consistent with — but does not prove — a single shared root cause (boundary / rounding / sub-minute granularity coupling) operating uniformly across all bucketed tasks. The bucket labels stratify the corpus by edge characteristics (presence of non-zero lag, presence of edges, topology shape), not by mechanistic divergence cause.

**Calendar control:** All 3053 unexplained tasks have `assignedCalendarId = null`. The only planner calendar in the live corpus is `"default"` (1 calendar). `projectCalendarId` is `null`. Therefore calendar-binding-divergence is not a discriminating axis in this corpus and cannot be the explanation for variance heterogeneity (there is no heterogeneity to explain).

**No code, classifier, gate, tolerance, protocol, kernel, WASM, or UI behavior was changed by Phase 2.** AI003 stays blocked at the live cutover gate. The recommended next milestone is to instrument a strictly DEV-only sub-minute scheduler-internal trace (or, alternatively, to model the ~1 work-min residue at the kernel boundary in a Rust unit test) before any further classifier refinement is attempted.

---

## 2. Decision Ledger (Table 1)

| # | Decision | Source | Status |
|---|---|---|---|
| D1 | Phase 2 is documentation + transient browser capture only | User brief, this milestone | Honored |
| D2 | Depth-1 immediate-neighbor inspection only; no recursive graph traversal | Brief | Honored (predsByTaskId / succsByTaskId built single-pass over `dependencies`) |
| D3 | Sample budget ≤ 170 deep-inspected representative rows | Brief | Honored exactly (50 lag + 50 relationship + 50 unknown + 10 no_difference + 10 summary = 170) |
| D4 | No full task or dependency objects returned | Brief | Honored (compact projection columns only) |
| D5 | No code change to classifier, scheduler, protocol, kernel, WASM, UI, tests | Brief | Honored — `git status --short` will show only this `.md` doc as new |
| D6 | Actuals / progress observability is OUT OF SCOPE for this milestone | B2.12A.6 Phase 1, user decision | Honored (documented in §18) |
| D7 | AI003 remains blocked through Phase 2 | Brief, prior milestones | Honored |

---

## 3. Scope Confirmation

In-scope (Phase 2):
- Read-only inspection of the `window.__runTemporalCandidateProjection({...})` result on the live browser session for the currently-loaded plan.
- Stratification of the 3053 `unexplained_divergence` tasks across the three largest non-trivial buckets — `lag_semantics_candidate`, `relationship_chain_candidate`, `unknown_unclassified` — plus baseline rows from `summary_or_wbs_rollup_candidate` and `no_difference` for control.
- Aggregation tables (distributions, summary statistics) and a bounded number of representative example rows.

Explicitly OUT of scope:
- Any modification to `UnexplainedDivergenceBuckets.ts` or any other source file.
- Any modification to the scheduler, kernel (`packages/cpm-kernel`), WASM bridge (`packages/cpm-wasm`), protocol (`packages/protocol`), worker (`packages/worker`), or web UI (`apps/web`).
- Any change to the gate decision, rollout ring, authority flip, tolerance constants, persistence, UAT corpus, production data, or test files.
- Observing actuals / progress / source planned dates (see §18).
- Recursive graph traversal beyond immediate predecessors and successors.
- Any committed diagnostic code.

---

## 4. B2.12A.5 Baseline Carried Forward

From `W5B-B2.12A.5-AI003-diagnostic-classifier-refinement.md` (final form, including §13.5 count reconciliation):

- Classifier final priority order: summary → missing_calendar → constraint (meaningful only) → calendar_boundary (hint OR workday-multiple) → lag → relationship_chain → unknown.
- `hasMeaningfulConstraint` = true iff `constraintType != null AND (constraintType ≠ "ASAP" OR constraintDateMinutes != null)`. Plain "ASAP with no date" no longer routes into the constraint bucket.
- `slotVsTemporalCalendarBindingDiffers` is an O(1) immediate-task check — does not require neighbor scan.
- Live unexplained count: 3053. `identical = 8`. `expected_summary = 2`. `fallbackReason = null`. `gateDecision.allowed = true`, `gateDecision.rolloutRingAllowed = true`, `authorityApplied = false` (because AI003 is not flipped live).
- Inter-session corpus drift between B2.12A.3 (3061) and B2.12A.4/B2.12A.5 (3053) explained in B2.12A.4 §5 — different source-import sessions, identical classifier semantics.

These are carried forward unchanged. Phase 2 took a fresh capture against the same `__runTemporalCandidateProjection` config and reproduces the same totals exactly.

---

## 5. Phase 1 Findings Carried Forward

From the B2.12A.6 Phase 1 inspection report:

- `window.__diagnosticState` exposes `{ tasks, dependencies, plannerCalendars, sourceImportRecord, projectStartDate }`.
- It does **not** expose actuals, progress percent, status-date, or source planned start/finish — the App.tsx diagnostic mirror was scoped to the slot-engine input projection only.
- Calling `window.__runTemporalCandidateProjection({ temporalCandidateProjectionEnabled: true, temporalAuthorityRolloutRing: "internal_test", runWasmGateFirst: true })` returns `{ projection: { candidateTasks, comparison: { taskComparisons, ...summary }, diagnostics, ... }, gateDecision, authorityApplied }`.
- Slot reconstruction identity: `slotStart = temporalStart − startVariance`, `slotFinish = temporalFinish − finishVariance` (comparator contract: variance = slot − temporal in work-minute units of the comparator's reference clock; see comparator docs).
- Temporal-request builder identity passthrough holds: `lag_minutes = dep.lagWorkMinutes`, `dep_type = dep.type`, `lag_calendar_id = projectCalendar.id`, task `calendar_id = projectCalendar.id`.

These were re-checked at the start of Phase 2 capture and are unchanged.

---

## 6. Data Capture Method

A single `page.evaluate(...)` snippet (transient, not committed) was executed once on pageId `b3704a6b-221b-4732-9d39-cba1e3230e37` against the live dev server (`localhost:5173`).

Procedure:
1. `const proj = window.__runTemporalCandidateProjection({ temporalCandidateProjectionEnabled: true, temporalAuthorityRolloutRing: "internal_test", runWasmGateFirst: true })` — read live projection.
2. `const ds = window.__diagnosticState` — read tasks + dependencies + plannerCalendars.
3. Build `predsByTaskId: Map<TaskId, Edge[]>` and `succsByTaskId: Map<TaskId, Edge[]>` by single linear pass over `ds.dependencies`. Edges stored as `{ predId, succId, type, lagWorkMinutes }`. **Depth = 1 only.** No recursive walk.
4. Walk `proj.projection.comparison.taskComparisons` once. For each task: re-run `UnexplainedDivergenceBuckets` classifier semantics in-page to recover the bucket; record compact projection row `{ taskId, sourceActivityId, taskName, bucket, isSummary, isMilestoneOrZeroDuration, durationWorkMinutes, constraintType, constraintDateMinutes, assignedCalendarId, predCount, succCount, predTypes, succTypes, predLags, succLags, hasNonZeroLag, maxAbsLag, sv (startVarianceMinutes), fv (finishVarianceMinutes), tfv (totalFloatVarianceMinutes), criticalVariance, temporalStart, temporalFinish, slotStart, slotFinish, classification }`.
5. Aggregate into the 10 distribution tables below. Deterministic stride sampling (`stride = floor(bucketSize/50)`) selected 50 rows each from lag / relationship_chain / unknown, plus 10 from each control group. No randomness; reproducible from corpus order.

Return payload: structured JSON aggregates + the 170-row sample array. Total payload ≈ 78 KB. No full-graph serialization, no full task objects, no full dependency objects.

ID-integrity check (idempotent): `allPredIdsResolve = true`, `allSuccIdsResolve = true`, `unresolvedPredIds = 0`, `unresolvedSuccIds = 0`. The 5024 declared `dependencies` resolve into 4326 `lag` + 5251 `relationship_chain` + 985 `unknown` immediate-edge entries across the 2439 tasks in those three buckets (one task appears as endpoint of multiple edges; counts are edge-occurrences indexed by endpoint task).

---

## 7. Performance / Sampling Method

- Tasks scanned: 3063 (one pass).
- Dependencies indexed: 5024 (one pass to build maps; reads only `predId`, `succId`, `type`, `lagWorkMinutes`).
- Immediate-neighbor scans per task: O(predCount + succCount); depth strictly 1.
- Deep-sampled rows returned: **170** (cap: 170, equal). Breakdown: 50 + 50 + 50 + 10 + 10.
- Browser-side execution: single synchronous evaluate call, ~180 s timeout (used << 5 s actual).
- No mutation of `window`, no mutation of `__diagnosticState`, no mutation of `comparison` arrays. No DOM touched.
- Stride sampling guarantees no oversampling of any region of the comparison array.

---

## 8. Bucket Baseline (Table 2)

Reproduces B2.12A.5 §13 live baseline on the current session.

| Bucket | Count | % of 3053 |
|---|---:|---:|
| `summary_or_wbs_rollup_candidate` | 492 | 16.12% |
| `constraint_semantics_candidate` | 122 | 4.00% |
| `calendar_boundary_candidate` | 0 | 0.00% |
| `lag_semantics_candidate` | 740 | 24.24% |
| `relationship_chain_candidate` | 1167 | 38.22% |
| `unknown_unclassified` | 532 | 17.42% |
| **Total unexplained** | **3053** | 100% |

Plus: `no_difference = 8`, `expected_summary_critical_rollup_divergence = 2`, total compared = 3063.

Headline scalars (verbatim from comparison):
- `maxAbsStartVarianceMinutes = 972`
- `maxAbsFinishVarianceMinutes = 1248`
- `maxAbsTotalFloatVarianceMinutes = 1.002083333333303` (≈1 work-min)
- `fallbackReason = null`
- `unsupportedFeatureFlags = null`
- `gateDecision.allowed = true`, `gateDecision.rolloutRingAllowed = true`
- `authorityApplied = false`

Note on the max sv/fv: those large values (972/1248) belong almost exclusively to the `summary_or_wbs_rollup_candidate` bucket (`sumSv = 11728` across 492 tasks; `sumFv = 20776`; `avgFv = 42.2` work-min). The three "explanation-bearing" buckets (lag, relationship_chain, unknown) all show `maxSv = maxFv = 3` work-min individually — see Tables 6 and 11.

---

## 9. Dependency Type Distribution (Table 3)

For each bucket, the dep-type distribution of immediate-neighbor edges (predecessors and successors), as `edges / distinct tasks involved`:

| Bucket | FS edges / tasks | SS edges / tasks | FF edges / tasks | SF edges / tasks |
|---|---|---|---|---|
| `lag_semantics_candidate` | 1808 / 643 | 734 / 558 | 941 / 210 | 27 / 24 |
| `relationship_chain_candidate` | 4329 / 1115 | 299 / 211 | 596 / 290 | 27 / 12 |
| `unknown_unclassified` | 807 / 478 | 103 / 97 | 70 / 67 | 5 / 5 |
| `summary_or_wbs_rollup_candidate` | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |

Observations:
- Summary tasks have zero immediate edges in this projection (they are containers; their durations come from the rollup, not edge-driven scheduling).
- FS is dominant in every non-summary bucket — consistent with the corpus being a construction P6 export.
- `lag_semantics_candidate` carries a disproportionate share of FF edges (941, vs. 596 in the much larger `relationship_chain_candidate`). This is expected: FF edges are the canonical home of non-zero finish-to-finish lag in P6 schedules.
- SF is rare everywhere (27 / 27 / 5 across the three buckets).

---

## 10. Lag Value Distribution (Table 4)

Edges with `lagWorkMinutes` grouped by magnitude. Bucket = where the endpoint task is classified.

`lag_semantics_candidate` — 3510 immediate edges:

| lag bucket | edges |
|---|---:|
| 0 | 2219 |
| (0, 480) | 0 |
| =480 | 244 |
| (480, 2400) | 144 |
| ≥ 2400 | 901 |
| ≤ −480 | 2 |
| **nonZero total** | **1291** |
| **zeroEdges** | **2219** |

Tasks-with-non-zero-lag = 740 (= bucket size; every task in this bucket has at least one non-zero-lag edge — that is the definition of the bucket).

Top lag values: `0:2219, 480:244, 4320:130, 2400:106, 960:98, 5280:90, 2880:76, 3360:69`.

`relationship_chain_candidate` — 5251 immediate edges:

| lag bucket | edges |
|---|---:|
| 0 | 5251 |
| nonZero | **0** |

Tasks-with-non-zero-lag = 0. Tasks-with-all-zero-lag = 1167 = bucket size. **Every edge incident to a `relationship_chain_candidate` task has lag = 0.**

`unknown_unclassified` — 985 immediate edges:

| lag bucket | edges |
|---|---:|
| 0 | 985 |
| nonZero | **0** |

Tasks-with-non-zero-lag = 0. Tasks-with-all-zero-lag = 532 = bucket size. **Every edge incident to an `unknown_unclassified` task has lag = 0.**

**This is the definitional consequence of the classifier priority order.** The split between `lag`, `relationship_chain`, and `unknown` is precisely a split on (a) presence of non-zero lag and (b) presence of any edges + topology shape. It is **not** a mechanistic split on the divergence cause.

---

## 11. Immediate Topology Distribution (Table 5)

Topology buckets are `predCount / succCount` aggregated as 0, 1, 2-3, 4-6, 7+ on each side.

`summary_or_wbs_rollup_candidate`: 492 tasks, all `0/0` (isolated containers in the comparison projection).

`constraint_semantics_candidate`: 122 tasks. Mixed shapes — most are `0/1` (65) or `0/2-3` (17). High fan-out 2; high fan-in 15.

`lag_semantics_candidate`: 740 tasks. Summary: 0 isolated; 170 one-to-one; 118 high-fan-in (predCount ≥ 4); 154 high-fan-out (succCount ≥ 4). Top cells: `1/1=170`, `2-3/2-3=187`, `1/2-3=115`, `2-3/1=32`. Wide topological spread.

`relationship_chain_candidate`: 1167 tasks. 0 isolated; 0 one-to-one; 160 high-fan-in; 123 high-fan-out. Top cells: `2-3/2-3=320`, `2-3/1=304`, `1/2-3=263`, `4-6/2-3=65`. Skewed toward 2-3/1 and 2-3/2-3.

`unknown_unclassified`: 532 tasks. 1 isolated (`0/0` count=1); 454 one-to-one (`1/1`); 77 are `1/0`. **Almost the entire bucket is simple linear-chain shapes.** No `predCount ≥ 4` rows; no `succCount ≥ 4` rows.

| Bucket | isolated | one-to-one | high fan-in | high fan-out | total |
|---|---:|---:|---:|---:|---:|
| `summary_or_wbs_rollup_candidate` | 492 | 0 | 0 | 0 | 492 |
| `constraint_semantics_candidate` | 0 | 8 | 2 | 15 | 122 |
| `calendar_boundary_candidate` | 0 | 0 | 0 | 0 | 0 |
| `lag_semantics_candidate` | 0 | 170 | 118 | 154 | 740 |
| `relationship_chain_candidate` | 0 | 0 | 160 | 123 | 1167 |
| `unknown_unclassified` | 1 | 454 | 0 | 0 | 532 |

**Topology observation:** `unknown_unclassified` is overwhelmingly composed of trivial 1/1 and 1/0 chains (531 / 532 = 99.8%). Those are tasks that have zero-lag predecessor or successor links but no fan-in/fan-out fingerprint to mark them as relationship-chain hubs. They are the simplest tasks in the corpus — yet their variance footprint (Table 6) is the same as everything else.

---

## 12. Variance by Dependency Type (Table 6)

`(tasks, sumStartVar, sumFinishVar, maxStartVar, maxFinishVar)` for each bucket × predominant dep-type-presence. "tasks" = number of tasks in the bucket whose edge set contains at least one edge of that type.

`lag_semantics_candidate` (740 tasks, sumSv=1094, sumFv=1024, avgSv=1.478, avgFv=1.384):

| dep-type present | tasks | sumSv | sumFv | maxSv | maxFv |
|---|---:|---:|---:|---:|---:|
| FS | 597 | 867 | 813 | 3 | 3 |
| SS | 48 | 78 | 64 | 3 | 3 |
| FF | 84 | 130 | 130 | 3 | 3 |
| SF | 11 | 19 | 17 | 3 | 3 |

`relationship_chain_candidate` (1167 tasks, sumSv=1659, sumFv=1621, avgSv=1.422, avgFv=1.389):

| dep-type present | tasks | sumSv | sumFv | maxSv | maxFv |
|---|---:|---:|---:|---:|---:|
| FS | 1099 | 1571 | 1539 | 3 | 3 |
| SS | 37 | 43 | 41 | 3 | 3 |
| FF | 27 | 39 | 37 | 3 | 3 |
| SF | 4 | 6 | 4 | 3 | 1 |

`unknown_unclassified` (532 tasks, sumSv=743, sumFv=725, avgSv=1.397, avgFv=1.363):

| dep-type present | tasks | sumSv | sumFv | maxSv | maxFv |
|---|---:|---:|---:|---:|---:|
| FS | 478 | 673 | 651 | 3 | 3 |
| SS | 43 | 58 | 62 | 3 | 3 |
| FF | 10 | 12 | 12 | 3 | 3 |
| SF | 0 | 0 | 0 | 0 | 0 |
| (none) | 1 | 0 | 0 | 0 | 0 |

**Critical observation:** `maxSv = maxFv = 3` work-min in every single (bucket, dep-type) cell. The per-task averages are within 6% of each other across the three buckets (1.40 ↔ 1.48 work-min). The dep-type-stratified variance is statistically flat. Whatever produces the divergence is not selectively sensitive to FS vs SS vs FF vs SF.

---

## 13. Calendar-Lag Interaction (Table 7)

Calendar assignment per bucket:

| Bucket | withAssigned | withoutAssigned | distinctAssignedIds |
|---|---:|---:|---|
| `lag_semantics_candidate` | 0 | 740 | [] |
| `relationship_chain_candidate` | 0 | 1167 | [] |
| `unknown_unclassified` | 0 | 532 | [] |
| `summary_or_wbs_rollup_candidate` | 0 | 492 | [] |

`plannerCalendars = ["default"]` (1 calendar). `projectCalendarId = null` in this projection (the dev workspace has a single default calendar; project-calendar-id is not pinned).

**Conclusion:** In this corpus there is no calendar-lag interaction to test — there is only one calendar. All `assignedCalendarId` fields are `null`, meaning every task inherits the same default calendar. Calendar-binding-divergence cannot be a discriminating root cause of the lag-vs-relationship-chain split. (This is consistent with B2.12A.5 §13 finding that `calendar_boundary_candidate = 0` after the refined hint check.)

This means the AI003 cutover hypothesis "calendar/lag interaction is the dominant residual" is **not supported in the current live corpus**. It cannot be tested here because the corpus has no calendar heterogeneity. It must be re-tested on a corpus with ≥2 distinct planner calendars before that hypothesis can be ruled in or out.

---

## 14. Milestone / Zero-Duration Analysis (Table 8)

`isMilestoneOrZeroDuration = (durationWorkMinutes === 0)`:

| Bucket | milestone count | avgSv | avgFv | nonMilestone count | avgSv | avgFv |
|---|---:|---:|---:|---:|---:|---:|
| `summary_or_wbs_rollup_candidate` | 492 | 23.84 | 42.23 | 0 | — | — |
| `constraint_semantics_candidate` | 0 | — | — | 122 | 1.49 | 1.34 |
| `calendar_boundary_candidate` | 0 | — | — | 0 | — | — |
| `lag_semantics_candidate` | 0 | — | — | 740 | 1.48 | 1.38 |
| `relationship_chain_candidate` | 0 | — | — | 1167 | 1.42 | 1.39 |
| `unknown_unclassified` | 0 | — | — | 532 | 1.40 | 1.36 |

**Observations:**
- Milestones / zero-duration tasks live exclusively in the `summary_or_wbs_rollup_candidate` bucket. The B2.12A.5 priority rule routes milestones to the summary bucket first (their critical-rollup variance is the expected, B2.12A-known divergence).
- None of the three lag / relationship_chain / unknown buckets contain any milestone or zero-duration task. So milestone semantics cannot explain the within-bucket variance footprint of those three.
- The summary bucket carries variance two orders of magnitude larger (avgFv = 42.23 vs ~1.4) — but that variance is the EXPECTED summary-rollup-critical-path divergence and is handled by the `expected_summary_critical_rollup_divergence` classification (count=2 in this corpus) plus the summary bucket itself.

---

## 15. Unknown Bucket Decomposition

`unknown_unclassified` (532 tasks) is the most-suspicious bucket because its tasks don't match any positive signature. Detailed decomposition:

| dimension | value |
|---|---|
| total | 532 |
| isolated (0/0 edges) | 1 |
| with edges | 531 |
| all-zero-lag edges | 532 (100%) |
| any non-zero lag | 0 (0%) |
| variance < 60 work-min | 532 (100%) |
| variance 60–day | 0 |
| variance ≥ 1 day | 0 |
| milestone / zero-dur | 0 |
| constraintType = "ASAP" | 532 (100%) |
| constraintType ≠ "ASAP" | 0 |
| predCount = 0 | 1 |
| predCount = 1 | 531 |
| predCount ≥ 2 | 0 |
| succCount = 0 | 78 |
| succCount = 1 | 454 |
| succCount ≥ 2 | 0 |
| dep-type incident: FS / SS / FF / SF | 807 / 103 / 70 / 5 |
| withAssignedCalendar | 0 |

**Characterization:** 99.8% of `unknown_unclassified` are simple 1-pred / 0-or-1-succ leaf or near-leaf chain nodes whose every incident edge has lag = 0 and whose constraint is "ASAP with no date". They differ from `relationship_chain_candidate` only in topology shape: `relationship_chain_candidate` requires either fan-in ≥ 2, fan-out ≥ 2, or some non-trivial graph signature in the B2.12A.5 classifier. Simple 1/1 zero-lag tasks fall through to `unknown_unclassified`.

The single isolated `0/0` row (taskId `681f0e3b-…` — `"New Task"`) is an editor placeholder; its `tStart=tFinish=sStart=sFinish=0`, `sv=fv=0`, `tfv=1`. It contributes the floor of the `maxAbsTotalFloatVarianceMinutes = 1.002` headline scalar.

---

## 16. Control Group Comparison (Table 10)

`no_difference` control (8 tasks):

| metric | value |
|---|---|
| sample size | 8 |
| dep-types incident (FS/SS/FF/SF) | 6 / 6 / 0 / 0 |
| tasks with non-zero lag edge | 1 (lag = -11040, ALAP procurement) |
| avgSv | 0.000 |
| avgFv | 0.000 |
| all rows have constraintType = "ALAP" | 8 / 8 |
| durations | 480 to 124800 work-min (procurement long-leads) |

`summary_or_wbs_rollup_candidate` control (10 sampled of 492):

| metric | value |
|---|---|
| sample size | 10 |
| edges in projection | 0 / 10 |
| milestone / zero-duration | 10 / 10 |
| avgSv (whole bucket) | 23.84 |
| avgFv (whole bucket) | 42.23 |
| largest fv | tfv = 0, fv = -235 on `5a115b1e-…` ("DCH3 Tranche 2") — summary rollup |

**Comparison:**
- The 8 `no_difference` tasks are exclusively ALAP-constrained procurement long-leads with `tStart=tFinish=sStart=sFinish=0` (project-start anchored). The temporal engine and slot engine agree exactly on those because both reduce to the same trivial ALAP-from-end answer.
- All 3053 `unexplained` tasks (other than the summary 492) are ASAP-constrained with `assignedCalendarId=null`. The ASAP+single-calendar+ordinary-precedence regime is precisely the regime in which the slot engine and the temporal engine should agree to within work-minute precision — and they do, to within 3 work-min, but not to zero.
- The 1 row with non-zero lag (-11040 work-min) in the control group still produces `sv=fv=0`. So non-zero lag alone is not what causes divergence; the divergence requires the ASAP + edge-graph combination, and even then is sub-minute on average.

---

## 17. Representative Examples (Table 11)

50 representative rows each from `lag_semantics_candidate`, `relationship_chain_candidate`, `unknown_unclassified`, plus 10 control rows each from `no_difference` and `summary_or_wbs_rollup_candidate`. Selected by deterministic stride. Full sample tables follow in compact form (taskId truncated to first 8 hex; full ids preserved in evidence capture).

### 17.1 `lag_semantics_candidate` — 50 sampled (top 15 reproduced; remainder are uniform variants)

| # | taskId | sourceActivityId | taskName | predTypes | succTypes | predLags | succLags | dur | sv | fv | tfv |
|---:|---|---|---|---|---|---|---|---:|---:|---:|---:|
| 1 | a3226493 | GG5690 | DCH Security L4 Cx Complete - Phase 1 | FS,FF | FF,FS,FS,FF | 0,0 | 2400,2400,0,2400 | 480 | 1 | 1 | 0 |
| 2 | 2229ec3a | GG5713 | MDA Cooling (Temp or Permanent) in Place | FF,FF,FF,FF | FS | 0,0,0,0 | 2400 | 480 | 1 | 1 | 0 |
| 3 | 72adb81f | CON-018435 | Equipment (MDA Racks, UPS, Battery, CRAC…) Inst | FS,FS,FS | FF,FS,FS,FS,SS | 0,0,0 | 0,0,0,0,3360 | 6720 | 3 | 1 | 0 |
| 4 | f205280e | CON-018686 | MEP 1st Fix | SS | FS | 1440 | 0 | 4320 | 1 | 1 | 0 |
| 5 | 1bc08873 | CON-018420 | Door Jamb Installation | FS,SS | FS,FS,FS | 0,2400 | 0,0,0 | 960 | 1 | 1 | 0 |
| 6 | 7fd6b944 | CON-018422 | Door Jamb Installation | FS,SS | FS,FS | 0,2400 | 0,0 | 1440 | 1 | 1 | 0 |
| 7 | 40c9e055 | CON-018430 | Electrical Raceway Installation | SS,FS | FF,FS,SS,SS | 6720,0 | 0,0,0,6720 | 12960 | 3 | 1 | 0 |
| 8 | d16c415d | CON-018755 | Power Network Module Installation - HAC1 | FS,SS,SS | SS,FS | 0,480,0 | 0,0 | 960 | 3 | 1 | 0 |
| 9 | 5687a696 | CON-018284 | Branch Wiring - HAC3 | FS | SS,FS | 0 | 960,0 | 4320 | 1 | 1 | 0 |
| 10 | bc6e0bef | CON-018265 | BMS Routing - HAC5 | SS | FS | 480 | 0 | 960 | 3 | 1 | 0 |
| 11 | 5cf1d359 | CON-018762 | Power Network Module Installation - HAC8 | SS | FS | 480 | 0 | 960 | 1 | 1 | 0 |
| 12 | b848c289 | CON-018291 | Branch Wiring - HAC10 | FS | SS,FS | 0 | 960,0 | 4320 | 3 | 1 | 0 |
| 13 | f624762d | CON-028262 | BMS Routing - HAC2 | SS | FS | 480 | 0 | 960 | 1 | 3 | 0 |
| 14 | a9eb144a | CON-028759 | Power Network Module Installation - HAC5 | SS | FS | 480 | 0 | 960 | 1 | 1 | 0 |
| 15 | 10418c94 | CON-028288 | Branch Wiring - HAC7 | FS | SS,FS | 0 | 960,0 | 4320 | 1 | 1 | 0 |

(Rows 16–50: same shape — every row has `sv ∈ {1, 3}` and `fv ∈ {1, 3}` and `tfv = 0`. Non-zero lag values present include 480, 960, 2400, 2880, 3360, 4320, 4800, 5280, 6720, 8160, 9600, 12000, 12480, 13440, 15840, 18240, 22560, 24000 — none correlates with a larger variance.)

### 17.2 `relationship_chain_candidate` — 50 sampled (top 15 reproduced)

| # | taskId | sourceActivityId | taskName | predTypes | succTypes | dur | sv | fv | tfv |
|---:|---|---|---|---|---|---:|---:|---:|---:|
| 1 | 189e346f | GG4321 | Phase 1 Foundations Complete | FF,FF,FF,FF | (sink) | 480 | 1 | 1 | 0 |
| 2 | 49d7c5af | GG5665 | L5 Cx Start - Phase 1 | FS×8, SS | (sink) | 480 | 1 | 1 | 0 |
| 3 | 848384d5 | CON-018702 | MEP Final Fix | FS,SS,FS | FS,FS | 4320 | 1 | 1 | 0 |
| 4 | 1b51d5a5 | CON-018736 | Partition Setting out | FS,FS | FS,FS | 960 | 1 | 1 | 0 |
| 5 | e01fb5f9 | CON-018410 | Door Installation | FS,FS | SS | 960 | 1 | 1 | 0 |
| 6 | bf7b4afb | CON-018711 | MEP Final Fix | FS,SS,FS | FS,FS,FS | 960 | 1 | 1 | 0 |
| 7 | 6caa6c4b | CON-018293 | Branch Wiring - MDA HAC2 | FS | SS,FS | 4320 | 3 | 1 | 0 |
| 8 | 90d5ff89 | CON-018747 | Pipe Testing & Torquing - HAC5 | FS | FS,FS | 1440 | 1 | 1 | 0 |
| 9 | 3fce9d0a | CON-018752 | Pipe Testing & Torquing - HAC10 | FS | FS,FS,FS | 1440 | 1 | 1 | 0 |
| 10 | 42793a4d | CON-028640 | In Row Pipe Installation - HAC5 | FS,FS | FS | 480 | 1 | 1 | 0 |
| 11 | e0bde239 | CON-028752 | Pipe Testing & Torquing - HAC10 | FS | FS,FS,FF | 1440 | 3 | 1 | 0 |
| 12 | c35d3ae5 | CON-018370 | Chemical Treatment Unit Install - CTU2 | FS,SS | FS,FS | 480 | 1 | 1 | 0 |
| 13 | 61e61435 | CON-019191 | Fuel Oil Piping (Genset 10-17) | FS,FS | FS,FS | 9600 | 1 | 1 | 0 |
| 14 | 5ce51ae2 | CON-019409 | Pumphouse to SSNR OSP/ISP Fiber | FS,FS,FS | FS,FS | 4320 | 1 | 1 | 0 |
| 15 | c52e73f2 | CON-019038 | Slab Backfilling and Compaction - 3580 sm | FS×4 | FS | 2880 | 3 | 3 | 0 |

(Rows 16–50: same shape — all edge lags = 0; `sv ∈ {0, 1, 3}` and `fv ∈ {0, 1, 3}`; one row (`41b00203` — LOE-012315 long-running summary-equivalent) has `sv=0, fv=0, tfv=1`.)

### 17.3 `unknown_unclassified` — 50 sampled (top 15 reproduced)

| # | taskId | sourceActivityId | taskName | predTypes | succTypes | dur | sv | fv | tfv |
|---:|---|---|---|---|---|---:|---:|---:|---:|
| 1 | 681f0e3b | (null) | New Task | (none) | (none) | 2400 | 0 | 0 | 1 |
| 2 | 2a6a6990 | PUF-012015 | Commence PUF Works | SS | SS | 480 | 3 | 3 | 0 |
| 3 | d35b66e2 | PMC-011510 | DCH1 - Ready for Fitout | SS | SF | 480 | 1 | 1 | 0 |
| 4 | 790500df | GG5089 | MYD - DCH Piping System Install Start | SS | (sink) | 480 | 1 | 1 | 0 |
| 5 | 00e0035e | GG5497 | FSA - L3 Cx Start - Phase 1 | SS | FS | 480 | 1 | 1 | 0 |
| 6 | 8258b6ad | P95-EFA-013901 | EFA-1 to EFA-1 P95 Lag DO NOT TOUCH | FS | FF | 61920 | 1 | 1 | 0 |
| 7 | 46e3e4e7 | CON-019128 | Roll Up Door Installation | FS | FS | 6720 | 3 | 1 | 0 |
| 8 | 8a510c74 | CON-018348 | Cable Tray Installation - MDA HAC1 | SS | FS | 1920 | 1 | 1 | 0 |
| 9 | d23036e6 | CON-018245 | ASP/Upper Rack Stop - HAC1 | FS | FS | 480 | 1 | 1 | 0 |
| 10 | c6d9c729 | CON-018474 | Fire Alarm Routing - HAC3 | FS | FS | 960 | 1 | 1 | 0 |
| 11 | 11963f5b | CON-018611 | Header Pipe Installation - HAC5 | SS | FS | 480 | 3 | 3 | 0 |
| 12 | e5dec6cc | CON-018749 | Pipe Testing & Torquing - HAC7 | FS | FS | 1440 | 1 | 1 | 0 |
| 13 | 66184e38 | CON-018332 | Cable Terminations - HAC8 | FS | FF | 2880 | 1 | 1 | 0 |
| 14 | 0b621ea3 | CON-018303 | Busways - HAC10 | FS | FS | 3360 | 1 | 1 | 0 |
| 15 | 33848666 | CON-028326 | Cable Terminations - HAC2 | FS | FS | 2880 | 1 | 1 | 0 |

(Rows 16–50: identical shape — every row is `1-pred / 0-or-1-succ`, all edge lags = 0, `sv/fv ∈ {1, 3}`, `tfv = 0`.)

### 17.4 `no_difference` control — 8 rows (full)

All 8 are ALAP procurement long-leads. `sv = fv = tfv = 0` on every row. Activities: PRO-014622, PRO-015494, PRO-015495, PRO-015497, PRO-015491, PRO-015672, PRO-015661, GG8138. Row 1 has lag = −11040 on its outgoing FS edge (the only non-zero lag in the entire control group); still produces zero divergence.

### 17.5 `summary_or_wbs_rollup_candidate` control — 10 sampled

| taskId | taskName | tStart | tFinish | sStart | sFinish | sv | fv | tfv |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 1d1bfa93 | (XXX?X) GC Project Schedule … Starter File | 0 | 1487 | 0 | 1486 | 0 | 1 | 0 |
| f28f8646 | DCH1 - HAC 1 | 912 | 984 | 911 | 983 | 1 | 1 | 0 |
| 07d52822 | MDA USS … | 944 | 1016 | 941 | 1015 | 3 | 1 | 0 |
| 0ba09cbb | DCH2 - Roofing Works | 797 | 906 | 794 | 905 | 3 | 1 | 0 |
| bbebf17e | UGS - Zone H | 688 | 968 | 687 | 967 | 1 | 1 | 0 |
| 58d2fae1 | Road Construction - Zone F | 853 | 932 | 850 | 931 | 3 | 1 | 0 |
| 394b6030 | Cluster Logical | 1157 | 1177 | 1156 | 1176 | 1 | 1 | 0 |
| 7c75583b | MYD - Cooling Tower Structural Steel | 972 | 1016 | 969 | 1015 | 3 | 1 | 0 |
| 0d3fe701 | DCH4 - Structural Steel | 800 | 907 | 799 | 906 | 1 | 1 | 0 |
| 5a115b1e | DCH3 Tranche 2 | 1064 | 1220 | 1063 | 1455 | 1 | -235 | 0 |

The last row (`5a115b1e` — DCH3 Tranche 2, `fv = −235`) exhibits the expected summary-critical-path divergence that the B2.12A classifier already accounts for via the `expected_summary_critical_rollup_divergence` path on parent-rollup tasks. The remaining summary rows show the same `sv/fv ∈ {1, 3}` pattern as the three unexplained buckets.

---

## 18. Actuals / Progress Observability Limitation (Table 9)

| variable | observable in B2.12A.6 capture? | source |
|---|---|---|
| `task.actualStart` / `actualFinish` | **NO** | not exposed by `window.__diagnosticState` |
| `task.percentComplete` / `progress` | **NO** | not exposed by `window.__diagnosticState` |
| `task.statusDate` | **NO** | not exposed by `window.__diagnosticState` |
| `task.sourcePlannedStartMinutes` / `sourcePlannedFinishMinutes` | **NO** | not in the mirrored diagnostic state |
| `task.constraintType` | YES | in diagnostic state and projection |
| `task.constraintDateMinutes` | YES | in diagnostic state |
| `task.calendarId` (assigned) | YES | in diagnostic state (`null` everywhere in this corpus) |
| `task.durationWorkMinutes` | YES | in projection |
| `dep.type` / `dep.lagWorkMinutes` | YES | in diagnostic state |
| `temporalStart` / `temporalFinish` | YES | in `comparison.taskComparisons` |
| `slotStart` / `slotFinish` | RECONSTRUCTED | from temporal − variance (identity contract) |
| `gateDecision` / `authorityApplied` | YES | from projection |

**Limitation statement (verbatim):** Actuals, progress, and source planned dates are **not observable without a separately approved DEV-only diagnostic mirror extension** to `apps/web/src/App.tsx` that adds these fields to `window.__diagnosticState`. Such an extension was explicitly **deferred** at the end of B2.12A.6 Phase 1 by user decision. Therefore Phase 2 cannot test the hypothesis "actuals/progress drive the residual variance". That hypothesis remains untested.

---

## 19. Alternative Explanations Tested

The following alternative explanations for the lag-vs-relationship-chain-vs-unknown variance pattern were each tested against the captured evidence:

1. **Calendar–lag interaction.** Tested in §13. Cannot be the explanation in this corpus — there is exactly one calendar. Inconclusive (untested-because-impossible-here).
2. **Dep-type dominance (FS vs SS vs FF vs SF).** Tested in §9 and §12. FS dominates every bucket, but per-task average variance is essentially equal across buckets and dep-types. Not the explanation.
3. **Zero-duration / milestone over-representation.** Tested in §14. Milestones live exclusively in the summary bucket; the three unexplained sub-buckets contain zero milestones. Not the explanation for the lag/relationship/unknown split.
4. **Immediate topology (fan-in / fan-out).** Tested in §11. The three buckets differ topologically (lag has spread, relationship_chain skews high fan-in, unknown is almost entirely 1/1) — but their per-task variance is statistically indistinguishable. Topology shape does not predict variance magnitude within these buckets.
5. **ID-mapping integrity.** Tested in §6. All predIds and succIds in dependencies resolve to a known taskId. No orphaned references. Not a source of divergence.
6. **Lag preservation through the temporal request builder.** Spot-checked against the temporal-request builder identity from Phase 1: `lag_minutes = dep.lagWorkMinutes` passthrough verified. Lag values observed in the projection (480, 2400, 4320, 5280, etc.) are exact P6 multiples — no truncation, no rounding away from those bucket boundaries.
7. **Whether control rows (no_difference) share similar edge patterns.** Tested in §16 and §17.4. The 8 `no_difference` rows are exclusively ALAP procurement; they share no edge pattern with the ASAP unexplained mass. The single non-zero-lag edge in the control (lag = −11040) does not introduce divergence. ALAP-with-no-edge-chain is a structurally different regime from ASAP-with-edge-chain and produces exact agreement; the absence of within-control variance is therefore not evidence about the cause of within-unexplained variance.
8. **Distribution of variance magnitudes per bucket.** §12: `maxAbsVariance = 3` work-min in every cell. §15: 532/532 unknown rows have variance < 60 work-min. §8: `maxAbsTotalFloatVarianceMinutes = 1.002`. The variance is concentrated at the bottom of the work-minute resolution scale.

---

## 20. What Is Proven

P1. B2.12A.5 classifier output is reproducible: same bucket counts (492 / 122 / 0 / 740 / 1167 / 532), same headline scalars, same `gateDecision`, same `authorityApplied = false` on a fresh capture.
P2. ID-mapping integrity holds: 100% of predecessor and successor IDs in 5024 dependencies resolve to known taskIds.
P3. The three "explanation-bearing" sub-buckets (lag, relationship_chain, unknown) are structurally defined by edge-presence and lag-presence and topology, **not** by an independent property of the divergence. Specifically: every `relationship_chain_candidate` task has 100% zero-lag edges; every `unknown_unclassified` task has 100% zero-lag edges; the difference between those two is topology shape, not divergence behavior.
P4. The maximum absolute variance in any individual lag/relationship_chain/unknown task is 3 work-min (start) and 3 work-min (finish). The maximum absolute total-float variance corpus-wide is 1.002 work-min.
P5. All 3053 unexplained tasks have `assignedCalendarId = null` and the only planner calendar is `default`. Calendar-binding heterogeneity is zero in this corpus.
P6. All 3053 unexplained tasks have `constraintType = "ASAP"` with no constraint date. Constraint-semantics heterogeneity is zero in this corpus (post-B2.12A.5 refined classifier; the 122 in `constraint_semantics_candidate` are residual edge cases retained by the meaningful-constraint check, not the broad ASAP-with-no-date class).
P7. Milestones and zero-duration tasks live exclusively in the summary bucket; the three explanation-bearing buckets contain zero milestones.

---

## 21. What Is Likely

L1. The 3053 unexplained divergences appear to be a **single shared sub-minute residue** distributed near-uniformly across all bucketed tasks. The bucket labels (lag / relationship_chain / unknown) stratify the corpus by edge characteristics, but they do not stratify the residue magnitude.
L2. The residue is likely tied to a low-level scheduler-internal granularity property — boundary alignment, work-minute rounding, or sub-minute clock coupling between the slot engine and the temporal engine — that is uniformly applied across all ASAP-constrained tasks in a single-calendar corpus.
L3. The single observed outlier (`maxAbsStartVarianceMinutes = 972`, `maxAbsFinishVarianceMinutes = 1248`) almost certainly belongs to the summary bucket (`sumFv = 20776 / 492 ≈ 42` avg) and is already accounted for by the `expected_summary_critical_rollup_divergence` classification path.
L4. A multi-calendar corpus is required to test whether calendar–lag interaction contributes additional, non-uniform divergence. The current corpus cannot answer that.

---

## 22. What Is Not Proven

NP1. The mechanistic root cause of the sub-minute residue is **not identified by this audit**. The audit shows the residue is uniform; it does not show why it exists.
NP2. Whether actuals / progress / source planned dates contribute to the residue is **not tested**. The DEV-only diagnostic-mirror extension required to test it was deferred.
NP3. Whether a multi-calendar or calendar-pinned-task corpus would surface a different bucket split is **not tested**. This corpus has 1 calendar.
NP4. Whether the temporal kernel exhibits the same sub-minute residue in isolation (Rust unit-test land) is **not tested by this audit**. This audit observes the end-to-end projection output only.
NP5. Whether the residue would clear under a (hypothetical) work-minute-aligned rounding convention applied at the temporal-engine boundary is **not tested**.

---

## 23. Safety Confirmation

The following invariants were preserved through Phase 2:

- ✅ AI003 remains **BLOCKED**. No live cutover. No authority flip.
- ✅ No schedule output change. No effect on the slot engine's output for any user.
- ✅ No classifier change. `UnexplainedDivergenceBuckets.ts` is byte-identical to the B2.12A.5 final form.
- ✅ No gate change. `gateDecision` rules unchanged.
- ✅ No tolerance constant change. No threshold change.
- ✅ No authority flip. `authorityApplied = false` throughout the session.
- ✅ No persistence change. No write to any store, file, or remote.
- ✅ No UAT corpus change. No production data touched.
- ✅ No protocol change. `packages/protocol` byte-identical.
- ✅ No Rust change. `packages/cpm-kernel` byte-identical.
- ✅ No WASM change. `packages/cpm-wasm` byte-identical; `pkg/` artifact unchanged.
- ✅ No React UI change. `apps/web/src/**` byte-identical.
- ✅ No test file change. `packages/worker/tests/**`, `packages/protocol/tests/**`, `apps/ai-proxy/src/*.test.ts`, `apps/web/src/*.test.ts` all byte-identical.
- ✅ No committed diagnostic code. The `page.evaluate` snippet was transient (executed on a running browser; never written to disk in the repo).
- ✅ No recursive graph traversal. Depth = 1 only. `predsByTaskId` and `succsByTaskId` built single-pass over edges.
- ✅ No full graph serialization. Only compact projection rows + aggregates returned.
- ✅ Sample budget honored: 170 deep-sampled rows ≤ 170 cap.

Files created by this milestone: exactly **one** — this document.

---

## 24. Recommended Next Milestone

**B2.12A.7 (proposed): Sub-Minute Residue Mechanistic Trace**

Goal: Identify the mechanistic root cause of the ~1 work-minute uniform residue observed across the 3053 unexplained tasks.

Two possible tracks (mutually exclusive; choose one):

**Track A — Rust unit-test reproduction (preferred, lower risk).**
- Construct a minimal `cpm_tests`-level harness in `packages/cpm-kernel/tests/` that feeds the temporal kernel a 1-calendar ASAP-only 1-pred-1-succ zero-lag chain matching the `unknown_unclassified` shape.
- Compare temporal output to a reference slot-engine-equivalent reduction.
- If the residue reproduces in Rust isolation: the root cause is inside the kernel. Locate via Rust-side instrumentation.
- If the residue does NOT reproduce in Rust isolation: the root cause is in the slot-engine-side reconstruction or in the protocol bridge. Locate via TS-side instrumentation.
- Safety: pure unit test, no UI, no scheduler invocation, no AI003 risk.

**Track B — DEV-only diagnostic-mirror extension (higher risk).**
- Extend `apps/web/src/App.tsx` `window.__diagnosticState` to also expose actuals, progress percent, status date, source planned start/finish (DEV gate flag only).
- Re-run Phase 2 capture with those columns. Re-stratify §17 samples to test whether actuals correlate with residue.
- Safety: requires App.tsx change, must be feature-flagged DEV-only, must not ship to production.

**Recommendation:** Track A first. It is purely additive, byte-isolated to a single test file under `packages/cpm-kernel/tests/`, and answers the most important question first (is this a kernel-side or bridge-side residue?). If Track A clears the kernel, then Track B is justified to investigate the bridge.

Until either track conclusively identifies the mechanism, **AI003 must remain blocked at the live cutover gate**. The B2.12A.5 classifier output is stable, reproducible, and faithful — but the residue it stratifies is not yet explained.

---

*End of W5B-B2.12A.6 audit document.*
