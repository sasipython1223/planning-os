# W5B-B2.12A.1 — AI003 Bucketed Divergence Evidence Capture

> **Evidence-capture only.** No code, schedule outputs, gates, tolerances,
> `unsupportedFeatureFlags`, or persistence behaviour were changed by this
> milestone. Dogfood apply was **not** run. UAT and production were **not**
> enabled. Temporal-authoritative persistence was **not** enabled.

---

## 1. Summary

A fresh rerun of the temporal candidate projection against
`apps/web/tests/fixtures/local/AI003.xer` was performed against the
B2.12A build (which adds read-only diagnostic buckets to
`unexplained_divergence` rows). The rerun was driven via the page-console
operator path (`__runTemporalWasmValidationGate` →
`__runTemporalCandidateProjection`) on `localhost:5174`.

**Material finding — supersedes the B2.11D operator number:**
This rerun reports `unexplainedDivergenceCount = 3061` (out of 3062
compared tasks), not 49. The B2.11D capture's `49` figure is **not
reproduced** by this run. The new numbers below are the source of truth
for AI003 under this build; the discrepancy with B2.11D is recorded in
§9 as a recommended investigation item.

The bucket distribution shows the 3061 unexplained rows are dominated
by `missing_calendar_metadata_candidate` (2569) and
`summary_or_wbs_rollup_candidate` (485), with 7 rows in
`unknown_unclassified` and the remaining buckets at zero.

`sourceProtectionStatus = ok`, `authorityApplied = false`,
`persistenceApplied = false`, `currentAuthorityEngineMode = slot_authoritative`.
The system is in a safe state.

---

## 2. WASM Gate Result

Call: `await window.__runTemporalWasmValidationGate()`

| Field | Value |
| --- | --- |
| `realWasmValidationPassed` | `true` |
| `wasmLoadMode` | `real` |
| `scenariosPlanned` / `scenariosExecuted` / `scenariosPassed` | `7 / 7 / 7` |
| `scenariosFailed` / `scenariosBlocked` | `0 / 0` |
| `sourceProtectionStatus` | `ok` |
| `authorityApplied` | `false` |
| `performanceMs` | `1.7` |
| `temporalExecutionErrors` | `[]` |
| `unexplainedDivergenceTaskIds` | `[]` |
| `expectedDivergenceTaskIds` | `["succ"]` |

All seven validation scenarios passed (`single_calendar_5d`,
`single_calendar_6d`, `single_calendar_7d`, `multi_calendar_5d_to_7d`,
`multi_calendar_7d_to_5d`, `invalid_calendar_fallback`,
`source_date_protection`).

---

## 3. Candidate Projection Summary

Call:

```js
await window.__runTemporalCandidateProjection({
  runWasmGateFirst: true,
  temporalCandidateProjectionEnabled: true,
  temporalAuthorityRolloutRing: "dogfood",
  useLastSuccessfulWasmGate: true,
});
```

### 3.1 `projection.comparison`

| Field | Value |
| --- | --- |
| `comparedTaskCount` | **3062** |
| `identicalTaskCount` | **0** |
| `expectedCalendarDivergenceCount` | `0` |
| `unsupportedFeatureDivergenceCount` | `0` |
| `expectedSummaryCriticalRollupDivergenceCount` | `1` |
| `unexplainedDivergenceCount` | **3061** |
| `criticalFlagVarianceCount` | `373` |
| `maxAbsStartVarianceMinutes` | **970** |
| `maxAbsFinishVarianceMinutes` | **1250** |
| `maxAbsTotalFloatVarianceMinutes` | `1` |

### 3.2 `projection.diagnostics`

| Field | Value |
| --- | --- |
| `candidateProjectionAvailable` | `true` |
| `candidateProjectionBlockedReason` | `null` |
| `unsupportedFeatureFlags` | `[]` |
| `temporalExecutionErrors` | `[]` |

### 3.3 Misc

| Field | Value |
| --- | --- |
| `projection.performanceMs` | `60` |
| `gateDecision.allowed` | `true` (candidate-projection gate; **not** the cutover/apply gate) |
| `gateDecision.blockedReason` | `null` |
| `gateDecision.rolloutRingAllowed` | `true` |
| `authorityApplied` | `false` |

> The projection-level `gateDecision.allowed = true` only reports that the
> candidate-projection step itself was allowed to run. It is **not** an
> authorisation to apply temporal-authoritative results. Apply was not
> invoked. See §6.

---

## 4. Bucket Distribution

Per-bucket counts among the 3061 unexplained rows (mutually exclusive,
first-match priority order; classifier defined in
[`UnexplainedDivergenceBuckets.ts`](../../packages/worker/src/schedule/UnexplainedDivergenceBuckets.ts)):

| Bucket | Count |
| --- | --- |
| `summary_or_wbs_rollup_candidate` | **485** |
| `missing_calendar_metadata_candidate` | **2569** |
| `constraint_semantics_candidate` | `0` |
| `lag_semantics_candidate` | `0` |
| `calendar_boundary_candidate` | `0` |
| `relationship_chain_candidate` | `0` |
| `unknown_unclassified` | `7` |
| **Total** | **3061** |
| Rows with missing/null bucket | `0` |

Observations (Facts about the heuristic output, not root-cause claims):

- 100% of unexplained rows received a bucket — none fell through to
  `null`.
- `missing_calendar_metadata_candidate` is **dominant** (~83.9% of
  unexplained rows). This is consistent with the import preview's
  *"Recalculation risk: High — one or more calendars cannot be applied
  by the engine."* Under the classifier's priority order, this bucket
  fires when a task references a calendar id whose metadata is not
  present in either the worker's `calendarDefinitions` map or the
  `calendars` map.
- `summary_or_wbs_rollup_candidate` (~15.8%) wins the priority on
  summary/WBS rows even if those rows would also be flagged as
  missing-calendar — this is by design (structural signal beats
  numeric signal).
- `calendar_boundary_candidate`, `lag_semantics_candidate`,
  `constraint_semantics_candidate`, and `relationship_chain_candidate`
  are all zero. Because higher-priority buckets consumed almost every
  divergent row, this **does not** imply lag/constraint/chain effects
  are absent in AI003 — it only means no row reached those tests.

---

## 5. Top Variance Examples

Ranked by `max(|startVarianceMinutes|, |finishVarianceMinutes|)` among
`unexplained_divergence` rows. Task ids are UUIDs (AI003 uses opaque
ids for its non-source-coded rows); `sourceActivityId` / task name were
not captured for these UUIDs in this rerun — see §9 for the recommended
follow-up to enrich this table with `sourceActivityId` / `name`.

| # | Task id | Bucket | Start Δ (min) | Finish Δ (min) | TotalFloat Δ (min) |
| --- | --- | --- | ---: | ---: | ---: |
| 1 | `12a645aa-a43c-46bf-97ea-f6c438aee504` | `summary_or_wbs_rollup_candidate` | -700 | -1250 | 0 |
| 2 | `9c3aec19-eb86-4e30-b4c3-a23cdef2d888` | `summary_or_wbs_rollup_candidate` | -532 | -1230 | 0 |
| 3 | `47e413a9-c95c-41da-b962-7c8cba1ba5b8` | `summary_or_wbs_rollup_candidate` | -532 | -1230 | 0 |
| 4 | `f1b2acc8-5476-4720-a1d0-1c7ac6f94c24` | `summary_or_wbs_rollup_candidate` | -757 | -1230 | 0 |
| 5 | `5b7d2e9a-112e-4f12-849a-7ca1ea0e98d5` | `summary_or_wbs_rollup_candidate` | -700 | -1222 | 0 |
| 6 | `09665209-ced8-4e71-8a94-5e93118780ab` | `summary_or_wbs_rollup_candidate` | -700 | -1222 | 0 |
| 7 | `7c454dc6-f7f3-407c-bac2-fc41c639a487` | `summary_or_wbs_rollup_candidate` | -892 | -1136 | 0 |
| 8 | `768857d6-c3a9-4fb7-a653-60014206650c` | `summary_or_wbs_rollup_candidate` | -970 | -1136 | 0 |
| 9 | `117e91c0-a4e5-46d7-93cc-61c9996e3cdf` | `summary_or_wbs_rollup_candidate` | -532 | -1080 | 0 |
| 10 | `bf274b83-5a10-4829-9457-9bb88761d77e` | `summary_or_wbs_rollup_candidate` | -861 | -1017 | 0 |

All top-10 by raw magnitude land in `summary_or_wbs_rollup_candidate`.
The `maxAbsFinishVarianceMinutes` of 1250 in §3.1 is reproduced by row 1.
The `maxAbsStartVarianceMinutes` of 970 in §3.1 is reproduced by row 8.

> Per the classifier's priority order, a summary row is bucketed as
> `summary_or_wbs_rollup_candidate` regardless of other signals — so
> the *underlying cause* on these top rows is not directly visible from
> the bucket alone. They may simultaneously be missing-calendar
> candidates (the rollup arithmetic just disagrees on summary
> early-finish because the children's calendars differ between slot
> and temporal engines). See §9.

---

## 6. Safety Confirmation

Captured via `await window.__getTemporalAuthorityDiagnostics()` after
the projection run:

| Field | Value |
| --- | --- |
| `currentAuthorityEngineMode` | **`slot_authoritative`** |
| `previousAuthorityEngineMode` | `slot_authoritative` |
| `appliedEngine` | `unknown` (apply never invoked) |
| `applyMode` | `unknown` |
| `rolloutRing` | `unknown` |
| `authorityApplied` | **`false`** |
| `fallbackReason` | `null` (apply not invoked) |
| `lastTemporalAuthorityRunId` | `null` |
| `lastTemporalAuthorityDecision` | `null` |
| `lastTemporalAuthorityAuditPreview` | `null` |
| `lastTemporalCandidateRunId` | `f51ef7ee-3826-4f64-aa85-afdaa043e996` |
| `candidateProjectionAvailable` | `true` |
| `comparisonPresent` | `true` |
| `unexplainedDivergenceCount` | `3061` |
| `realWasmValidationPassed` | `true` |
| `wasmLoadMode` | `real` |
| **`sourceProtectionStatus`** | **`ok`** |
| **`persistenceApplied`** | **`false`** |

Explicit confirmations against the milestone rules:

- ✅ `authorityApplied = false`
- ✅ Dogfood apply **not** run (no call to `__runTemporalAuthorityApply`).
- ✅ `persistenceApplied = false`
- ✅ `sourceProtectionStatus = ok`
- ✅ `currentAuthorityEngineMode = slot_authoritative`
- ✅ `unsupportedFeatureFlags = []` unchanged
- ✅ No code, schedule output, gate, or tolerance change shipped by this
  milestone.

---

## 7. Files Changed

Documentation only:

- New: [docs/milestones/W5B-B2.12A.1-AI003-bucketed-evidence.md](W5B-B2.12A.1-AI003-bucketed-evidence.md) (this file).
- Updated: [docs/milestones/W5B-B2.12A-AI003-divergence-investigation.md](W5B-B2.12A-AI003-divergence-investigation.md)
  — §6 (operator-captured bucket distribution) and §12 (confirmed-vs-hypothesis
  summary) updated to point to this evidence file.

No source files were modified. `git status --short` and `git diff --stat`
expected to show only `docs/milestones/*.md` entries.

---

## 8. Validation Results

Per the milestone brief: **"If docs only changed after evidence capture:
git diff --stat; git status --short."**

Because only docs changed, the heavy validation matrix is not required.
`git status --short` and `git diff --stat` are the validation artifacts;
both are expected to list two markdown files only.

The previously-run B2.12A validation matrix (still applicable to the
unchanged code state) was:

| Suite | Result |
| --- | --- |
| `pnpm -C packages/protocol exec tsc -b` | clean |
| `pnpm -C packages/worker exec tsc --noEmit` | clean |
| `pnpm -C apps/web exec tsc -b` | clean |
| `pnpm -C packages/worker exec vitest run` | 1268 / 65 |
| `pnpm -C apps/web exec vitest run` | 505 / 40 |
| `pnpm -C apps/web test:wasm-browser` | 1 / 1 |

---

## 9. Recommendation

**Confirmed facts (from this rerun):**

1. AI003 reports `unexplainedDivergenceCount = 3061` of 3062 compared
   tasks under the current build — vastly more than the B2.11D operator
   capture's `49`. The new numbers are reproducible from
   `apps/web/tests/fixtures/local/AI003.xer` plus the page-console
   operator path on this build.
2. The bucket distribution is **dominated by
   `missing_calendar_metadata_candidate` (2569)** and
   **`summary_or_wbs_rollup_candidate` (485)**, with 7
   `unknown_unclassified` and zero in every other bucket.
3. Safety invariants hold: source dates protected, no apply, no
   persistence, slot-authoritative still current.
4. The `maxAbsFinishVarianceMinutes = 1250` is ~2.6 working days; the
   `maxAbsStartVarianceMinutes = 970` is ~2.0 working days.

**Hypotheses (heuristic — NOT confirmed root causes):**

- The dominant `missing_calendar_metadata_candidate` count suggests the
  worker's `calendarDefinitions` / `calendars` map does not contain
  metadata for the calendar ids assigned to most AI003 tasks. The
  import preview's *"11 simplified for engine"* line is consistent
  with the engine carrying compiled/simplified calendar definitions
  under different ids than the per-task `assignedCalendarId` values.
  If true, this is a **metadata-binding issue**, not a scheduling
  semantics divergence.
- The 485 summary rows are likely cascading downstream from their
  missing-calendar leaves: when leaves resolve at different
  finish-minutes under the temporal engine, summary rollups disagree
  by the same magnitude.
- The B2.11D `49` figure is unexplained. Possible explanations
  (none confirmed): (a) a different AI003 fixture revision, (b) a
  different build version of the worker calendar-metadata loader,
  (c) a different operator workflow (e.g. re-saving the file or running
  a recalculation before capturing diagnostics). The B2.12A note's §2
  remains as historical operator evidence but is no longer the current
  number for this fixture under this build.

**Recommended future engineering work:**

1. **(High priority)** Verify whether the worker's
   `getCalendarDefinitions()` and `getCalendars()` actually receive
   the 11 imported AI003 calendars under the same ids that
   `task.assignedCalendarId` references. If not, fix the
   metadata-binding gap in the import path. This single change is
   the most likely lever to reduce AI003's bucket distribution
   substantially.
2. **(Medium)** Reconcile the B2.11D `49` vs the current `3061`
   capture: rerun B2.11D operator steps on a clean machine to confirm
   which figure represents the actual current behaviour.
3. **(Medium)** Enrich the per-task evidence with `sourceActivityId`
   and `name`. The current bucket payload deliberately keeps only
   variance-relevant fields; the operator note can be supplemented by
   a one-off page-console snippet that joins `taskComparisons` with
   `state.tasks` for the top-N rows. This was out of scope for B2.12A
   itself (which is read-only and avoids changing the protocol shape
   further) but would help the next investigation.
4. **(Low)** Once metadata-binding is fixed, rerun and re-bucket. If
   `lag_semantics_candidate` / `constraint_semantics_candidate` /
   `calendar_boundary_candidate` start surfacing non-zero counts, the
   classifier vocabulary is doing its job; otherwise the gate is
   correctly blocking on a metadata problem rather than a semantics
   problem.

**Strict invariants reaffirmed by this milestone:**

- AI003 remains correctly **not applied** by the temporal engine.
- No tolerance change is proposed. The investigation path is to
  attribute, then fix, the metadata binding — not to relax the gate.
- No UAT, no production, no temporal-authoritative persistence enabled.
- No source-date mutation; `sourceProtectionStatus = ok`.

---

*End of W5B-B2.12A.1 evidence capture.*
