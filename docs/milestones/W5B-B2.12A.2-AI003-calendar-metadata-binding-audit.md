# W5B-B2.12A.2 — AI003 Calendar Metadata Binding Audit

> **Diagnostic audit only.** No scheduling fix is shipped. No gate is
> weakened, no tolerance is changed, no authority/persistence is enabled,
> no source dates are mutated, no `unsupportedFeatureFlags` are added.
> AI003 remains correctly blocked.
>
> The one code change in this milestone is a **dev-only window mirror**
> on the main thread ([`apps/web/src/App.tsx`](../../apps/web/src/App.tsx))
> that exposes `tasks`, `dependencies`, `plannerCalendars`,
> `sourceImportRecord`, `projectStartDate` under
> `window.__diagnosticState`, guarded by `import.meta.env.DEV`. It does
> not mutate state, never runs in production, and never emits
> DIFF_STATE.

---

## 1. Executive Summary

The audit identifies a **classifier–lookup mismatch** as the proximate
cause of AI003's 2569 `missing_calendar_metadata_candidate` divergences:

- AI003's import populates **all 11** source calendars into
  `sourceImportRecord.calendarDefinitions` and into
  `sourceImportRecord.resolvedCalendarDefinitions`. **Zero are missing
  at the source layer.**
- The B2.12A bucket classifier looks for calendar metadata in the
  worker's `calendarDefinitions` map and `calendars` map only. Those
  two maps are populated only by `UPSERT_PLANNER_CALENDAR` and
  `CLONE_IMPORTED_CALENDAR` flows — **not** by the normal XER import.
- Result: every task whose `assignedCalendarId` is an imported XER
  calendar id (10288, 10285, 6693, 7701) gets bucketed as
  "missing calendar metadata" — but the metadata is in fact present
  in `resolvedCalendarDefinitions`.

The 2569 figure is therefore a **classifier false positive**, not
evidence that AI003 is missing calendar metadata. The underlying
slot-vs-temporal variance for those rows is small (mostly ±1 to ±3
minutes — sub-workday) and is more likely caused by minute-boundary
rounding in the slot vs temporal calendar engines than by missing
metadata.

The 485 `summary_or_wbs_rollup_candidate` rows are all genuine WBS/
summary rows (verified `isStructuralSummary=true` and the worker's
`isTaskSummary(id)` returns `true` for them). Their large negative
finish variances (−1017 to −1250 minutes) propagate from descendant
leaves through summary rollup arithmetic.

The 7 `unknown_unclassified` rows are also structural summary rows
(`isStructuralSummary=true`) **with no children in the imported
hierarchy** — so the worker's `isTaskSummary(id)` returns `false` and
they bypass the `summary_or_wbs_rollup_candidate` priority. They have
zero start/finish variance and `|totalFloatVariance|=1` only.

### Headline classifier-effect numbers

| Bucket | Reported count | Heuristic interpretation |
| --- | ---: | --- |
| `missing_calendar_metadata_candidate` | 2569 | **False positive** — metadata IS present in `sourceImportRecord.resolvedCalendarDefinitions`; classifier checks the wrong map. |
| `summary_or_wbs_rollup_candidate` | 485 | Genuine WBS/summary rows; variance propagates from leaves. |
| `unknown_unclassified` | 7 | Childless `isStructuralSummary` rows; structural-summary marker not reflected in `isTaskSummary(id)` (which uses `tasks.some(t => t.parentId === id)`). |
| All others | 0 | Pre-empted by the two dominant buckets. |

---

## 2. Scope Confirmation

This is an **audit / diagnosis only** milestone. The user brief
prohibits all of the following, and none of them were done:

- No gate weakening.
- No divergence-tolerance change.
- No UAT / production / temporal-authoritative persistence enabled.
- No attempt to make AI003 pass.
- No schedule output changes.
- No authority apply / rollback logic changes.
- No source-date mutation.
- No resource-calendar / lag-calendar / P6-constraint implementation.
- No new `unsupportedFeatureFlags`.

The single code change is the dev-only `window.__diagnosticState`
mirror in `App.tsx` (see §13).

---

## 3. Calendar Binding Pipeline (Code Map)

The four calendar-related stores live in **worker state**
([packages/worker/src/state.ts](../../packages/worker/src/state.ts)):

| Store | Type | Populated by | Read by classifier? |
| --- | --- | --- | --- |
| `plannerCalendars` | `Record<string, PlannerCalendar>` | `UPSERT_PLANNER_CALENDAR`, `CLONE_IMPORTED_CALENDAR` flows, and the default seed. | Indirect (via `calendarDefinitions`, when planner calendars are upserted). |
| `calendarDefinitions` | `Record<string, BaseCalendarDefinition>` | Seeded with `{ default: STANDARD_CALENDAR }`. Updated by `UPSERT_PLANNER_CALENDAR` and `CLONE_IMPORTED_CALENDAR` ([worker.ts:2385, 2414](../../packages/worker/src/worker.ts)). **Not updated by XER/MSP import.** | **YES** — primary lookup in B2.12A classifier. |
| `calendars` | `Record<string, CalendarConfig>` | `State.setCalendars(...)` is exported but **never called** anywhere in `packages/worker/src/`. | **YES** — fallback lookup in B2.12A classifier. |
| `resolvedCalendarDefinitions` | `Record<string, BaseCalendarDefinition>` | `State.setResolvedCalendarDefinitions(...)` called by XER/MSP import paths ([worker.ts:2567](../../packages/worker/src/worker.ts)). Contains the 11 resolved/flattened AI003 calendars. | **NO** — classifier does not consult this map. |
| `sourceImportRecord.calendarDefinitions` / `sourceImportRecord.resolvedCalendarDefinitions` | sidecar on the import record | Set on import ([worker.ts:2554](../../packages/worker/src/worker.ts), [worker.ts:2543](../../packages/worker/src/worker.ts)). Contains both raw and resolved imported calendars. | **NO** — classifier does not consult these. |

The B2.12A classifier's `hasMissingCalendarMetadata` signal is
constructed in `runTemporalCandidateProjectionExecution`
([worker.ts](../../packages/worker/src/worker.ts), §6 of the B2.12A
note):

```ts
const referencedCalendarId = task?.assignedCalendarId ?? projectCalendarId;
const calendarMetadataLoaded =
  referencedCalendarId != null
  && (calendarDefs[referencedCalendarId] != null
      || calendars[referencedCalendarId] != null);
hasMissingCalendarMetadata: !calendarMetadataLoaded,
```

Because the normal import path **does not** write to
`calendarDefinitions` or `calendars`, every imported calendar id
fails this lookup even though the metadata is present in
`resolvedCalendarDefinitions` and on `sourceImportRecord`. This is a
classifier bug — not a metadata-loading bug.

---

## 4. AI003 Calendar Inventory

Captured live via `window.__diagnosticState.sourceImportRecord` after
importing `apps/web/tests/fixtures/local/AI003.xer` against the
current build. All 11 source calendars are present and resolved.

| Calendar id | Name | In `plannerCalendars` | In `sourceImportRecord.calendarDefinitions` | In `sourceImportRecord.resolvedCalendarDefinitions` |
| --- | --- | :---: | :---: | :---: |
| `default` | Default 5-Day / 8h | ✅ | ❌ | ❌ |
| `6690` | Standard 5 Day Workweek | ❌ | ✅ | ✅ |
| `6691` | Standard 5 Day Workweek-32 | ❌ | ✅ | ✅ |
| `6692` |  Standard 5 Day Workweek | ❌ | ✅ | ✅ |
| `6693` | [Standard] Global 365*7*24 Calendar for FHO & CLSD | ❌ | ✅ | ✅ |
| `7699` | Standard 5 day workweek w/US Holidays through 2030 - CHS | ❌ | ✅ | ✅ |
| `7701` | Standard 5 day workweek w/US Holidays through 2030 | ❌ | ✅ | ✅ |
| `10260` | 6 Day Work Week | ❌ | ✅ | ✅ |
| `10285` | Malaysia Standard 5d | ❌ | ✅ | ✅ |
| `10286` | Singapore Standard 5d WW | ❌ | ✅ | ✅ |
| `10287` | Elapsed Duration Calendar | ❌ | ✅ | ✅ |
| `10288` | Malaysia Standard 6d | ❌ | ✅ | ✅ |

Totals: `plannerCalendars` size = **1** (just `default`);
`sourceImportRecord.calendarDefinitions` size = **11**;
`sourceImportRecord.resolvedCalendarDefinitions` size = **11**.

> Implication: **no source-side metadata is missing**. The 11 imported
> calendars are present and resolved. The classifier's view that 2569
> tasks reference a "missing" calendar is incorrect under any
> definition that consults the import record.

---

## 5. Task Calendar Assignment Binding Matrix

Of 3062 tasks: **2569 have `assignedCalendarId`** set; **493 do not**
(inherit project default). The four assigned calendar ids in use are:

| `assignedCalendarId` | Name | Tasks | In source `calendarDefinitions` | In source `resolvedCalendarDefinitions` | In worker `calendarDefinitions` | In worker `plannerCalendars` | Binding status |
| --- | --- | ---: | :---: | :---: | :---: | :---: | --- |
| `10288` | Malaysia Standard 6d | 2051 | ✅ | ✅ | ❌ | ❌ | Metadata present in sidecar, **not surfaced** to classifier lookup map. |
| `10285` | Malaysia Standard 5d | 461 | ✅ | ✅ | ❌ | ❌ | Same. |
| `6693` | [Standard] Global 365*7*24 | 41 | ✅ | ✅ | ❌ | ❌ | Same. |
| `7701` | Standard 5 day workweek w/US Holidays through 2030 | 16 | ✅ | ✅ | ❌ | ❌ | Same. |
| (none assigned) | — | 493 | n/a | n/a | n/a | n/a | Inherits project calendar `default` (present). |
| **Total tasks** |  | **3062** | | | | | |

The 2569 row total exactly matches `tasks_with_assignedCalendarId`,
which exactly matches the `missing_calendar_metadata_candidate` count
(2569). This 1:1 correspondence is direct evidence of the classifier
mis-lookup.

---

## 6. Missing Calendar Metadata Sample (20 rows)

Five top-variance rows per assigned calendar id. All rows are
**non-summary leaves** (`isStructuralSummary=false`). Variances are
small (±1 to ±3 minutes), well below the 480-min workday boundary
threshold — i.e. these are minute-rounding-class divergences, not
day-scale.

| # | `sourceActivityId` | Name | `assignedCalendarId` | Constraint | Start Δ | Finish Δ | TF Δ |
| --- | --- | --- | --- | --- | ---: | ---: | ---: |
| 1 | `CON-018716` | Non-Fire Rated Partition Installation | 10288 | — | 3 | 1 | 0 |
| 2 | `CON-018682` | MEP 1st Fix | 10288 | — | 1 | 3 | 0 |
| 3 | `CON-018724` | Painting Works | 10288 | — | 1 | 3 | 0 |
| 4 | `CON-018432` | Equipment (POE-A etc) Installation | 10288 | — | 1 | 3 | 0 |
| 5 | `CON-018441` | Equipment Hook-Up, cabling and termination | 10288 | — | 1 | 3 | 0 |
| 6 | `PIN-015152` | Interim Water On | 10285 | **ALAP** | 3 | 1 | 0 |
| 7 | `PIN-015143` | Consumer Substation Energization | 10285 | — | 3 | 1 | 0 |
| 8 | `GG0162` | Steel Erection Start - Phase 1 | 10285 | — | 3 | 3 | 0 |
| 9 | `PUF-012050` | PUF Piling, PC chambers, Precast Elements, and Rig Orders Placed | 10285 | — | 3 | 3 | 0 |
| 10 | `CON-012025` | FSA / DCH - Piling Complete | 10285 | — | 3 | 3 | 0 |
| 11 | `P50-EFA-013901` | EFA-1 to EFA-1 P50 Lag DO NOT TOUCH | 6693 | — | 3 | 1 | 0 |
| 12 | `P95-EFA-013901` | EFA-1 to EFA-1 P95 Lag DO NOT TOUCH | 6693 | — | 3 | 1 | 0 |
| 13 | `P95-CCL4-016200` | Cluster Cooling L4 CX to QAE P95 Lag DO NOT TOUCH | 6693 | — | 1 | 3 | 0 |
| 14 | `P95-QAE-010000` | Milestone: QA Enablement (QAE) P95 DO NOT TOUCH | 6693 | — | 3 | 3 | 0 |
| 15 | `GG0220` | FR Projected - Phase 1 | 6693 | — | 3 | 3 | 0 |
| 16 | `CON-012744` | S27 East Structural Hilti Module Placement | 7701 | — | 3 | 1 | 0 |
| 17 | `CON-022741` | S27 West Structural Hilti Module Placement | 7701 | — | 3 | 1 | 0 |
| 18 | `CON-022742` | S27 North Structural Hilti Module Placement | 7701 | — | 3 | 1 | 0 |
| 19 | `CON-019252` | S27 West Structural Hilti Module Placement | 7701 | — | 1 | 1 | 0 |
| 20 | `CON-019250` | S27 North Structural Hilti Module Placement | 7701 | — | 1 | 1 | 0 |

Observations:

- All 20 sampled rows have a known `assignedCalendarId` that exists in
  `sourceImportRecord.resolvedCalendarDefinitions`. The "missing
  metadata" label is therefore **incorrect** at the source layer.
- All variances are sub-workday (max 3 minutes start/finish, 0 total
  float). Underlying suspect is **minute-precision rounding** in the
  slot vs temporal engines (a small number of minutes can appear when
  the two engines round non-working-interval crossings differently).
- 19 of 20 have no constraint; one (`PIN-015152`) has an `ALAP`
  constraint, which is unrelated to the metadata-binding question.

> The variance magnitude (≤3 min) is well below the
> `maxAbsFinishVarianceMinutes = 1250` reported at the project level.
> The 1250-min figure comes from the **summary rollup bucket**, not
> from the missing-metadata bucket. See §7.

---

## 7. Summary/WBS Rollup Sample (top 10)

All 10 are verified `isStructuralSummary=true` AND have at least one
child in `tasks` (i.e. the worker's `isTaskSummary(id)` returns
`true`). None of them carry an `assignedCalendarId` (they inherit the
project default). All 10 are negative-variance — the temporal engine
finishes them earlier than the slot engine.

| # | Task name | `isStructuralSummary` | `assignedCalendarId` | Start Δ | Finish Δ |
| --- | --- | :---: | --- | ---: | ---: |
| 1 | Core & Shell | ✅ | (none) | -700 | -1250 |
| 2 | Procurement | ✅ | (none) | -532 | -1230 |
| 3 | GC Procurement (GC to Further Detail) | ✅ | (none) | -532 | -1230 |
| 4 | Contractor Furnished Equipment - Long Lead | ✅ | (none) | -757 | -1230 |
| 5 | Procurement | ✅ | (none) | -700 | -1222 |
| 6 | GC Procurement (GC to Further Detail) | ✅ | (none) | -700 | -1222 |
| 7 | OFE Procurement | ✅ | (none) | -892 | -1136 |
| 8 | OFE Procurement | ✅ | (none) | -970 | -1136 |
| 9 | Core & Shell | ✅ | (none) | -532 | -1080 |
| 10 | Contractor Furnished Equipment - Long Lead | ✅ | (none) | -861 | -1017 |

> Hypothesis (not confirmed): the temporal engine resolves summary
> rollups by re-aggregating its own leaf computations, whose minute
> values differ slightly from the slot engine for tasks on
> non-default calendars. Repeated 1–3 minute leaf differences
> aggregating across hundreds of leaves under a summary produce
> day-scale summary variances. Verification is out of scope for this
> audit.

---

## 8. Unknown Unclassified Sample (all 7 rows)

All 7 rows in `unknown_unclassified` are structural-summary rows by
the source marker (`isStructuralSummary=true`) **but have no child
tasks** in the imported hierarchy (their `parentId` does not appear
on any other row). They have zero predecessors and zero successors.

| # | Task name | `isStructuralSummary` | Children | Pred | Succ | Start Δ | Finish Δ | TF Δ |
| --- | --- | :---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | Underground Utilities | ✅ | 0 | 0 | 0 | 0 | 0 | 1 |
| 2 | EYD - Generator Installation | ✅ | 0 | 0 | 0 | 0 | 0 | 1 |
| 3 | External Area | ✅ | 0 | 0 | 0 | 0 | 0 | 1 |
| 4 | Project Contract Milestones (GC to Provide Detail) | ✅ | 0 | 0 | 0 | 0 | 0 | 1 |
| 5 | Design and Engineering | ✅ | 0 | 0 | 0 | 0 | 0 | 1 |
| 6 | Permitting | ✅ | 0 | 0 | 0 | 0 | 0 | 1 |
| 7 | Site Preliminaries | ✅ | 0 | 0 | 0 | 0 | 0 | 1 |

Root cause of the `unknown_unclassified` label: the classifier's
`isSummary` hint is computed via worker `State.isTaskSummary(id)`,
which is implemented as `tasks.some(t => t.parentId === id)`. For
childless `isStructuralSummary` rows that returns `false`, so the
`summary_or_wbs_rollup_candidate` priority is **not** triggered, and
the row falls through to `unknown_unclassified` (no missing-cal, no
constraint, no lag, sub-day variance, ≤1 pred/succ).

This is a **second classifier mis-look** — separate from the calendar
one in §3. The fix (not implemented here) is to also accept
`task.isStructuralSummary === true` as a structural-summary signal.

---

## 9. 49 vs 3061 Discrepancy Reconciliation

The earlier B2.11D operator capture recorded
`unexplainedDivergenceCount = 49`. The current B2.12A.1 / B2.12A.2
reruns report **3061**. The discrepancy was not reconciled during
this audit; below are the things this audit **can** say.

**What is verifiable now:**

- The current `TemporalCandidateComparator.ts` is identical at runtime
  to the comparator that was already on disk before B2.12A — B2.12A
  added bucket classification on the side and did not modify any
  classification or count logic. So the 49 ↔ 3061 gap is **not** a
  B2.12A regression in the comparator itself.
- Git log confirms `packages/worker/src/schedule/TemporalCandidateComparator.ts`
  is not in any committed snapshot — the whole comparator is currently
  in the working tree (`?? packages/worker/src/schedule/UnexplainedDivergenceBuckets.ts`
  for B2.12A; the comparator pre-dates this milestone but lives in the
  same unstaged area). This means a definitive bisect across commits
  is not possible for the comparator alone.
- AI003 fixture size and content: `3,421,670` bytes on disk; checksum
  not recorded in this audit (recommended in §12).
- The current build, with the current fixture, with the documented
  page-console operator path, reproducibly returns **3061**.

**Plausible explanations for the gap (none confirmed):**

- The B2.11D capture may have been taken before the comparator's
  per-task entry was filled with every compared task — possibly
  before slot/temporal got minute-aligned for **all** non-default
  calendar tasks. The current comparator yields a non-zero variance
  for every leaf on a non-default calendar (see §6), which by itself
  forces a 3-digit row count regardless of bucket changes.
- The B2.11D operator may have run against a different fixture
  revision or pre-import state. The fact that AI003 here reports
  *exactly* `tasks_with_assignedCalendarId = 2569` and *exactly*
  `missing_calendar_metadata_candidate = 2569` (1:1 alignment) is
  strong evidence the comparator is currently emitting a row for
  every assigned-calendar leaf, which it may not have been doing
  when B2.11D captured 49.
- The B2.11D figure may have been captured from a different
  diagnostic path (e.g. an authority-apply diagnostics dump rather
  than a candidate-projection diagnostics dump). The B2.12A and
  B2.12A.1 captures are from the projection path.

**Recommendation:** treat **3061** as the current source-of-truth
number for AI003 under this build. Keep the 49 number in B2.11D /
B2.12A historical notes for traceability but do not use it as the
analysis baseline. Reconciliation requires either (a) checking out
the exact build the 49 figure was captured against, or (b) the
operator re-confirming the fixture revision and the diagnostics path
used.

---

## 10. Confirmed Facts

1. **AI003 imports all 11 source calendars** into
   `sourceImportRecord.calendarDefinitions` and
   `sourceImportRecord.resolvedCalendarDefinitions`.
2. **AI003 assigns 2569 leaf tasks to 4 non-default calendars**
   (10288, 10285, 6693, 7701). 493 tasks have no `assignedCalendarId`
   and inherit project default.
3. The worker's `calendarDefinitions` map is **never populated by the
   XER import path**. It is populated only by
   `UPSERT_PLANNER_CALENDAR` and `CLONE_IMPORTED_CALENDAR`.
4. The worker's `calendars` map is **never populated anywhere** in
   the production worker code (`State.setCalendars` is exported but
   only used in tests).
5. The B2.12A classifier reads `calendarDefinitions` and `calendars`
   only, **not** `resolvedCalendarDefinitions` or
   `sourceImportRecord.*`.
6. The 2569 `missing_calendar_metadata_candidate` count exactly
   equals `tasks_with_assignedCalendarId`. The classifier label is a
   **false positive** at the source-import level.
7. The 485 `summary_or_wbs_rollup_candidate` rows are all
   `isStructuralSummary=true` and have children — they are genuine
   summary rows by both the source marker and the worker's
   `isTaskSummary` predicate.
8. The 7 `unknown_unclassified` rows are `isStructuralSummary=true`
   but **childless**, so the worker's `isTaskSummary(id)` returns
   `false` and they bypass the summary bucket priority. They have
   zero pred/succ and zero variance except a 1-minute total-float
   delta.
9. All leaf-row variances in the 20-row §6 sample are ≤3 minutes
   (sub-workday).
10. Safety: `currentAuthorityEngineMode = slot_authoritative`,
    `authorityApplied = false`, `persistenceApplied = false`,
    `sourceProtectionStatus = ok`, `unsupportedFeatureFlags = []`,
    `realWasmValidationPassed = true`. AI003 remains blocked.

---

## 11. Hypotheses (not confirmed by this audit)

- The ≤3-minute leaf variances on non-default-calendar tasks are
  caused by **minute-precision rounding** at non-working-interval
  boundaries between the slot and temporal calendar engines, not by
  any semantic divergence.
- The day-scale summary variances (up to 1250 min ≈ 2.6 working
  days) are produced by the **rollup arithmetic** combining many
  small leaf differences across a deep WBS.
- After (or independent of) fixing the classifier lookup so that
  `resolvedCalendarDefinitions` is consulted, the
  `missing_calendar_metadata_candidate` bucket would likely drop to
  zero for AI003. The underlying `unexplainedDivergenceCount` is
  unaffected — it would still be ~3061 — because the bucket is a
  read-only label, not a gate input.
- The B2.11D `49` figure may have come from an authority-apply
  diagnostics path (which has its own divergence-count semantics)
  rather than a projection-diagnostics path. Verification
  out-of-scope.

---

## 12. Recommended Future Engineering Work

These are recommendations only. **No fix is shipped by this audit.**

1. **(High priority — classifier lookup correction)**
   Extend the `hasMissingCalendarMetadata` hint in
   `runTemporalCandidateProjectionExecution` to also consult
   `State.getResolvedCalendarDefinitions()` and/or
   `State.getSourceImportRecord()?.resolvedCalendarDefinitions`.
   Expected effect: AI003's
   `missing_calendar_metadata_candidate` count drops to ~0; the
   underlying 2569 rows reclassify into one of the other buckets
   (likely `calendar_boundary_candidate` if sub-day variance is
   accepted as a boundary signal, otherwise `unknown_unclassified`).
   `unexplainedDivergenceCount` is unchanged; the gate is unchanged.

2. **(High priority — summary signal correction)**
   Extend the `isSummary` hint to also accept
   `task.isStructuralSummary === true` in addition to the worker's
   `isTaskSummary(id)`. Expected effect: the 7 childless
   `isStructuralSummary` rows reclassify from
   `unknown_unclassified` to `summary_or_wbs_rollup_candidate`.

3. **(Medium — comparator scope review)**
   Investigate whether the comparator should be emitting a
   non-zero-variance row for every non-default-calendar leaf in
   AI003 when the underlying difference is ≤3 minutes. If the slot
   engine is the authoritative target and ≤3-minute differences are
   minute-rounding artefacts, an explicit `epsilon_minutes`
   classification (analogous to
   `expected_summary_critical_rollup_divergence`) may be more
   appropriate. **Note:** this would *not* be a gate-tolerance
   change — it is a read-only reclassification, mirroring the
   B2.6.2B summary-critical precedent.

4. **(Medium — discrepancy reconciliation)**
   Capture the AI003 fixture sha256 and the exact build sha at the
   time of any future operator capture, and record them in the
   evidence note. This makes 49-vs-3061-style discrepancies
   traceable.

5. **(Low — dev hook for snapshot)**
   The `window.__diagnosticState` mirror added in this milestone
   exposes a partial view of state. If future audits need the
   full `calendarDefinitions`, `calendars`, and
   `resolvedCalendarDefinitions` worker maps, a worker-side
   `RUN_DIAGNOSTIC_STATE_SNAPSHOT` command (dev-only, internal
   override required) would be more honest than mirroring on the
   main thread. Not required by this audit.

**None of the above warrants a gate tolerance change.** The
investigation path is: fix the classifier lookups → rerun → re-bucket
→ decide whether AI003's residual divergence is a real scheduling
issue or a comparator/minute-precision artifact.

---

## 13. Safety Confirmation

Captured live via `window.__getTemporalAuthorityDiagnostics()` after
the projection run:

| Field | Value |
| --- | --- |
| `currentAuthorityEngineMode` | **`slot_authoritative`** |
| `previousAuthorityEngineMode` | `slot_authoritative` |
| `authorityApplied` | **`false`** |
| `persistenceApplied` | **`false`** |
| `sourceProtectionStatus` | **`ok`** |
| `realWasmValidationPassed` | `true` |
| `wasmLoadMode` | `real` |
| `unexplainedDivergenceCount` | `3061` |
| `fallbackReason` | `null` (apply not invoked) |
| `lastTemporalCandidateRunId` | `fc670258-3bed-4b66-a69d-84418ac01b52` |

Confirmations against the milestone brief:

- ✅ Dogfood apply **not** run.
- ✅ UAT / production / persistence **not** enabled.
- ✅ Source dates protected (`ok`).
- ✅ AI003 remains blocked from authority apply.
- ✅ `unsupportedFeatureFlags = []` (unchanged).
- ✅ No scheduling outputs changed.

The one code change in this milestone is the dev-only
`window.__diagnosticState` effect in
[`apps/web/src/App.tsx`](../../apps/web/src/App.tsx). It is gated by
`import.meta.env.DEV`, is a pure read of existing React state, never
posts a worker command, and never mutates anything.

---

## 14. Validation Results

Per the brief: "If code is touched for diagnostic-only extraction"
— validation matrix follows.

| Suite | Result |
| --- | --- |
| `pnpm -C packages/protocol exec tsc -b` | ✅ exit 0 |
| `pnpm -C packages/worker exec tsc --noEmit` | ✅ exit 0 |
| `pnpm -C apps/web exec tsc -b` | ✅ exit 0 |
| `pnpm -C packages/worker exec vitest run` | ✅ **1268 / 1268** tests in **65 / 65** files (baseline match) |
| `pnpm -C apps/web exec vitest run` | ✅ **505 / 505** tests in **40 / 40** files (baseline match) |
| `pnpm -C apps/web test:wasm-browser` | ✅ **1 / 1** Playwright test (`W5B-B2.3D real WASM validation gate remains diagnostic-only`) passed |

Full matrix green. The only repository change requiring validation
(the dev-only `useEffect` in `App.tsx`) is gated by
`import.meta.env.DEV` and does not run in Vitest (which evaluates
`import.meta.env.DEV === false`), so the web vitest count is
unchanged at 505/40.

---

## 15. Recommendation

**Accept B2.12A.2 as audit-only.** Do **not** ship a fix in the same
milestone. The next milestone should be a narrow, read-only
**classifier-lookup correction** (recommendations §12.1 and §12.2)
because (a) the present numbers materially mis-attribute AI003's
divergence to "missing metadata" when the metadata is present, and
(b) the fix is mechanical and bounded — extend the lookup, no gate
change, no count change, no schedule change.

A second, separate milestone should then **reconcile the 49 vs 3061
discrepancy** by capturing fixture/build sha at operator-capture
time and rerunning under controlled provenance.

**AI003 remains blocked. Do not weaken the divergence gate. Do not
enable UAT / production / persistence.**

---

*End of W5B-B2.12A.2 audit.*
