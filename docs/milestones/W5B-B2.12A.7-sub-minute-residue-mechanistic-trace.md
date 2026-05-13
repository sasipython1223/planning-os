# W5B-B2.12A.7 — AI003 Sub-Minute Residue Mechanistic Trace (Track A)

**Status:** Track A complete — residue mechanism IDENTIFIED in synthetic
tests. No fix attempted. AI003 remains BLOCKED at live cutover gate.

**Scope:** Test-only, no production code changes, no comparator changes,
no kernel changes, no WASM bridge changes, no protocol changes, no
authority flip, no UAT/production enablement, no
`unsupportedFeatureFlags` activation, no AI003 data consumed.

---

## 1. Executive Summary

The 1–3 unit residue stratified in **B2.12A.6** across
`lag` / `relationship_chain` / `unknown` buckets is **mechanistically
reproduced** by two stacked seams in the JS post-processing path:

1. **Asymmetric wall-clock-day bucketing** in `TemporalScheduleTranslator`:
   `startDayBucket = Math.floor(minute / 1440)` /
   `finishDayBucket = Math.ceil(minute / 1440)`.
   A temporal kernel finish minute in `(N·1440, (N+1)·1440)` is bumped UP
   one wall-day; a temporal kernel start in `[N·1440, (N+1)·1440)` is
   bumped DOWN. On any task whose temporal finish minute is not a clean
   multiple of `1440`, this manufactures a `+1 wall-day` finish residue
   relative to the slot path (which receives engine-native day units).

2. **Minutes-vs-day-offset unit collapse** in `ProjectionAdapter`:
   `totalFloatMinutes = floatWorkMin / mpd`. Combined with the temporal
   translator passing `totalFloatMinutes` through verbatim in
   working-minute units, a 1-work-minute residual becomes
   `1 / 480 ≈ 0.00208…` day-offset units. The value
   `481 / 480 = 1.00208333…` reproduces **exactly** the live-observed
   `maxAbsTotalFloatVarianceMinutes = 1.002083333…` from B2.12A.6.

Both seams are **deterministic, JS-side, and downstream of the
comparator**. The temporal Rust kernel was eliminated as a residue
source (F8–F13 below). The comparator was eliminated as a residue
source (F1–F3 below). The slot translator + projection path was
eliminated on integer-day inputs (F4–F5 below).

A fix is NOT proposed here. Track A is a trace, not a fix.

---

## 2. Scope Confirmation

| Constraint | Status |
| --- | --- |
| Test-only milestone | ✅ |
| No production source files modified | ✅ |
| No comparator / temporal-request-builder / kernel / WASM / protocol change | ✅ |
| No React / UI change | ✅ |
| No AI003 data accessed | ✅ |
| No `unsupportedFeatureFlags` activation | ✅ |
| No gate / tolerance / authority / rollback / persistence change | ✅ |
| AI003 remains BLOCKED at live cutover gate | ✅ |

---

## 3. B2.12A.6 Findings Carried Forward

From [W5B-B2.12A.6](W5B-B2.12A.6-ai003-divergence-audit.md):

- **3053** divergent tasks classified `unexplained_divergence`.
- `maxAbsStartVarianceDayUnits` ≈ 1, `maxAbsFinishVarianceDayUnits` ≈ 1,
  `maxAbsTotalFloatVarianceMinutes = 1.002083333…`.
- `avgSv` ≈ 1.40 – 1.48 day-units; residue distributed across `lag`,
  `relationship_chain`, and `unknown` buckets.
- Working hypothesis at end of B2.12A.6: "1–3 minute residue is a shared
  low-level minute / rounding / boundary residue, not three independent
  semantic failures."

This milestone tests that hypothesis with the smallest possible
synthetic inputs.

---

## 4. Gemini Architecture Review Carried Forward

The Gemini architecture review (B2.12A.6 §11) flagged the
floor/ceil asymmetry in `TemporalScheduleTranslator` and the
minutes/day-offset unit collapse in `ProjectionAdapter` as the most
likely structural origins of fractional residue. Step 2 below directly
exercises both surfaces.

---

## 5. Investigation Order

1. **Comparator** (`compareSlotVsTemporalCandidate`) — Step 1.
2. **JS coordinate / translator** (`parseProjectStartMs`,
   `SlotScheduleTranslator`, `TemporalScheduleTranslator`,
   `ProjectionAdapter`) — Step 2.
3. **JS ↔ WASM boundary** — Step 3 (documented as NOT testable in
   Track A without modifying production; see §8).
4. **Rust kernel boundary / calendar** (`run_schedule_temporal`) — Step 4.

---

## 6. Step 1 — Comparator Test Results

**File added:**
[`packages/worker/tests/schedule/w5b-b2-12a-7-comparator-residue.test.ts`](../../packages/worker/tests/schedule/w5b-b2-12a-7-comparator-residue.test.ts)
(12 tests, all passing).

Findings:

- **F1.** `compareSlotVsTemporalCandidate` computes `temporal − slot` by
  plain numeric subtraction with no rounding, no epsilon, no truncation.
  Fractional differences are propagated verbatim (e.g. `0.5`, `59/60`,
  `481/480`).
- **F2.** The exact live value `481/480 = 1.0020833333…` is reproduced
  by feeding `temporal.totalFloatMinutes = 481/480` and
  `slot.totalFloatMinutes = 0` into the comparator — pinpointing the
  per-pair variance to two upstream day-offset values whose difference
  is exactly `1/mpd`.
- **F3.** A critical-flag-only flip on a leaf task classifies as
  `unexplained_divergence` — i.e. AI003's 3053 unexplained tasks need
  not all carry numeric variance; pure flag drift is sufficient.

**Conclusion (Step 1):** The comparator does not manufacture residue.
The seam is upstream.

---

## 7. Step 2 — JS Coordinate / Translator Test Results

**File added:**
[`packages/worker/tests/schedule/w5b-b2-12a-7-js-coordinate-residue.test.ts`](../../packages/worker/tests/schedule/w5b-b2-12a-7-js-coordinate-residue.test.ts)
(13 tests across 5 describe blocks, all passing).

Findings:

- **F4.** `parseProjectStartMs` is UTC-stable and integer-exact. Not a
  residue source.
- **F5.** `SlotScheduleTranslator` + `ProjectionAdapter` round-trip is
  identity on integer day-offset inputs. The slot path does not
  manufacture residue.
- **F6 (HYPOTHESIS-CONFIRMING).** `TemporalScheduleTranslator` uses
  `Math.floor(minute / 1440)` for start and `Math.ceil(minute / 1440)`
  for finish. A temporal task with `earlyStartMinute = 600` and
  `earlyFinishMinute = 1080` (same wall-day) is normalised to
  `startDate = day 0` / `finishDate = day 1` — a **+1-day finish
  residue** injected by the translator itself.
- **F7 (HYPOTHESIS-CONFIRMING).** `totalFloatMinutes` is passed through
  the temporal translator verbatim in working-minute units; the
  downstream `ProjectionAdapter` then divides by `mpd`. A
  `totalFloatMinutes = 481` work-min input produces
  `481/480 = 1.00208333…` day-offset units in the comparator's input —
  **exactly** matching the live `maxAbsTotalFloatVarianceMinutes`
  reported in B2.12A.6.

**Conclusion (Step 2):** The temporal-side translator + projection
stack is the mechanistic source of both the day-bucket residue and the
fractional `totalFloat` residue observed live.

---

## 8. Step 3 — JS ↔ WASM Boundary Test Results: NOT TESTABLE in Track A

The worker package's existing test infrastructure mocks the WASM module
entirely via `vi.mock("../../src/wasm/loadCpmWasm.js", …)`. No real
integration harness exists at the worker level that exercises the
serialization round-trip between JS and the cpm-wasm crate. Real WASM
tests exist only at `packages/cpm-wasm/tests/wasm_tests.rs`, which
exercise the wasm-bindgen surface in isolation, not the full worker
boundary.

Per the Track A brief: **"If only mocked boundary tests are possible,
document that boundary is not proven."** This is documented here.

**Recommended in B2.12A.8:** introduce a Real-JS↔WASM Boundary Harness
(still test-only) that round-trips a small fixture through the
production `loadCpmWasm` path and asserts byte-identical
`TemporalScheduleResult` reconstruction.

---

## 9. Step 4 — Rust Kernel Boundary / Calendar Test Results

**File added:**
[`packages/cpm-kernel/tests/w5b_b2_12a_7_boundary_residue_tests.rs`](../../packages/cpm-kernel/tests/w5b_b2_12a_7_boundary_residue_tests.rs)
(10 tests, all passing).

Findings:

- **F8.** The temporal kernel uses **half-open intervals** `[start, finish)`.
  `finish − start == duration` exactly for any integer duration in
  `{1, 59, 60, 61, 479, 480, 481, 1439, 1440, 1441}`.
- **F9.** A task ending at a calendar interval's upper bound has
  `earlyFinishMinute == upper_bound` (exclusive end). A zero-duration
  successor lands on the same boundary minute.
- **F10.** Calendar-gap resume is exact at gap-end. Two synthetic
  split-calendar tests confirm no ±1-minute wobble at the resume seam.
- **F11.** The kernel emits `i64` minutes — no fractional output is
  reachable by construction. **Fractional residue observed live cannot
  originate inside the Rust kernel.**
- **F12.** The kernel happily emits intra-wall-day finish minutes (e.g.
  `early_finish = 481` for a 481-minute task in a continuous calendar).
  This is the precondition for the asymmetric floor/ceil bucketing in
  `TemporalScheduleTranslator` (F6) to fire.
- **F13.** The FS seam itself introduces zero drift between predecessor
  finish and successor start (`B.early_start == A.early_finish` for
  `A FS→ B`). The residue is not located at relationship math.

**Conclusion (Step 4):** The Rust temporal kernel is eliminated as a
residue source. The kernel produces exact integer minute coordinates;
all observed residue enters at the JS-side translator / projection
layer documented in §7.

---

## 10. What Was Reproduced

| Live observation | Synthetic reproduction | Test |
| --- | --- | --- |
| `maxAbsTotalFloatVarianceMinutes = 1.002083333…` | `481 / 480 = 1.00208333…` | Step 2.4 (F7); cross-checked Step 1 (F2) |
| `+1` day finish residue on day-bucketed tasks | `floor(600/1440)=0`, `ceil(1080/1440)=1` | Step 2.3 (F6) |
| Sub-minute fractional comparator output | Plain `temporal − slot` of two fractional day-offset values | Step 1 (F1, F2) |
| 1–3 unit residue spread across `lag`/`relationship_chain`/`unknown` buckets | Bucketing residue is independent of dependency type and is sufficient to produce the observed `avgSv` if a non-trivial fraction of tasks have temporal finish minutes ∉ `{0, 1440, 2880, …}` | Step 2.3 (F6) + Step 4 (F12) |

---

## 11. What Was Eliminated

- **Comparator math** — F1 + F2 prove the comparator is a pure
  subtractor; no residue manufactured.
- **`SlotScheduleTranslator` + `ProjectionAdapter` round-trip on integer
  inputs** — F5 proves identity.
- **`parseProjectStartMs`** — F4 proves UTC stability and
  integer-exactness.
- **The Rust temporal kernel** (`run_schedule_temporal`,
  `advance_working`, FS seam, calendar-gap resume, workday-boundary
  finish representation) — F8–F13 prove integer-exact half-open
  semantics with zero ±1 wobble.

---

## 12. What Is Still Not Proven

- **Real JS ↔ WASM round-trip fidelity.** All worker tests mock the
  WASM bridge. Whether the bridge itself introduces any residue
  (serialization, type coercion, BigInt → number narrowing, etc.)
  remains untested at the worker layer. Recommended next milestone
  proposes a real harness.
- **Actuals / progress contribution.** AI003 may include in-progress
  tasks with non-zero `% complete`. The residue trace here was conducted
  on greenfield (zero-actuals) synthetic inputs only. Whether progress
  remapping introduces an independent residue is not tested here.
- **Multi-calendar interaction.** Per-task and per-relation calendars
  with mixed working patterns can in principle inject additional
  residue at the comparator's input. Not tested here.

---

## 13. Safety Confirmation

- AI003 remains **BLOCKED at the live cutover gate.** Nothing in this
  milestone changes that.
- No production source file was modified. The repository diff is
  bounded to three test/doc files (§§ 6, 7, 9, and this document).
- No comparator / temporal-request-builder / kernel / WASM / protocol /
  React / gate / tolerance / authority / rollback / persistence change
  was introduced.
- No `unsupportedFeatureFlags` was activated.
- No UAT / production enablement step was taken.
- No AI003 data was accessed during this work.

---

## 14. Recommended Next Milestone — B2.12A.8

Before any fix is approved, propose the following **test-only** next
step:

**B2.12A.8 — Real JS ↔ WASM Boundary Harness + Cross-Translator Parity
Tightening**

Scope:
1. Introduce a minimal harness in `packages/worker/tests/` that loads
   the real `cpm-wasm` build (no `vi.mock`) and runs a 3-task synthetic
   request, asserting byte-identical `TemporalScheduleResult`
   reconstruction at the boundary. Closes the §8 gap.
2. Add cross-translator parity tests:
   `SlotScheduleTranslator` and `TemporalScheduleTranslator` fed with
   *equivalent* engine outputs (one in slot units, the other in the
   matching wall-minute units) must produce identical
   `NormalizedScheduleFacts` for the same task. Pin the asymmetry
   documented in F6 either as a bug or as an intentional rule.
3. Add a `% complete` / actuals residue test on synthetic inputs to
   close the §12 gap on progress remapping.

**Track A's mechanistic hypothesis (F6 + F7) must be re-tested against
B2.12A.8's real-WASM harness before any production fix is scoped.**

---

## Appendix A — Files Added in This Milestone

| Path | Purpose | Test count |
| --- | --- | --- |
| [`packages/worker/tests/schedule/w5b-b2-12a-7-comparator-residue.test.ts`](../../packages/worker/tests/schedule/w5b-b2-12a-7-comparator-residue.test.ts) | Step 1: comparator math is pure subtraction | 12 |
| [`packages/worker/tests/schedule/w5b-b2-12a-7-js-coordinate-residue.test.ts`](../../packages/worker/tests/schedule/w5b-b2-12a-7-js-coordinate-residue.test.ts) | Step 2: JS translator + projection seam reproduction | 13 |
| [`packages/cpm-kernel/tests/w5b_b2_12a_7_boundary_residue_tests.rs`](../../packages/cpm-kernel/tests/w5b_b2_12a_7_boundary_residue_tests.rs) | Step 4: Rust kernel boundary / calendar-gap pinning | 10 |

**Total: 35 synthetic tests added, 0 production changes, 0 tests removed.**

## Appendix B — Test Commands & Results

```text
$ pnpm -C packages/worker exec vitest run \
    tests/schedule/w5b-b2-12a-7-comparator-residue.test.ts \
    tests/schedule/w5b-b2-12a-7-js-coordinate-residue.test.ts
 ✓ tests/schedule/w5b-b2-12a-7-comparator-residue.test.ts  (12 tests) 5ms
 ✓ tests/schedule/w5b-b2-12a-7-js-coordinate-residue.test.ts  (13 tests) 5ms
 Test Files  2 passed (2)
      Tests  25 passed (25)

$ cd packages/cpm-kernel && cargo test --test w5b_b2_12a_7_boundary_residue_tests
running 10 tests
test b2_12a_7_calendar_gap_resume_is_at_exact_gap_end_minute ... ok
test b2_12a_7_calendar_gap_task_starting_one_minute_before_gap_resumes_cleanly ... ok
test b2_12a_7_finish_at_boundary_then_zero_duration_successor_lands_at_same_boundary_minute ... ok
test b2_12a_7_finish_is_exclusive_upper_bound_60min_duration ... ok
test b2_12a_7_finish_minus_start_equals_duration_for_misc_durations ... ok
test b2_12a_7_finish_minute_alignment_481_dur_in_continuous_calendar_does_not_align_to_1440 ... ok
test b2_12a_7_fs_chain_predecessor_finish_equals_successor_start_no_drift ... ok
test b2_12a_7_kernel_never_emits_sub_minute_finish_for_integer_duration ... ok
test b2_12a_7_one_hour_exact_duration_round_trip ... ok
test b2_12a_7_task_ending_exactly_at_workday_boundary_uses_exclusive_end ... ok
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out

$ pnpm -C packages/worker exec tsc --noEmit
(no output — clean)
```

---

**END W5B-B2.12A.7 — Track A.**
**STOP CONDITION HONORED: No production code change attempted.**
**AI003 remains BLOCKED.**
