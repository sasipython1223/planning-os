# W5B-B2.12A — AI003 Divergence Investigation (Diagnostic Buckets)

> **Scope:** Investigation-only. Read-only diagnostic classification of
> `unexplained_divergence` rows in the slot-vs-temporal candidate
> comparison. **No** behavioural change is shipped by this milestone.
>
> This note distinguishes three categories of statements:
> - **(Fact)** — verified in code or operator-captured evidence.
> - **(Hypothesis)** — heuristic produced by the new classifier; **NOT** a
>   confirmed root cause.
> - **(Future)** — engineering recommendation outside this milestone.

---

## 1. Background

W5B-B2.11D rerun against the AI003 (`apps/web/tests/fixtures/local/AI003.xer`)
fixture produced **49 unexplained divergences** between the slot-authoritative
schedule and the temporal candidate projection. Apply was correctly blocked at
`fallbackReason: "unexplained_divergence_over_threshold"` and the system
returned to the slot-authoritative state with `authorityApplied: false`.

This investigation adds **read-only diagnostic classification** ("buckets")
to the per-task comparison output so future operator captures can attribute
the 49 unexplained rows to suspected causes — **without** changing the count,
the gate, the fallback reason, or any schedule output.

---

## 2. Operator-Captured AI003 Evidence (Facts)

These are the only AI003 numbers that have been confirmed from the operator's
B2.11D rerun. The AI003 `.xer` fixture is `.gitignore`d and not loaded inside
the agent's working environment, so no per-task breakdown was produced here.

| Field | Value |
| --- | --- |
| `unexplainedDivergenceCount` | **49** |
| `maxAbsStartVarianceMinutes` | **973** |
| `maxAbsFinishVarianceMinutes` | **1251** |
| `unsupportedFeatureFlags` | `[]` |
| `sourceProtectionStatus` | `ok` |
| `persistenceApplied` | `false` |
| `authorityApplied` | `false` |
| `fallbackReason` | `unexplained_divergence_over_threshold` |
| Final State | slot-authoritative (restored) |

The two largest variances (973 / 1251 work-minutes) are **roughly 2.0 to 2.6
working days** assuming the standard 480-min/day calendar. This is consistent
with — but does not by itself prove — a calendar-boundary, lag, or constraint
effect on a small number of tasks.

---

## 3. What This Milestone Ships

### 3.1 Protocol (additive, optional)

- New union [`TemporalCandidateUnexplainedDivergenceBucket`](../../packages/protocol/src/types.ts#L1093) with the operator-required vocabulary:
  - `calendar_boundary_candidate`
  - `lag_semantics_candidate`
  - `constraint_semantics_candidate`
  - `relationship_chain_candidate`
  - `summary_or_wbs_rollup_candidate`
  - `missing_calendar_metadata_candidate`
  - `unknown_unclassified`
- New optional field
  [`TemporalCandidateTaskComparison.unexplainedDivergenceBucket`](../../packages/protocol/src/types.ts#L1110)
  — set **only** when `classification === "unexplained_divergence"`,
  otherwise omitted/null.

### 3.2 Worker classifier (read-only)

New module
[`packages/worker/src/schedule/UnexplainedDivergenceBuckets.ts`](../../packages/worker/src/schedule/UnexplainedDivergenceBuckets.ts)
exports:

- `classifyUnexplainedDivergenceBucket(hints, comparison)` — pure heuristic.
- `attachUnexplainedDivergenceBuckets({ taskComparisons, hintsByTaskId })`
  — returns a new array with buckets attached to unexplained rows;
  non-unexplained rows pass through unchanged.
- `summarizeUnexplainedDivergenceBuckets(taskComparisons)` — aggregates
  per-bucket counts for operator reporting.

### 3.3 Projection runner wiring

In
[`runTemporalCandidateProjectionExecution`](../../packages/worker/src/worker.ts#L1706)
the runner now, after the existing comparator call:

1. Identifies the set of `unexplained_divergence` task ids.
2. Reads (read-only) State for those tasks: `getTasks`, `getDependencies`,
   `getCalendars`, `getCalendarDefinitions`, `getCalendarId`, `isTaskSummary`.
3. Builds `UnexplainedDivergenceBucketHints` per unexplained task id.
4. Calls `attachUnexplainedDivergenceBuckets` and splices the enriched rows
   back into `slotVsTemporalComparison.summary.taskComparisons`.

No other field on `summary`, `diagnostics`, or the projection is touched.
No DIFF_STATE is emitted by this code path.

---

## 4. Classifier Priority Order (Facts about implementation)

Buckets are **mutually exclusive**; the first matching signal wins:

1. `summary_or_wbs_rollup_candidate` — `isSummary === true`.
2. `missing_calendar_metadata_candidate` — referenced calendar id has no
   loaded metadata in either `calendarDefinitions` or `calendars`.
3. `constraint_semantics_candidate` — `task.constraintType != null`.
4. `lag_semantics_candidate` — any incident dependency has
   `lagWorkMinutes !== 0`.
5. `calendar_boundary_candidate` — `max(|startΔ|, |finishΔ|, |floatΔ|)` is a
   positive integer multiple of 480 work-minutes (one standard working day).
6. `relationship_chain_candidate` — predecessor count ≥ 2 or successor
   count ≥ 2.
7. `unknown_unclassified` — default.

This priority is **conservative**: stronger structural signals (summary /
missing calendar / explicit constraint) outrank weaker numeric signals
(boundary multiples / chain depth).

---

## 5. Invariants Preserved (Facts, asserted by tests)

The new tests in
[`w5b-b2-12a-unexplained-divergence-buckets.test.ts`](../../packages/worker/tests/schedule/w5b-b2-12a-unexplained-divergence-buckets.test.ts)
plus the unchanged full suite assert that:

- `unexplainedDivergenceCount` is unchanged by bucket attachment.
- Row `classification` values are unchanged.
- `maxAbsStartVarianceMinutes`, `maxAbsFinishVarianceMinutes`,
  `maxAbsTotalFloatVarianceMinutes`, and `identicalTaskCount` are unchanged.
- `unexplainedDivergenceBucket` is **never** set on a non-unexplained row.
- Priority order is deterministic (one assertion per bucket in priority
  order with all lower-priority signals also set).
- When no hints are supplied for an unexplained task, the bucket defaults
  to `unknown_unclassified` rather than throwing or omitting.

The full worker suite (1268 / 65), web suite (505 / 40), and wasm-browser
suite (1 / 1) all pass post-change. Protocol/worker/web typechecks are clean.
The cutover-gate (`unexplained_divergence_over_threshold`) and apply-stub
tests (`w5b-b2-5a-cutover-gate.test.ts`, `w5b-b2-5c-authority-apply-stub.test.ts`)
continue to assert blocking behaviour — diagnostic buckets do not weaken them.

---

## 6. AI003-Specific Bucket Distribution (Hypothesis / pending operator capture)

> **Update (W5B-B2.12A.1, 2026-05-12):** An operator rerun on this build
> against `apps/web/tests/fixtures/local/AI003.xer` was completed via the
> page-console path. The actual bucket distribution and confirmed
> numbers are recorded in
> [W5B-B2.12A.1 — AI003 Bucketed Divergence Evidence Capture](W5B-B2.12A.1-AI003-bucketed-evidence.md).
> The rerun reports `unexplainedDivergenceCount = 3061` (not 49) and
> shows the distribution is dominated by
> `missing_calendar_metadata_candidate` (2569) and
> `summary_or_wbs_rollup_candidate` (485). The §2 operator numbers from
> B2.11D are preserved below as historical context; see B2.12A.1 §9 for
> the recommended reconciliation work.

> **The agent does not have access to the AI003 fixture and therefore did
> not produce a per-task bucket table for AI003 in this milestone.**

The next operator rerun against AI003, with this build, will produce
per-task `unexplainedDivergenceBucket` values inside the
`TemporalCandidateProjection.comparison.taskComparisons` payload. Operators
can then capture the distribution and replace this section.

A template for the operator capture is:

| Bucket | Count (of 49) |
| --- | --- |
| `summary_or_wbs_rollup_candidate` | _pending_ |
| `missing_calendar_metadata_candidate` | _pending_ |
| `constraint_semantics_candidate` | _pending_ |
| `lag_semantics_candidate` | _pending_ |
| `calendar_boundary_candidate` | _pending_ |
| `relationship_chain_candidate` | _pending_ |
| `unknown_unclassified` | _pending_ |

### Largest-variance candidates (operator capture template)

For each of the top divergent rows (sorted by
`max(|startΔ|, |finishΔ|)`) operators should record:

- `taskId`, `sourceActivityId`, `name`
- `summary/WBS/leaf` flag
- slot start/finish/totalFloat
- temporal start/finish/totalFloat
- start/finish/totalFloat variance minutes
- predecessor / successor counts
- relationship types and lag values
- calendar id and metadata-loaded flag
- constraint type and date (if any)
- near-calendar-boundary flag (heuristic)
- assigned `unexplainedDivergenceBucket`

---

## 7. Plausible AI003 Root Causes (Hypotheses, NOT fixes)

These are **plausibility statements** to direct the next operator capture —
not claims about AI003 specifically:

- The 973 / 1251-minute maxima (~2.0–2.6 working days) are consistent with
  a small number of leaf rows being shifted across a calendar non-working
  interval. If `calendar_boundary_candidate` dominates the AI003
  distribution, this is the lead suspect.
- `lag_semantics_candidate` would suggest that XER lag interpretation
  (calendar mode of lag) differs between the slot and temporal engines for
  a subset of dependencies.
- `constraint_semantics_candidate` would suggest a P6 constraint family
  (`MSO`, `SNET`, `FNLT`, …) is being honoured differently between engines.
- `summary_or_wbs_rollup_candidate` should be near-zero by construction —
  the comparator already reclassifies summary critical-flag-only
  divergences out of `unexplainedDivergenceCount`
  ([B2.6.2B reclassification](../../packages/protocol/src/types.ts#L1075)).
  A non-zero count here would indicate a non-critical-only summary
  divergence and warrants investigation of the summary candidate-mapping
  path.
- `relationship_chain_candidate` is the weakest signal — it should be the
  last bucket considered, and a non-trivial AI003 count here mostly
  indicates that the primary cause sits earlier in the chain (the
  classifier returned `relationship_chain_candidate` only because no
  stronger signal matched on the divergent row itself).

**None of these are confirmed for AI003.** The bucket distribution from the
next operator rerun is required before any of these becomes evidence-grade.

---

## 8. Out of Scope (Verbatim from milestone brief)

- **Not changed:** gate decision logic, divergence tolerance, schedule
  outputs, apply path, rollback path, dogfood authority guard,
  `unsupportedFeatureFlags`, `fallbackReason`, `authorityApplied`,
  `sourceProtectionStatus`, persistence, DIFF_STATE emission.
- **Not attempted:** making AI003 pass the cutover gate. AI003 remains
  correctly blocked at `unexplained_divergence_over_threshold`.

---

## 9. Future Engineering Recommendations

1. Operator rerun against AI003 with this build to populate §6.
2. If `calendar_boundary_candidate` dominates: targeted comparison of
   slot vs temporal calendar-non-working-interval handling on AI003's
   project calendar.
3. If `lag_semantics_candidate` dominates: extend the comparator to
   classify per-lag-calendar-mode and capture which dependency rows
   contribute to each divergent task's variance.
4. If `unknown_unclassified` dominates: extend hints with additional
   structural signals (resource calendars, suspended-task flag, retained
   logic / progress override) before drawing conclusions.
5. None of the above warrants a gate-tolerance change. The investigation
   path is to attribute, not to relax.

---

## 10. Validation Matrix (this milestone)

| Suite | Result |
| --- | --- |
| `pnpm -C packages/protocol exec tsc -b` | clean |
| `pnpm -C packages/worker exec tsc --noEmit` | clean |
| `pnpm -C apps/web exec tsc -b` | clean |
| `pnpm -C packages/worker exec vitest run` | **1268 / 65** (was 1256 / 64; +12 / +1) |
| `pnpm -C apps/web exec vitest run` | **505 / 40** unchanged |
| `pnpm -C apps/web test:wasm-browser` | **1 / 1** unchanged |
| Cutover-gate / apply-stub tests | unchanged, still block on AI003-class divergence |

---

## 11. Files Touched

- [`packages/protocol/src/types.ts`](../../packages/protocol/src/types.ts) — added union and optional field.
- [`packages/protocol/src/index.ts`](../../packages/protocol/src/index.ts) — re-exported new union.
- [`packages/worker/src/schedule/UnexplainedDivergenceBuckets.ts`](../../packages/worker/src/schedule/UnexplainedDivergenceBuckets.ts) — new module.
- [`packages/worker/src/worker.ts`](../../packages/worker/src/worker.ts) — wired classifier into `runTemporalCandidateProjectionExecution` after the comparator call.
- [`packages/worker/tests/schedule/w5b-b2-12a-unexplained-divergence-buckets.test.ts`](../../packages/worker/tests/schedule/w5b-b2-12a-unexplained-divergence-buckets.test.ts) — new test file.
- [`docs/milestones/W5B-B2.12A-AI003-divergence-investigation.md`](W5B-B2.12A-AI003-divergence-investigation.md) — this note.

---

## 12. Confirmed-vs-Hypothesis Summary

**Confirmed facts:**

- Protocol/worker/web typechecks clean.
- Worker suite +12 / +1 file; all pre-existing tests still green.
- AI003 still blocked at `unexplained_divergence_over_threshold` (no gate
  change shipped).
- Buckets are not emitted on non-unexplained rows; counts and
  classifications unchanged.
- Operator-captured AI003 evidence (49 / 973 / 1251 / `[]` / `ok` / false)
  from the prior B2.11D rerun.

**Hypotheses requiring operator capture:**

- The actual AI003 bucket distribution. **→ Now captured in
  [W5B-B2.12A.1](W5B-B2.12A.1-AI003-bucketed-evidence.md).**
- Which of `calendar_boundary` / `lag_semantics` / `constraint_semantics`
  best explains the 973–1251-minute maxima.
- Whether any AI003 unexplained rows fall into
  `missing_calendar_metadata_candidate` (would indicate a metadata-load
  bug, not a scheduling-semantics divergence).

**Not attempted in this milestone:**

- Per-task variance tables for AI003 (the fixture is not available to the
  agent; the captured rerun is the source of truth).
- Any change to gate decisions, tolerance, fallback reason, or schedule
  outputs.

---

## 13. Honesty Statement

Bucket assignments produced by `classifyUnexplainedDivergenceBucket` are
**heuristics**. A row in `lag_semantics_candidate` does not prove that
lag is the cause of its divergence — only that the row has at least one
non-zero-lag incident dependency and no higher-priority signal. Operator
follow-up (slot-vs-temporal engine logs, per-task calendar inspection,
or targeted unit tests) is required to convert any bucket from hypothesis
to confirmed root cause.
