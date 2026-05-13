# W5B-B2.12A.5 — AI003 Diagnostic Classifier Refinement: ASAP + Calendar-Binding Hints

**Status**: Shipped (diagnostic-only).
**Predecessor**: W5B-B2.12A.4 (Constraint-Semantics Divergence Audit).
**Scope**: Read-only diagnostic bucket classifier refinement. No scheduling
behaviour change. No engine change. No protocol change. No UI change. No
authority / gate / tolerance / persistence change. AI003 remains blocked at
the live cutover gate.

---

## 1. Executive Summary

B2.12A.4 produced a forensic audit of the `constraint_semantics_candidate`
bucket on the AI003 corpus. Two findings drove this milestone:

1. **P6 stamps `ASAP` as a no-op default on virtually every activity.**
   The previous classifier treated *any* non-null `constraintType` as a real
   constraint, so 2,569 of 3,061 unexplained rows (~84%) bucketed as
   `constraint_semantics_candidate` — a label that obscured the real signal.
2. **Slot-vs-temporal divergence at task level is dominated by inputs
   delivered to the temporal request (calendar binding among them), not by
   P6 constraints.**

This milestone refines the classifier with two new O(1) per-task hints:

- **`hasMeaningfulConstraint`** — `constraintType` is non-null AND either
  `constraintType !== "ASAP"` OR `constraintDateMinutes != null`. The no-op
  ASAP default no longer fires `constraint_semantics_candidate`.
- **`slotVsTemporalCalendarBindingDiffers`** — immediate-task check that
  `task.assignedCalendarId` differs from the project / temporal calendar id.
  Does **not** traverse WBS hierarchy. Does **not** resolve inherited
  calendars. Pure read of the immediate task.

The classifier’s priority order is also adjusted so `calendar_boundary_candidate`
precedes `lag_semantics_candidate` (the brief’s priority order).

**Result on live AI003 (3,063 tasks, 3,053 unexplained):**

| Bucket                                    | Before (B2.12A.4) | After (B2.12A.5) | Δ        |
| ----------------------------------------- | ----------------- | ---------------- | -------- |
| `summary_or_wbs_rollup_candidate`         | 492               | **492**          | 0        |
| `constraint_semantics_candidate`          | ~2,569            | **122**          | **−2,447** |
| `calendar_boundary_candidate`             | 0                 | **0**            | 0        |
| `lag_semantics_candidate`                 | 0 *(masked)*      | **740**          | +740     |
| `relationship_chain_candidate`            | 0 *(masked)*      | **1,167**        | +1,167   |
| `unknown_unclassified`                    | 0 *(masked)*      | **532**          | +532     |
| **Sum**                                   | 3,061             | **3,053**        | matches `unexplainedDivergenceCount` |

`unexplainedDivergenceCount`, `identicalTaskCount`, `expectedSummaryCriticalRollupDivergenceCount`,
`fallbackReason`, `unsupportedFeatureFlags`, gate decision, and
`authorityApplied` are **unchanged** by this milestone.

---

## 2. Decision Ledger

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Add `hasMeaningfulConstraint` hint that requires non-ASAP type OR non-null `constraintDateMinutes`. | B2.12A.4 §3: ASAP+null is P6's no-op default; treating it as a constraint over-fires the constraint bucket. |
| 2 | Keep legacy `hasConstraint` hint and fall back to it when `hasMeaningfulConstraint` is `undefined`. | Backward compatibility for callers/tests that have not migrated. |
| 3 | Add `slotVsTemporalCalendarBindingDiffers` hint (O(1) immediate-task check). | B2.12A.4 hypothesis: calendar binding is one input that differs between slot and temporal paths. Cheap to detect; surfaces real candidates without WBS traversal. |
| 4 | Reorder priority: calendar_boundary now precedes lag_semantics. | Brief's documented priority order. Variance signal that looks like a working-time boundary effect should outrank a relationship-property signal. |
| 5 | Calendar_boundary fires on `slotVsTemporalCalendarBindingDiffers === true` OR legacy workday-multiple variance. | Preserves existing variance-magnitude heuristic; layers in the new binding-aware signal. |
| 6 | No WBS hierarchy traversal, no inherited-calendar resolution, no per-task payload beyond two booleans. | Brief's explicit safety constraint: keep classifier O(1) per task. |
| 7 | No change to `worker.ts` plumbing required (existing `task` pass-through already carries `constraintDateMinutes` and `assignedCalendarId`). | Minimises blast radius. |

---

## 3. Scope Confirmation

**In-scope (touched):**

- `packages/worker/src/schedule/UnexplainedDivergenceBuckets.ts` — classifier + hint builder.
- `packages/worker/tests/schedule/w5b-b2-12a-unexplained-divergence-buckets.test.ts` — tests added/updated.
- `docs/milestones/W5B-B2.12A.5-AI003-diagnostic-classifier-refinement.md` — this audit.

**Untouched (verified by `git status --short`):**

- Rust kernel (`packages/cpm-kernel`).
- WASM bindings (`packages/cpm-wasm`).
- Protocol (`packages/protocol`).
- Temporal request builder (`packages/worker/src/temporal/temporalRequestBuilder.ts`).
- Persistence / `State` / authority / `apply` / rollback paths.
- React UI (`apps/web`).
- Production / rollout flags / cutover gate.

---

## 4. B2.12A.4 Findings Carried Forward

B2.12A.4 established (on the live AI003 corpus, 3,063 tasks, 3,053 unexplained):

- **Leaf composition of unexplained rows by `constraintType`:**
  - `ASAP`: 2,446
  - `ALAP`: 112
  - `MSO`: 3
  - (other / null): 0 leaves
- **Summary unexplained rows**: 492, all `ASAP` (carried forward unchanged).
- **Variance distribution**: 1–3 minute uniform variance across constraint
  types, indicating the variance is not driven by constraint semantics.
- **Hypothesis**: classifier over-fires on the ASAP default; the real signal
  is shifted to inputs delivered to the temporal request (calendar binding,
  WBS rollup behaviour, dependency lag handling). B2.12A.5 addresses the
  classifier; scheduling-side investigation is deferred.

---

## 5. Gemini Architecture Review Carried Forward

B2.12A.4 captured a Gemini review of the comparator pipeline. Key items
carried forward into B2.12A.5:

1. **Diagnostic refinement is the correct next step.** Scheduling-side
   fixes (calendar inheritance, ASAP semantics in the temporal solver)
   should not be attempted until the diagnostic surface is trustworthy.
2. **Keep the classifier pure and O(1).** No per-task hierarchy traversal,
   no inherited-calendar resolution. Two booleans per task is sufficient.
3. **Calendar_boundary vs lag_semantics priority.** Boundary-shaped
   variances (whole working days, or calendar-binding mismatches) should
   outrank lag because lag is a property of the relationship, not a per-
   task semantic divergence. B2.12A.5 reorders the priority accordingly.

---

## 6. Classifier Refinement Summary

### 6.1 Hint type extension

`UnexplainedDivergenceBucketHints` adds two optional fields:

```ts
export type UnexplainedDivergenceBucketHints = {
  isSummary: boolean;
  hasMissingCalendarMetadata: boolean;
  hasConstraint: boolean;                       // legacy, retained
  hasMeaningfulConstraint?: boolean;            // NEW — B2.12A.5
  slotVsTemporalCalendarBindingDiffers?: boolean; // NEW — B2.12A.5
  hasNonZeroLag: boolean;
  predecessorCount: number;
  successorCount: number;
};
```

### 6.2 Hint builder additions

`BuildTaskBucketHintsInput.task` gains `constraintDateMinutes?: number | null`.
`buildTaskBucketHints` computes:

```ts
const hasMeaningfulConstraint =
  constraintType != null
  && (constraintType !== "ASAP" || constraintDateMinutes != null);

const slotVsTemporalCalendarBindingDiffers =
  assignedCalendarId != null
  && input.projectCalendarId != null
  && String(assignedCalendarId) !== String(input.projectCalendarId);
```

Both are O(1) reads of fields already present on the immediate task; no
hierarchy traversal, no registry lookup.

### 6.3 Classifier branch

```ts
const effectiveConstraintFires =
  hints.hasMeaningfulConstraint !== undefined
    ? hints.hasMeaningfulConstraint
    : hints.hasConstraint;
if (effectiveConstraintFires) return "constraint_semantics_candidate";

if (
  hints.slotVsTemporalCalendarBindingDiffers === true
  || looksLikeWorkdayMultiple(maxAbsVariance)
) return "calendar_boundary_candidate";

if (hints.hasNonZeroLag) return "lag_semantics_candidate";
// …
```

---

## 7. ASAP / Default Constraint Handling

P6 emits `ConstraintType="CS_ASAP"` on essentially every activity. This is
the planner's no-op stamp (“start as soon as possible” relative to logic),
not a user-asserted constraint. Treating it as a constraint:

- caused the `constraint_semantics_candidate` bucket to absorb 84% of all
  unexplained rows in AI003, regardless of actual semantic content;
- prevented operators from seeing the residual relationship-chain, lag, and
  unknown signals.

The refined rule:

| `constraintType` | `constraintDateMinutes` | `hasMeaningfulConstraint` |
|------------------|-------------------------|---------------------------|
| `null` / absent  | (any)                   | `false`                   |
| `"ASAP"`         | `null` / absent         | `false`                   |
| `"ASAP"`         | non-null                | `true`                    |
| `"MSO"` / `"SNET"` / `"FNLT"` / `"ALAP"` / `"MFO"` / any non-ASAP | (any) | `true` |

ASAP+null rows therefore fall through to subsequent buckets. They are not
silently reassigned to a more meaningful label — the classifier honestly
says “no semantic constraint here”.

---

## 8. Calendar-Binding Hint Handling

`slotVsTemporalCalendarBindingDiffers` is a strict O(1) check:

- `true` only when the immediate task's `assignedCalendarId` is non-null
  AND its string form differs from the project calendar id.
- `false` when `assignedCalendarId` is null/undefined (no per-task binding).
- `false` when the binding matches the project calendar id.
- Performs no WBS traversal. Performs no inherited-calendar resolution.
  These behaviours are explicitly deferred to a future milestone if needed.

When a row has a meaningful constraint AND a binding mismatch, constraint
wins (priority 3 before 4) — a meaningful constraint is a stronger semantic
signal than a working-time-boundary candidate.

---

## 9. Bucket Priority Order (W5B-B2.12A.5 refined)

Deterministic, first-match wins:

1. `summary_or_wbs_rollup_candidate`
2. `missing_calendar_metadata_candidate`
3. `constraint_semantics_candidate` *(via `hasMeaningfulConstraint`)*
4. `calendar_boundary_candidate` *(via `slotVsTemporalCalendarBindingDiffers` OR workday-multiple variance)*
5. `lag_semantics_candidate`
6. `relationship_chain_candidate`
7. `unknown_unclassified`

Changes vs B2.12A.3:

- (3) refined from `hasConstraint` to `hasMeaningfulConstraint` (falls back to legacy when undefined).
- (4) moved ahead of (5); previously `lag_semantics` preceded `calendar_boundary`.
- (4) additionally fires on the new binding-mismatch hint.

---

## 10. Tests Added / Updated

File: `packages/worker/tests/schedule/w5b-b2-12a-unexplained-divergence-buckets.test.ts`.

**Result**: 38 / 38 tests pass (22 prior + 16 added/adjusted for B2.12A.5).

### 10.1 Adjusted (1)

- `returns lag_semantics_candidate when non-zero lag and no higher-priority signal`
  — variance changed from `wm(480)` to `wm(17)` because B2.12A.5 reorders
  calendar_boundary ahead of lag (any workday-multiple variance would now
  bucket as calendar_boundary before lag).

### 10.2 Added (16) — under three new `describe` blocks

**`W5B-B2.12A.5 hint builder — hasMeaningfulConstraint`** (6):

- (c) ASAP + valid `constraintDateMinutes` ⇒ `constraint_semantics_candidate`.
- (e) MSO / SNET / FNLT / ALAP / MFO ⇒ `constraint_semantics_candidate`.
- (d) MFO + valid `constraintDateMinutes` + calendar mismatch ⇒ constraint wins.
- ASAP + null `constraintDateMinutes` ⇒ `hasMeaningfulConstraint=false`.
- ASAP + absent `constraintDateMinutes` ⇒ `hasMeaningfulConstraint=false`.
- null `constraintType` ⇒ `hasMeaningfulConstraint=false`.

**`W5B-B2.12A.5 hint builder — slotVsTemporalCalendarBindingDiffers`** (8):

- (a) ASAP + null date + mismatched calendar ⇒ `calendar_boundary_candidate`.
- (b) ASAP + absent date + mismatched calendar ⇒ `calendar_boundary_candidate`.
- `assignedCalendarId === projectCalendarId` ⇒ `false`.
- `assignedCalendarId === null` ⇒ `false`.
- (f) summary + ASAP-default + mismatch ⇒ summary wins.
- (g) missing calendar metadata + mismatch ⇒ missing wins.
- (h1) ASAP + null + no mismatch + relationship evidence ⇒ `relationship_chain_candidate`.
- (h2) ASAP + null + no mismatch + no relationship evidence ⇒ `unknown_unclassified`.

**`W5B-B2.12A.5 read-only invariants — relabelling never perturbs gate-relevant fields`** (2):

- (i) Relabelling three mixed rows (ASAP-default, ASAP-with-date, MSO)
  leaves `unexplainedDivergenceCount`, all `classification` values, and
  variance maxima unchanged. Buckets are reassigned as expected.
- (j) Bucket reassignment is only ever applied to rows whose
  `classification === "unexplained_divergence"`. Identical and expected-
  calendar-divergence rows retain a null bucket.

---

## 11. Corrected AI003 Bucket Distribution (Live Capture)

Live run via `window.__runTemporalCandidateProjection({ temporalCandidateProjectionEnabled: true, temporalAuthorityRolloutRing: "internal_test", runWasmGateFirst: true })`
after HMR reload of refined classifier:

```jsonc
{
  "comparedTaskCount": 3063,
  "identicalTaskCount": 8,
  "expectedCalendarDivergenceCount": 0,
  "unsupportedFeatureDivergenceCount": 0,
  "expectedSummaryCriticalRollupDivergenceCount": 2,
  "unexplainedDivergenceCount": 3053,
  "maxAbsStartVarianceMinutes": 972,
  "maxAbsFinishVarianceMinutes": 1248,
  "fallbackReason": null,
  "unsupportedFeatureFlags": null,
  "gateDecision": { "allowed": true, "blockedReason": null, "rolloutRingAllowed": true },
  "authorityApplied": false,
  "allClassifications": {
    "unexplained_divergence": 3053,
    "expected_summary_critical_rollup_divergence": 2,
    "no_difference": 8
  },
  "buckets": {
    "summary_or_wbs_rollup_candidate": 492,
    "constraint_semantics_candidate": 122,
    "lag_semantics_candidate": 740,
    "relationship_chain_candidate": 1167,
    "unknown_unclassified": 532
  }
}
```

Sum of buckets: 492 + 122 + 740 + 1167 + 532 = **3,053**, matching
`unexplainedDivergenceCount` exactly.

---

## 12. Comparison Against B2.12A.4

| Field                                              | B2.12A.4 | B2.12A.5 | Δ |
|----------------------------------------------------|---------:|---------:|--:|
| `comparedTaskCount`                                | 3,063    | 3,063    | 0 |
| `identicalTaskCount`                               | 8        | 8        | 0 |
| `unexplainedDivergenceCount`                       | 3,053    | 3,053    | 0 |
| `expectedSummaryCriticalRollupDivergenceCount`     | 2        | 2        | 0 |
| `fallbackReason`                                   | `null`   | `null`   | — |
| `unsupportedFeatureFlags`                          | `null`   | `null`   | — |
| Gate `allowed`                                     | `true`   | `true`   | — |
| `authorityApplied`                                 | `false`  | `false`  | — |
| `summary_or_wbs_rollup_candidate`                  | 492      | 492      | 0 |
| `constraint_semantics_candidate`                   | ~2,569   | 122      | **−2,447** |
| `calendar_boundary_candidate`                      | 0        | 0        | 0 |
| `lag_semantics_candidate`                          | 0        | 740      | +740 |
| `relationship_chain_candidate`                     | 0        | 1,167    | +1,167 |
| `unknown_unclassified`                             | 0        | 532      | +532 |

**Headline observations:**

- **The constraint over-fire is corrected.** Constraint bucket drops from
  ~84% to ~4% of unexplained rows. The 122 remaining constraint rows are
  the real non-ASAP constraints (and a small number of ASAP rows with
  explicit anchor dates).
- **Calendar binding is *not* the dominant signal in AI003.** Zero rows
  triggered the new `slotVsTemporalCalendarBindingDiffers` hint. This was
  a B2.12A.4 hypothesis worth testing; the answer for this specific
  corpus is "no". P6 did not assign per-task calendars on AI003 — the
  binding inheritance happens entirely above the immediate-task level.
  (A future milestone may explore inherited calendars; explicitly out of
  scope here.)
- **Relationship chain and lag are now visible.** Together they account
  for **1,907 / 3,053 ≈ 62.5%** of unexplained rows. Combined with the
  unaffected 492 summary rows, this is **2,399 / 3,053 ≈ 78.6%** of
  unexplained rows now classified into investigable signal types.
- **532 unknown rows remain.** Variance is non-zero, non-workday-multiple,
  no lag, no chain, no constraint, no calendar binding, not a summary.
  These are the genuine residual cases for follow-up.

---

## 13. Safety Confirmation

Compliance with brief invariants:

- [x] **No engine change** — Rust kernel + WASM untouched.
- [x] **No protocol change** — `packages/protocol` untouched.
- [x] **No UI change** — `apps/web` untouched.
- [x] **No persistence change** — `State`, persistence, authority untouched.
- [x] **No temporal request builder change** — `temporalRequestBuilder.ts` untouched.
- [x] **No WBS traversal in the classifier** — both new hints are O(1)
       immediate-task reads.
- [x] **No calendar inheritance resolution** — explicit out-of-scope deferral.
- [x] **No `unexplainedDivergenceCount` change** — verified live (3,053 ↔ 3,053).
- [x] **No `classification` change** — verified live (3,053 / 2 / 8 ↔ same).
- [x] **No `fallbackReason` change** — `null` ↔ `null`.
- [x] **No `unsupportedFeatureFlags` change** — `null` ↔ `null`.
- [x] **No gate change** — `allowed=true, rolloutRingAllowed=true` unchanged.
- [x] **No `authorityApplied` change** — `false` (diagnostic-only).
- [x] **AI003 remains blocked at the live cutover gate** — this milestone
       does not unblock; it only refines labels.
- [x] **Classifier remains pure** — reads only its inputs; mutates nothing.

Validation suite results (all clean):

| Command | Result |
|---------|--------|
| `pnpm -C packages/protocol exec tsc -b` | OK (no output) |
| `pnpm -C packages/worker exec tsc --noEmit` | OK |
| `pnpm -C packages/worker exec vitest run` | **1294 / 1294 pass** |
| `pnpm -C apps/web exec tsc -b` | OK |
| `pnpm -C apps/web exec vitest run` | **505 / 505 pass** |
| `pnpm -C apps/web test:wasm-browser` | **1 / 1 pass** |
| Live AI003 projection in browser | invariants preserved (§11) |

---

## 13.5 Count Reconciliation

**Question raised after first capture**: B2.12A.5 reports
`unexplainedDivergenceCount = 3053` with bucket sum 3053, but an earlier
B2.12A.3 baseline reported 3061. Is there an 8-row gap inside the
B2.12A.5 capture?

**Answer: No gap inside the B2.12A.5 capture. Outcome (A) per the brief —
`unexplainedDivergenceCount` is now 3053 and reconciles exactly to the
bucket sum.**

### 13.5.1 Independent recount (live AI003, B2.12A.5 classifier)

Captured via the same `window.__runTemporalCandidateProjection({
temporalCandidateProjectionEnabled: true, temporalAuthorityRolloutRing:
"internal_test", runWasmGateFirst: true })` call used in §11, then walked
`projection.comparison.taskComparisons` directly:

| Field | Value |
|-------|------:|
| `comparedTaskCount`                                | 3063 |
| `identicalTaskCount`                               | 8 |
| `unexplainedDivergenceCount` (reported by comparator) | **3053** |
| `expectedSummaryCriticalRollupDivergenceCount`     | 2 |
| `expectedCalendarDivergenceCount`                  | 0 |
| `unsupportedFeatureDivergenceCount`                | 0 |
| `maxAbsStartVarianceMinutes`                       | 972 |
| `maxAbsFinishVarianceMinutes`                      | 1248 |
| `maxAbsTotalFloatVarianceMinutes`                  | 1.0020833333333033 |
| `taskComparisons.length`                           | 3063 |
| `unsupportedFeatureFlags`                          | `null` |
| `fallbackReason`                                   | `null` |
| `gateDecision`                                     | `{ allowed: true, blockedReason: null, rolloutRingAllowed: true }` |
| `authorityApplied`                                 | `false` |
| `persistenceApplied`                               | (not present on result) |

Independent walk of `taskComparisons`:

| Independent count | Value |
|-------------------|------:|
| Rows with `classification === "unexplained_divergence"` | **3053** |
| ↳ with `unexplainedDivergenceBucket` present            | **3053** |
| ↳ with `unexplainedDivergenceBucket` missing / null     | **0** |
| Bucket sum (including any `(missing_bucket)`)           | **3053** |

Per-bucket distribution (independent walk; identical to §11):

```
summary_or_wbs_rollup_candidate : 492
constraint_semantics_candidate  : 122
lag_semantics_candidate         : 740
relationship_chain_candidate    : 1167
unknown_unclassified            : 532
calendar_boundary_candidate     :   0
(missing_bucket)                :   0
TOTAL                           : 3053
```

Classification totals: `unexplained_divergence=3053 +
expected_summary_critical_rollup_divergence=2 + no_difference=8 = 3063 =
comparedTaskCount`. **Fully self-consistent.**

### 13.5.2 Where the "3061" figure came from

The 3061 number originates from the **B2.12A.3** baseline capture, not
from B2.12A.4 or B2.12A.5. B2.12A.4 §5 (“Current Corrected Bucket
Baseline”) already documented the inter-session drift between B2.12A.3
and the Phase-2 live run that is reused in B2.12A.5:

| Metric | B2.12A.3 baseline | Phase-2 live (B2.12A.4 §5) | B2.12A.5 (this run) |
|--------|---:|---:|---:|
| Total / compared tasks                         | 3062 | 3063 | 3063 |
| `identicalTaskCount`                           | 0    | 8    | 8    |
| `expected_summary_critical_rollup_divergence`  | 1    | 2    | 2    |
| `unexplainedDivergenceCount`                   | 3061 | 3053 | 3053 |
| Max abs start variance (min)                   | 970  | 972  | 972  |
| Max abs finish variance (min)                  | 1250 | 1248 | 1248 |
| Max abs total-float variance (min)             | 1    | 1.002 | 1.0020833333333033 |

B2.12A.4 §5 verbatim: *“Live numbers drifted by ±8 rows in this session …
The two baselines are operationally equivalent for the purposes of this
audit.”* The drift is between the B2.12A.3 capture and the Phase-2 live
session that B2.12A.4 and B2.12A.5 both ran against — it is **not**
introduced by B2.12A.5.

The accounting between the two captures matches exactly:

```
3061 (old unexplained)
  −  8  (rows now classified as no_difference; identicalTaskCount 0 → 8)
  +  0  (no other delta)
  =  3053 (new unexplained)

3062 (old compared)
  +  1  (extra task in new corpus; comparedTaskCount 3062 → 3063)
  =  3063 (new compared)

3061 unexplained + 0 identical + 1 expected_summary_rollup = 3062  (B2.12A.3)
3053 unexplained + 8 identical + 2 expected_summary_rollup = 3063  (B2.12A.4 / B2.12A.5)
```

Both rows balance against their own `comparedTaskCount`.

### 13.5.3 Outcome (per brief enumeration)

- **(A) `unexplainedDivergenceCount` is now 3053** ✅
- (B) Not (B): the count is **not** still 3061 — it is 3053 in the live
      Phase-2 corpus, and that 3053 reconciles exactly to the bucket sum.
- (C) Not (C): the capture script reads the correct object path
      (`result.projection.comparison.taskComparisons`); the first capture
      tried `slotVsTemporalComparison.summary` (a name from prior milestones)
      and was corrected on the second attempt. The §11 numbers used the
      correct path. The independent recount above re-confirms.
- (D) Not (D): no other explanation needed.

### 13.5.4 Identifying the 8 “missing” rows

Strictly speaking there are no rows missing **from B2.12A.5's bucket sum**
— the sum is 3053 and the count is 3053 with zero (missing_bucket) rows.

The 8 rows people might expect to "find" are the eight rows whose
classification flipped from `unexplained_divergence` (B2.12A.3) to
`no_difference` (B2.12A.4 / B2.12A.5). They are out of scope for the
bucket classifier (buckets are only attached to `unexplained_divergence`
rows), but they are visible in the live capture as
`identicalTaskCount = 8` and `allClassifications.no_difference = 8`. By
definition their variance is zero on all measured axes, so they do not
need a bucket. They are not a B2.12A.5 regression; they were already
present in the B2.12A.4 live capture used as this milestone's input.

### 13.5.5 Gate-relevant invariants

Unchanged by B2.12A.5 vs the immediately preceding B2.12A.4 live capture:

| Field | Value | Changed by B2.12A.5? |
|-------|------|----------------------|
| `comparedTaskCount`                                | 3063 | no |
| `identicalTaskCount`                               | 8    | no |
| `unexplainedDivergenceCount`                       | 3053 | no |
| `expectedSummaryCriticalRollupDivergenceCount`     | 2    | no |
| `expectedCalendarDivergenceCount`                  | 0    | no |
| `unsupportedFeatureDivergenceCount`                | 0    | no |
| `maxAbsStartVarianceMinutes`                       | 972  | no |
| `maxAbsFinishVarianceMinutes`                      | 1248 | no |
| `maxAbsTotalFloatVarianceMinutes`                  | 1.002… | no |
| `fallbackReason`                                   | `null` | no |
| `unsupportedFeatureFlags`                          | `null` | no |
| `gateDecision`                                     | `{allowed: true, …}` | no |
| `authorityApplied`                                 | `false` | no |

**Conclusion**: AI003 remains blocked at the live cutover gate (gate
mechanics untouched). The bucket distribution change is the only
observable delta and is purely a diagnostic relabelling. No code changes
were made during reconciliation, so no validation rerun is required per
the brief.

---

## 14. Recommended Next Milestone

**W5B-B2.12A.6 — Lag- and Relationship-Chain Variance Decomposition (Read-Only).**

Now that the classifier surfaces 740 lag and 1,167 relationship-chain rows
that were previously masked, the next read-only step is to decompose those
1,907 rows further:

- **Lag rows**: split by lag sign (positive vs negative), by lag relative
  magnitude (sub-workday vs workday-multiple vs other), and by whether the
  variance is consistent with the lag value being applied through the wrong
  calendar.
- **Relationship-chain rows**: split by chain depth (how many predecessors
  resolve up to a constraint or summary boundary), and by whether at least
  one predecessor in the chain triggered a `calendar_boundary_candidate`
  in the immediate-task hint set (a propagated boundary effect).

This continues the diagnostic-refinement track without touching scheduling
behaviour, the cutover gate, the kernel, protocol, or UI. AI003 stays
blocked; we just keep refining the signal.

After lag/chain decomposition stabilises, the *scheduling-side* track can
begin (calendar inheritance / ASAP semantics in the temporal solver) in a
separate package of milestones.

---

*End of W5B-B2.12A.5 audit.*
