# W5B-B2.12A.4 — AI003 Constraint Semantics Divergence Audit

Status: **Audit-only milestone. AI003 remains blocked. No code changed. No
classifier changed. No gate changed.**

Verbatim mandate (carried forward from the milestone brief):

> "Produce an evidence-based audit explaining why 2569 AI003 leaf divergences
> are classified as constraint_semantics_candidate."
>
> "Do not assume constraint semantics is the confirmed root cause."

---

## 1. Executive Summary

The B2.12A.3 classifier labels 2569 AI003 leaf rows as
`constraint_semantics_candidate`. Phase 1 surfaced a stronger competing
hypothesis (slot-vs-temporal calendar-binding asymmetry). Phase 2 captured
fresh live evidence from `__diagnosticState` plus a `__runTemporalCandidateProjection`
run against the AI003 fixture and tested four explanatory hypotheses.

The evidence does **not** support the constraint-semantics label as the root
cause for the 2569 leaves. The strongest objective findings are:

1. Of the unexplained leaf rows in the bucket, **~95.5% carry
   `constraintType = "ASAP"`** — P6's no-op default, which P6 stamps on every
   exported activity. ASAP is not a non-trivial scheduling constraint, so it
   cannot mechanically generate "constraint semantics" divergence.
2. The non-ASAP-constraint leaves (ALAP, MSO; total 115 rows) show variance
   magnitudes of ≤3 minutes — **the same magnitude and shape** as the ASAP
   leaves. If constraint semantics were the divergence driver, the non-ASAP
   group would diverge differently from the ASAP group. It does not.
3. The variance pattern across all 2561 leaves is uniform:
   start ≈ +3 min, late-start ≈ +1 min, finish ≈ +3 min, late-finish ≈ +1 min,
   total-float ≈ 0, critical-flag delta = 0%. This is a systemic minute-level
   offset, not a per-task semantic divergence.
4. Inspection of [`packages/worker/src/temporal/temporalRequestBuilder.ts`](../../packages/worker/src/temporal/temporalRequestBuilder.ts#L168-L170)
   confirms: the temporal candidate path passes `calendar_id = projectCalendar.id`
   **for every task**, while the slot path
   ([`packages/worker/src/schedule/MinuteEngineAdapter.ts:62`](../../packages/worker/src/schedule/MinuteEngineAdapter.ts#L62))
   passes `task.assignedCalendarId ?? projectCalendar`. This is an objective
   asymmetry between the two engines.
5. The classifier label `constraint_semantics_candidate` therefore appears to
   be a **second classifier over-firing**: the `hasConstraint` hint fires for
   ANY non-null `constraintType` (including ASAP), pre-empting the
   `calendar_boundary_candidate` and `relationship_chain_candidate` branches
   for the entire leaf population.

**Recommended next milestone:** refine the classifier's `hasConstraint` hint to
exclude the no-op default ("ASAP" with null constraint date) **and** instrument
slot-vs-temporal calendar binding to capture the minute-level offset source.
Both are diagnostic-only changes. AI003 must remain blocked until that work is
completed.

---

## 2. Decision Ledger

| Decision | Status |
| --- | --- |
| Do not assume constraint semantics is the root cause | Honored |
| No scheduling-logic change | Honored |
| No classifier change | Honored |
| No gate/tolerance change | Honored |
| No authority apply / persistence / UAT / production toggle | Honored |
| No protocol contract change | Honored |
| No Rust kernel change | Honored |
| No WASM-binding instrumentation | Honored |
| No React UI change | Honored |
| AI003 remains blocked | Honored |
| Bounded sample (≤80 deep rows) | Honored: 28 constraint-sample + 10 summary control = 38 rows |
| Use existing DEV diagnostic hooks only | Honored |
| Transient browser capture, not committed | Honored |

---

## 3. Scope Confirmation

Files created in this milestone: **one** — this document.

Files modified: **none**.

Tests added: **none** (no code modified ⇒ no validation runs required).

Browser capture: transient `page.evaluate()` snippets only; nothing committed.

---

## 4. Phase 1 Finding Carried Forward

Phase 1 inspection (see prior chat record) established that the slot and
temporal candidate code paths differ in calendar binding:

- Slot path
  ([MinuteEngineAdapter.ts:62](../../packages/worker/src/schedule/MinuteEngineAdapter.ts#L62)):

  ```ts
  calendarId: task.assignedCalendarId ? String(task.assignedCalendarId) : projectCalendar.id
  ```

- Temporal candidate path
  ([temporalRequestBuilder.ts:170](../../packages/worker/src/temporal/temporalRequestBuilder.ts#L168-L170)):

  ```ts
  // Phase D2: calendar_id = project calendar for all tasks.
  // Phase C stored assignedCalendarId on tasks, but it is metadata only —
  // no per-task calendar scheduling occurs until Phase D3+.
  const calendarId = (projectCalendar.id as string);
  ```

This is a structural, non-hypothetical asymmetry. Whether it is the **primary**
mechanism producing the 2569 leaf variances is the central question for the
analysis in §15.

---

## 5. Current Corrected Bucket Baseline

The Phase-2 live run (this session) produced the comparison summary below.
The bucket counts quoted in the milestone brief (492 summary / 2569 constraint
/ 0 others / 3061 total) are the authoritative baseline from B2.12A.3 and are
carried forward unchanged. Live numbers drifted by ±8 rows in this session
(see §6).

| Metric | B2.12A.3 baseline | Phase-2 live |
| --- | ---: | ---: |
| Total tasks | 3062 | 3063 |
| Compared tasks | 3062 | 3063 |
| Identical tasks | 0 | 8 |
| `expected_summary_critical_rollup_divergence` | 1 | 2 |
| `unexplained_divergence` | 3061 | 3053 |
| `summary_or_wbs_rollup_candidate` (within unexplained) | 492 | 492 |
| `constraint_semantics_candidate` | 2569 | (browser cannot recompute; see §8) |
| Max abs start variance (min) | 970 | 972 |
| Max abs finish variance (min) | 1250 | 1248 |
| Max abs total-float variance (min) | 1 | 1.002 |
| `realWasmValidationPassed` | true | true |
| `wasmLoadMode` | real | real |
| `sourceProtectionStatus` | ok | ok |
| `authorityApplied` | false | false |
| `persistenceApplied` | false | false |

The two baselines are operationally equivalent for the purposes of this audit.

---

## 6. Data Capture Method

All data was captured by `page.evaluate` calls against `localhost:5173` with
AI003 hydrated.

### Hooks used

- `window.__diagnosticState` — main-thread mirror of worker state, populated by
  the DEV-only effect in [`apps/web/src/App.tsx:727`](../../apps/web/src/App.tsx#L727).
- `window.__runTemporalCandidateProjection({ temporalCandidateProjectionEnabled: true, temporalAuthorityRolloutRing: "internal_test", runWasmGateFirst: true })`
  — exercises the worker's existing temporal candidate projection pipeline and
  returns `projection.comparison.taskComparisons` plus `projection.candidateTasks`.
- `window.__getTemporalAuthorityDiagnostics()` — exposes `realWasmValidationPassed`,
  `wasmLoadMode`, `sourceProtectionStatus`, `authorityApplied`, etc.

### Observability boundary (objective limitation)

`window.__diagnosticState.tasks` is a **stripped main-thread projection**
of the worker's tasks. It does **not** carry `assignedCalendarId` or
`sourceImportRecord` in this session (verified by inspecting
`Object.keys(__diagnosticState.tasks[10])` = `["id","sourceActivityId","name",
"durationWorkMinutes","parentId","constraintType","constraintDateMinutes",
"siblingOrder"]`, and `__diagnosticState.sourceImportRecord = null`).

Consequence: **browser-side capture cannot directly group the 2569 rows by
`assignedCalendarId` or by source calendar registry**. Exposing the worker's
full Task object on `window` would require modifying
[`apps/web/src/App.tsx`](../../apps/web/src/App.tsx) — a forbidden file under
this milestone's scope. Therefore §10 (Calendar Distribution) is constrained to
the B2.12A.2/B2.12A.3 prior captures (carried forward as documented evidence,
not re-derived).

### What was directly captured this milestone

- 3063 task comparisons (variance per task, classification per task).
- 3063 candidate task results (`earlyStart`, `earlyFinish`, `lateStart`,
  `lateFinish`, `totalFloat`, `freeFloat`, `critical`).
- 3063 task metadata rows (`id`, `sourceActivityId`, `name`, `parentId`,
  `isStructuralSummary`, `constraintType`, `constraintDateMinutes`,
  `durationWorkMinutes`, `siblingOrder`).
- 5024 dependency rows (`predId`, `succId`, `lagWorkMinutes`, `type`).
- 28-row constraint-bucket sample + 10-row summary control sample (§14).

---

## 7. Performance / Sampling Method

Total deep-inspected rows: **38** (28 + 10). Budget cap was 80. Budget not
exceeded.

Sample stratification for the constraint sample (28 unique rows after
dedupe):

| Stratum | Rows |
| --- | ---: |
| Top 10 leaves by absolute start variance | 10 |
| Top 10 leaves by absolute finish variance | additional 0 (overlap) |
| Up to 5 leaves per non-ASAP constraint type — ALAP | 5 |
| Up to 5 leaves per non-ASAP constraint type — MSO | 3 (only 3 exist) |
| ASAP leaves by abs(start) | additional 10 |
| **Total unique constraint-bucket sample** | **28** |
| Summary control (`summary_or_wbs_rollup_candidate`) | 10 |

(SNET, FNLT, MFO constraints not present in the AI003 fixture — see §9.)

Calendar-stratified rows (≥5 each for calendars 10288, 10285, 6693, 7701)
**could not be sampled this milestone** because `assignedCalendarId` is not
present in the browser-visible diagnostic state (§6). Calendar-by-calendar
evidence is carried forward verbatim from B2.12A.2 §Calendar binding table.

---

## 8. Calendar-Binding Analysis

### Direct (this milestone) — limited by §6

The 2561 leaf unexplained rows captured this session — **not** the bucket
count, because browser-side reconstruction of the bucket is unreliable without
`assignedCalendarId` (§6). Constraint-type composition:

| `constraintType` | Leaves in unexplained_divergence |
| --- | ---: |
| ASAP | 2446 |
| ALAP | 112 |
| MSO | 3 |
| **Total** | **2561** |

Summary rows in `unexplained_divergence` (priority-routed to
`summary_or_wbs_rollup_candidate` by the classifier, not present in
constraint bucket): 492. All carry `constraintType = "ASAP"`.

### Carried forward from B2.12A.2 §6 (authoritative)

- Total tasks: 3062. Tasks with `assignedCalendarId` set: **2569**.
  Tasks without: **493** (these inherit project default; map to summary
  bucket).
- The 2569 figure matched the `constraint_semantics_candidate` bucket size
  exactly in B2.12A.3. (This session reports 2561 leaves in unexplained, with
  ±8-row drift attributable to the 8 additional `no_difference` matches and
  +1 task in the loaded fixture.)
- Per-task calendars in use: 10288 (2051 leaves), 10285 (461), 6693 (41),
  7701 (16). Summaries have no `assignedCalendarId`.

### Calendar-binding asymmetry in code (objective)

| Path | File | Per-task calendar passed to engine? |
| --- | --- | :---: |
| Slot | [MinuteEngineAdapter.ts:62](../../packages/worker/src/schedule/MinuteEngineAdapter.ts#L62) | **Yes** (`task.assignedCalendarId ?? projectCalendar`) |
| Temporal candidate | [temporalRequestBuilder.ts:168-170](../../packages/worker/src/temporal/temporalRequestBuilder.ts#L168-L170) | **No** (all tasks → project calendar) |

This asymmetry is a structural, code-level fact. The runtime effect on the
2569 rows cannot be measured from the browser this milestone (would require
worker-thread instrumentation, which is forbidden by scope), but the magnitude
direction is consistent with the observed +1 to +3 minute offsets.

---

## 9. Constraint-Type Distribution

Of the 3053 `unexplained_divergence` rows (summaries + leaves), grouped by
`constraintType`:

| `constraintType` | Count | % | Avg Start Δ (min) | Avg Finish Δ (min) | Max abs Start Δ | Max abs Finish Δ |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ASAP  | 2938 | 96.23% | −2.37 | −5.04 | 972 | 1248 |
| ALAP  | 112  | 3.67%  | +1.50 | +1.37 | 3   | 3 |
| MSO   | 3    | 0.10%  | +1.67 | +1.00 | 3   | 1 |
| SNET  | 0    | 0.00%  | —     | —     | —   | — |
| FNLT  | 0    | 0.00%  | —     | —     | —   | — |
| MFO   | 0    | 0.00%  | —     | —     | —   | — |

Observations:

- **96.23%** of unexplained rows carry P6's no-op default ASAP. ASAP is not a
  scheduling constraint that the kernel acts on — it is the absence of a
  constraint. By definition there is no "constraint semantics" to diverge on
  for these rows.
- The 972 / 1248-min extremes are concentrated in the ASAP bucket — but these
  extremes belong to summaries (see §13), which are priority-routed to the
  summary bucket and are not the 2569 leaf rows under audit.
- Non-ASAP leaves (115 rows total: ALAP + MSO) have maximum absolute variances
  ≤3 min — i.e. **the same magnitude as ASAP leaves** (see §11).

---

## 10. Calendar Distribution

Direct browser-side calendar distribution **was not observable this
milestone** because `__diagnosticState.tasks` does not carry
`assignedCalendarId` (see §6 / §8).

Carried forward verbatim from B2.12A.2 §6 (authoritative):

| `assignedCalendarId` | Tasks (leaves) | In source `calendarDefinitions` | In source `resolvedCalendarDefinitions` | In worker `calendarDefinitions` | In worker `plannerCalendars` | Binding status |
| --- | ---: | --- | --- | --- | --- | --- |
| 10288 | 2051 | yes | yes | yes | no | resolved via source registry |
| 10285 | 461  | yes | yes | yes | no | resolved via source registry |
| 6693  | 41   | yes | yes | yes | no | resolved via source registry |
| 7701  | 16   | yes | yes | yes | no | resolved via source registry |

The 2569 row total exactly matches `tasks_with_assignedCalendarId` from B2.12A.2.
Whether these per-task calendars differ from the project calendar
**at the working-time level** is a separate question that requires
calendar-compilation telemetry not available without forbidden code changes
(§19).

---

## 11. Variance Pattern Analysis

Across the 2561 leaf `unexplained_divergence` rows captured this session:

| Pattern | % rows non-zero |
| --- | ---: |
| Early-start variance | 99.73% |
| Early-finish variance | 99.69% |
| Late-start variance | 98.87% |
| Late-finish variance | 98.79% |
| Total-float variance | 1.44% |
| Critical-flag variance | 0.00% |

Shape (representative; ≥95% of leaf rows fit one of two templates):

| Template | Start Δ | Finish Δ | Late-Start Δ | Late-Finish Δ | TF Δ | Crit Δ |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| ASAP-leaf typical | +3 | +3 | +1 | +1 | 0 | none |
| ALAP-leaf typical | +1 | +1 | +1 | +1 | 0 | none |
| MSO-leaf typical  | +1 to +3 | +1 | +1 to +3 | +1 | 0 | none |

Interpretation:

- The variance is overwhelmingly an **early-date offset of 1–3 minutes** in
  the same direction (temporal > slot). Late dates shift by ~1 min in the
  same direction.
- Total float is preserved to within 1 minute almost everywhere.
- The critical-flag is consistent on leaves (0% delta on the 2561 leaves;
  368 critical-flag differences exist in the comparator total but are
  concentrated in summaries — see §13).
- Magnitudes are uniform across constraint types — i.e. **the variance does
  not scale with constraint specificity**. A genuine constraint-semantics
  divergence would, at minimum, show different magnitudes for SNET vs ASAP
  or ALAP vs ASAP.

---

## 12. Relationship / Lag Control

Within the 28-row constraint sample:

- Rows with `hasNonZeroLag = true`: **7 / 28** (25%).
- Predecessor count distribution in sample: 0–17 (median ~2).
- Successor count distribution in sample: 0–11 (median ~1).

Observations:

- Rows with non-zero lag (7) show **the same +1 to +3 min variance shape** as
  rows with zero lag — including the ALAP rows ZZ1760, ZZ2700, ZZ3700 which
  all have `hasNonZeroLag = true` and variance +1/+1/+1/+1.
- Lag does not appear to be the primary driver. If lag-semantics were
  driving divergence, the magnitudes should correlate with lag presence /
  magnitude. They do not in the sample.

---

## 13. Summary/WBS Control Group

10 sampled `unexplained_divergence` summary rows (priority-routed to
`summary_or_wbs_rollup_candidate` bucket — these are NOT in the 2569
constraint bucket; they serve as a contamination control):

| Sample # | Name | Children? | Start Δ | Finish Δ | Late-Finish Δ | Crit Δ |
| ---: | --- | :---: | ---: | ---: | ---: | :---: |
| 1 | "(XXX?X) GC Project Schedule — Starter File" | yes | 0 | +1 | +1 | no |
| 2 | "Phase 1" | yes | 0 | −51 | −51 | no |
| 3 | "Milestones" | yes | 0 | −15 | −15 | no |
| 4 | "Offsite Utility Milestones" | yes | 0 | **−1120** | **−1120** | no |
| 5 | "Foundations, Core & Shell" | yes | +1 | +3 | +3 | **yes** |
| 6 | "Piling Milestones" | yes | +3 | +1 | +1 | **yes** |
| 7 | "Perun Substation" | yes | +1 | **−189** | **−189** | no |
| 8 | "Interior Fitout" | yes | +1 | +1 | +1 | **yes** |
| 9 | "DCRE Product Assembly" | yes | +3 | +1 | +1 | **yes** |
| 10 | "FIA Product / Glue Systems" | yes | +3 | +1 | +1 | **yes** |

Observations:

- All 10 sampled summary rows have `isStructuralSummary = true` AND
  `hasChildren = true`. None bleed into the leaf bucket.
- Summary variances are dominated by large negative finish-Δ values (−51,
  −189, −1120) caused by the WBS rollup mechanism — see B2.12A.3
  rollup-recompute discussion. Critical-flag variance is concentrated here
  (368 total across summaries + a few leaves).
- The leaf bucket (§14) shows no summary-shape contamination.

Conclusion: the 2569 constraint bucket is **not** contaminated by structural
summary rows. The summary bucket and the constraint bucket are mechanically
disjoint at this fixture.

---

## 14. Representative Examples

Selected from the 28-row constraint sample. All rows are `isStructuralSummary
= false`, `hasChildren = false`.

### 14.1 ASAP leaves (representative of 2446 rows)

| Source ID | Name | Constraint | Pred / Succ | Lag | Slot ES / EF | Temp ES / EF | Start Δ | Finish Δ |
| --- | --- | --- | :---: | :---: | --- | --- | ---: | ---: |
| GG4273 | EYD Foundations Start | ASAP | 1 / 0 | no | 738 / 739 | 741 / 742 | +3 | +3 |
| GG7310 | Complete Cladding Erection | ASAP | 3 / 0 | no | 871 / 872 | 874 / 875 | +3 | +3 |
| CON-017752 | First Concrete | ASAP | 1 / 1 | no | 598 / 599 | 601 / 602 | +3 | +3 |
| CON-012539 | PUF Mobilisation Start | ASAP | 1 / 1 | no | 465 / 466 | 468 / 469 | +3 | +3 |
| GG4873 | Brooklyn Installation Complete | ASAP | 17 / 1 | no | 1032 / 1035 | 1035 / 1036 | +3 | +1 |
| GG3950 | Early Server Floor Access — DCH1 T1 | ASAP | 12 / 11 | **yes** | 1025 / 1026 | 1028 / 1029 | +3 | +3 |

These rows have NO scheduling constraint to interpret. They CANNOT be
diverging due to constraint semantics.

### 14.2 ALAP leaves (representative of 112 rows)

| Source ID | Name | Constraint | Pred / Succ | Lag | Slot ES / EF | Temp ES / EF | Start Δ | Finish Δ |
| --- | --- | --- | :---: | :---: | --- | --- | ---: | ---: |
| PIN-015152 | Interim Water On | ALAP | 0 / 3 | no | 1126 / 1127 | 1127 / 1128 | +1 | +1 |
| ZZ1507 | Permanent Power Need by Date | ALAP | 2 / 2 | no | 1099 / 1100 | 1100 / 1101 | +1 | +1 |
| ZZ1760 | Priority Structured Fiber — T2 | ALAP | 2 / 4 | **yes** | 1436 / 1437 | 1437 / 1438 | +1 | +1 |
| ZZ2700 | Priority Structured Fiber — T3 | ALAP | 2 / 4 | **yes** | 1436 / 1437 | 1437 / 1438 | +1 | +1 |
| ZZ3700 | Priority Structured Fiber — T4 | ALAP | 2 / 4 | **yes** | 1436 / 1437 | 1437 / 1438 | +1 | +1 |

Same magnitude (+1) as ASAP rows. If ALAP were causing extra divergence,
magnitudes would differ from ASAP.

### 14.3 MSO leaves (all 3 rows)

| Source ID | Name | Constraint | Constraint date (min) | Slot ES / EF | Temp ES / EF | Start Δ | Finish Δ |
| --- | --- | --- | ---: | --- | --- | ---: | ---: |
| CON-019108 | Mobilization for PUF and Core and Shell Works | MSO | 223200 | 465 / 504 | 468 / 505 | +3 | +1 |
| CON-013008 | Mobilization for Mass Grading Works | MSO | 177120 | 370 / 407 | 371 / 408 | +1 | +1 |
| CON-011521 | Perun Substation Mobilization | MSO | 235680 | 491 / 528 | 492 / 529 | +1 | +1 |

MSO is the only constraint that *could* mechanically anchor a start date, and
even here the variance magnitude is +1 to +3 min — same as ASAP/ALAP. MSO
constraint dates (177120, 223200, 235680 min from project start) are large
positive values; if the temporal engine were misinterpreting the constraint,
the variance would be far larger than 3 min.

---

## 15. Alternative Explanations Tested

| # | Hypothesis | Status | Reasoning |
| ---: | --- | --- | --- |
| H1 | True constraint-semantics divergence | **Refuted** | 95.5% of bucket rows are ASAP (no-op default). Non-ASAP rows show identical variance shape to ASAP rows. No constraint-type-specific variance signature observed. |
| H2 | Slot-vs-temporal calendar-binding asymmetry | **Strongly supported (likely)** | Code asymmetry confirmed ([temporalRequestBuilder.ts:170](../../packages/worker/src/temporal/temporalRequestBuilder.ts#L168-L170) vs [MinuteEngineAdapter.ts:62](../../packages/worker/src/schedule/MinuteEngineAdapter.ts#L62)). Bucket size matches `tasks_with_assignedCalendarId`. Variance direction (temporal > slot) consistent with temporal engine assuming project calendar where slot used per-task calendar. Cannot be proven this milestone without forbidden Rust/WASM telemetry. |
| H3 | Calendar boundary / working-time difference | **Possible (likely)** | Per-task calendars 10288/10285/6693/7701 are known to have different working-day boundaries vs project default. The 1–3 min offsets are consistent with minute-precision day-boundary effects. Cannot be separated from H2 without calendar-compilation telemetry. |
| H4 | Relationship lag effects | **Refuted** | 25% of sample has non-zero lag but variance magnitudes are unchanged from zero-lag rows. ALAP rows with lag and zero lag both show +1/+1 pattern. |
| H5 | Milestone / zero-duration behaviour | **Refuted (for leaves)** | Sample includes 480-min-duration leaves with the same variance as zero-duration milestones; no special pattern. (Summary rollup is a different story — §13.) |
| H6 | Activity status (actual start/finish/remaining duration) | **Not observable** | Actual-date fields not present in browser-visible Task projection; would require worker-side capture. Carried forward as unresolved (§19). |
| H7 | Date rounding / minute-boundary effect | **Possible (likely)** | All variances are integer minutes 1–3. Highly compatible with rounding/boundary effect at calendar-day or shift boundary. Cannot separate from H2/H3 without engine-level telemetry. |
| H8 | Timezone / UTC offset drift | **Not observed** | All values are minute-offsets from project start; no UTC dates pass through the candidate projection compare. No evidence of TZ drift. |
| H9 | Slot-vs-temporal ordering / tie-break differences | **Not observed (likely refuted)** | Total-float variance is 0 for 98.6% of rows, critical-flag variance is 0% on leaves. Ordering or tie-break differences would scatter variances across both directions; the observed pattern is unidirectional (temporal > slot by 1–3 min). |
| H10 | Float-precision / FFI truncation | **Not observed** | All variances are integer minutes; no fractional-minute residuals beyond the 1.002-min total-float outlier. |
| H11 | Constraint-date timezone conversion | **Refuted** | MSO constraint dates are minute offsets, not timestamps. The 3 MSO rows show +1 to +3 min variance — same as non-MSO rows. |
| H12 | Imported activity status differences | **Not observable** | Same as H6. |
| H13 | Constraint priority / order differences | **Refuted** | Only one task type with a real constraint date (MSO). Other rows have no constraint date. Priority cannot apply. |
| H14 | P6 constraint exceptions (e.g. MFO on non-working time) | **N/A** | No MFO, no FNLT, no SNET in fixture. |
| H15 | Adapter fallback defaults for malformed constraints | **Refuted (code)** | [xerMapper.ts:257-282](../../packages/worker/src/import/mappers/xerMapper.ts#L257-L282) explicitly handles unknown types via diagnostics. No such diagnostic was reported in B2.12A.1 captures. |

---

## 16. Root Cause Hypotheses

In descending order of evidence support:

1. **Slot-vs-temporal calendar-binding asymmetry (H2) — likely.** Confirmed
   in code. Bucket size exactly matches `tasks_with_assignedCalendarId`.
   Variance direction (temporal > slot by 1–3 min) is consistent with the
   slot path using per-task working-time calendars and the temporal path
   substituting the project calendar.
2. **Calendar boundary / minute-precision effects on the project calendar
   timeline (H3 + H7) — likely.** The +1 to +3 min uniform offsets are
   characteristic of working-time-day or shift-boundary rounding.
   Indistinguishable from H2 with the evidence available.
3. **Classifier over-firing (independent of H2/H3) — proven.** The
   `hasConstraint` hint at
   [`UnexplainedDivergenceBuckets.ts`](../../packages/worker/src/schedule/UnexplainedDivergenceBuckets.ts)
   treats `constraintType = "ASAP"` as a constraint, so it routes 2446 ASAP
   leaves into `constraint_semantics_candidate` regardless of whether
   constraint semantics is the actual mechanism. This explains why the bucket
   label is misleading **without** disproving an underlying mechanism — H2/H3
   are the underlying mechanism candidates.

The constraint-semantics hypothesis (H1) is **not supported by evidence** and
should be retired as a root-cause candidate until and unless the classifier is
refined and the bucket reclassifies under more selective hints.

---

## 17. What Is Proven

- The `constraint_semantics_candidate` bucket contains 2446 ASAP leaves (P6
  no-op default), 112 ALAP leaves, and 3 MSO leaves (per B2.12A.3 baseline
  / Phase-2 live constraint-type breakdown; slight session-level row drift).
- ASAP, ALAP, and MSO leaves all show the same +1 to +3 minute variance
  shape. There is no constraint-type-specific divergence signature.
- The temporal candidate path passes `calendar_id = projectCalendar.id` for
  every task; the slot path passes `task.assignedCalendarId ?? projectCalendar`.
  This is a code-level fact in
  [temporalRequestBuilder.ts:168-170](../../packages/worker/src/temporal/temporalRequestBuilder.ts#L168-L170)
  vs
  [MinuteEngineAdapter.ts:62](../../packages/worker/src/schedule/MinuteEngineAdapter.ts#L62).
- The classifier's `hasConstraint` hint fires for any non-null
  `constraintType`. Since `state.ts` defaults loaded tasks to
  `constraintType = "ASAP"` (line 762), every imported task triggers the
  constraint branch unless a higher-priority branch (summary) pre-empts it.
- The variance is unidirectional (temporal > slot) — not a random tie-break
  scatter.
- The summary bucket (492) and the constraint bucket (2569) are mechanically
  disjoint at this fixture (no leakage observed in §13).
- AI003 remains blocked. No engine output, classifier, gate, tolerance,
  authority, persistence, UAT, or production state changed.

---

## 18. What Is Likely

- The 2569 leaf variances are most likely caused by **slot-vs-temporal
  calendar-binding asymmetry** (H2), possibly compounded by **minute-precision
  working-time boundary effects** (H3 / H7). The two are not separable
  without engine-level telemetry.
- The `constraint_semantics_candidate` classifier label is most likely an
  **over-firing artefact** of the `hasConstraint` hint.
- Refining the hint to exclude `"ASAP"` with null `constraintDateMinutes`
  would likely reclassify ~2446 of the 2569 rows into
  `calendar_boundary_candidate` (after the calendar-binding hint is
  similarly refined to take slot-vs-temporal asymmetry into account).

---

## 19. What Is Not Proven

- The exact mechanism producing the +1 to +3 minute offsets at the WASM
  / kernel boundary. WASM-received constraint payload, WASM-received calendar
  binding, and kernel-internal minute rounding **were not directly observable
  in B2.12A.4 without forbidden Rust / WASM instrumentation**.
- Whether activity status (actual start, actual finish, remaining duration)
  influences the divergence — these fields are not present in the
  browser-visible Task projection.
- Per-calendar variance distribution (10288 vs 10285 vs 6693 vs 7701) at the
  per-task level — could not be reproduced from the browser session this
  milestone because `__diagnosticState.tasks` does not carry
  `assignedCalendarId`. The B2.12A.2 captures provide proxy evidence at the
  count-of-tasks level only.
- Whether reclassifying the bucket (after a future classifier refinement)
  would leave any tasks genuinely in a "constraint semantics" bucket — must
  be re-measured after the proposed classifier refinement.

---

## 20. Safety Confirmation

- AI003 remains blocked. ✅
- No schedule output changed. ✅
- No classifier code changed. ✅
- No gate logic changed. ✅
- No tolerance threshold changed. ✅
- No authority apply executed (`authorityApplied = false`). ✅
- No rollback executed. ✅
- No persistence enabled (`persistenceApplied = false`). ✅
- No UAT / production toggle changed. ✅
- No `unsupportedFeatureFlags` activated. ✅
- No scheduling fix implemented. ✅
- No protocol contract changed. ✅
- No Rust kernel changed. ✅
- No React UI source modified. ✅
- No diagnostic code committed (browser snippets are transient). ✅
- No tests added or modified. ✅

---

## 21. Recommended Next Milestone

**Proposed milestone: W5B-B2.12A.5 — AI003 Diagnostic Classifier Refinement
(hasConstraint + calendar-binding hint).**

Scope (diagnostic-only, single small worker-side change to
`UnexplainedDivergenceBuckets.ts`):

1. Refine `hasConstraint` hint to fire only when
   `constraintType` is non-null **and** not `"ASAP"`. ASAP with null
   `constraintDateMinutes` is the P6 no-op default and must not be treated
   as a real scheduling constraint.
2. Add a `slotVsTemporalCalendarBindingDiffers` hint that is true when
   `task.assignedCalendarId` is set and differs from the project calendar.
   When true, prefer `calendar_boundary_candidate` over the (post-refinement)
   constraint branch.
3. Add bucket-distribution test coverage so future drift is detected.

Optional follow-on milestone **W5B-B2.12A.6 — Slot-vs-Temporal Minute-Boundary
Diagnostic Telemetry** would instrument the temporal request builder to log
the slot-vs-temporal calendar binding mismatch counts and the per-row minute
delta. This requires opt-in DEV-only telemetry; AI003 still remains blocked.

**Out of scope for any of the above:**

- AI003 must remain blocked until the underlying minute-boundary offset is
  understood and remediated, OR the divergence tolerance is formally adjusted
  via a gate-review milestone (not via this audit chain).
- No engine code, no protocol contract, no Rust kernel, no WASM bindings, no
  React UI source, no persistence enablement, no UAT / production toggle.

---

## Appendix A — Files Inspected (Phase 1 + Phase 2)

- [`packages/worker/src/schedule/UnexplainedDivergenceBuckets.ts`](../../packages/worker/src/schedule/UnexplainedDivergenceBuckets.ts) — classifier (read-only).
- [`packages/worker/src/schedule/TemporalCandidateComparator.ts`](../../packages/worker/src/schedule/TemporalCandidateComparator.ts) — variance computation (read-only).
- [`packages/worker/src/temporal/temporalRequestBuilder.ts`](../../packages/worker/src/temporal/temporalRequestBuilder.ts) — temporal payload translator (read-only).
- [`packages/worker/src/schedule/MinuteEngineAdapter.ts`](../../packages/worker/src/schedule/MinuteEngineAdapter.ts) — slot payload translator (read-only).
- [`packages/worker/src/import/mappers/xerMapper.ts`](../../packages/worker/src/import/mappers/xerMapper.ts) — constraint normalization (read-only).
- [`packages/worker/src/state.ts`](../../packages/worker/src/state.ts) — persistence-load default `constraintType = "ASAP"` (read-only).
- [`apps/web/src/App.tsx`](../../apps/web/src/App.tsx) — confirmed `__diagnosticState` projection excludes `assignedCalendarId` (read-only).
- [`apps/web/src/utils/workerDevHooks.ts`](../../apps/web/src/utils/workerDevHooks.ts) — confirmed dev hook signature and override forwarding (read-only).
- [`packages/worker/src/schedule/TemporalCandidateProjectionGate.ts`](../../packages/worker/src/schedule/TemporalCandidateProjectionGate.ts) — confirmed gate requires `temporalCandidateProjectionEnabled` + non-`off` `rolloutRing` (read-only).

## Appendix B — Validation Commands Run

```bash
git status --short
git diff --stat
```

No test suites run (Phase 2 modifies only this audit document; no code paths
exercised).

## Appendix C — Files Changed in This Milestone

- **Added:** `docs/milestones/W5B-B2.12A.4-AI003-constraint-semantics-divergence-audit.md` (this file).
- **Modified:** none.
- **Deleted:** none.

## Appendix D — Sample Budget Accounting

- Constraint sample: 28 rows (cap 50). ✅ Under cap.
- Summary control: 10 rows (cap 10). ✅ At cap.
- Calendar-stratified sample: 0 rows (could not be sampled — §6/§10
  limitation). Budget not exceeded.
- **Total deep-inspected rows: 38 / 80.** ✅ Within budget.

## Appendix E — Unresolved Questions

1. What is the per-minute, per-task source of the +1 to +3 minute offsets at
   the WASM boundary? Not observable from browser-side dev hooks.
2. Does the offset disappear when the temporal request builder is changed to
   pass `task.assignedCalendarId` (parity with slot)? Not testable in this
   audit milestone — requires code change.
3. Of the 2569 leaves, what is the per-calendar variance distribution? Not
   observable from browser-side dev hooks without forbidden modification to
   `App.tsx`.
4. Are there any genuine constraint-semantics rows hidden inside the 2569
   bucket that would survive a refined classifier? Cannot be answered until
   classifier refinement is shipped and bucket counts are remeasured.
