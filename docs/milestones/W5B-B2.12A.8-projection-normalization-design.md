# W5B-B2.12A.8 — Projection Normalization Design Memo (Track B)

**Status:** Memo only. No production code change proposed for B2.12A.8.
Recommendations are **conditional on Track A evidence** and are split
into two future fix milestones.

**Scope:** Document candidate correction designs, their tradeoffs,
their blast radius, and the future milestone each would live in. Do
**not** recommend a single design as approved — the empirical evidence
to choose between them does not yet exist (see §3 and §13).

---

## 1. Executive Summary

B2.12A.7 (synthetic test-only) mechanistically reproduced two distinct
seams that, on synthetic inputs, account for the live AI003 residue
pattern:

- **Seam α — Day-bucket asymmetry** in `TemporalScheduleTranslator`:
  `floor(start / 1440)` vs `ceil(finish / 1440)` injects a `+1`
  wall-day finish residue whenever the kernel emits an intra-wall-day
  finish minute (B2.12A.7 F6 + F12).
- **Seam β — Float unit collapse** between `TemporalScheduleTranslator`
  (which passes `totalFloatMinutes` through verbatim, in working-minute
  units) and `ProjectionAdapter` (which divides by `mpd = 480`). A
  1-working-minute residual becomes `1/480 ≈ 0.00208` day-offset units;
  `481/480 = 1.00208333…` reproduces the live
  `maxAbsTotalFloatVarianceMinutes` value exactly (B2.12A.7 F7).

B2.12A.8 Track A attempted to **confirm both seams against the real
JS↔WASM boundary**. That attempt was **structurally blocked** under
the milestone's no-production / no-config rules (see §3). Track A
produced a documented blocker probe rather than the six required
scenario results.

Consequently, this memo treats both seams as **mechanistically plausible
but not yet boundary-confirmed**. Each candidate fix design below is
marked accordingly with `[PROVEN-SYNTHETIC]`, `[UNPROVEN-AT-BOUNDARY]`,
or `[UNPROVEN]`.

---

## 2. Track A Evidence Summary

**Test file:**
[packages/worker/tests/integration/w5b-b2-12a-8-real-wasm-boundary.test.ts](../../packages/worker/tests/integration/w5b-b2-12a-8-real-wasm-boundary.test.ts)

| Test ID | Status |
| --- | --- |
| (probe) `documents that vitest+node cannot load the bundler-target cpm-wasm artifact via production loadCpmWasm` | **PASS** (pins blocker) |
| `b2_12a_8_real_wasm_clean_day_aligned_zero_residue` | **TODO** (boundary blocked) |
| `b2_12a_8_real_wasm_481_min_duration_preserves_kernel_minute` | **TODO** (boundary blocked) |
| `b2_12a_8_real_wasm_intra_wall_day_finish_produces_plus_one_day_bucket` | **TODO** (boundary blocked) |
| `b2_12a_8_real_wasm_fs_lag_chain_no_drift` | **TODO** (boundary blocked) |
| `b2_12a_8_real_wasm_calendar_gap_resume_byte_identical` | **TODO** (boundary blocked) |
| `b2_12a_8_real_wasm_no_fractional_minutes_anywhere` | **TODO** (boundary blocked) |

The probe test reproduces and pins the exact failure mode (Vite's
`"ESM integration proposal for Wasm" is not supported currently`) so
that any future change that accidentally unblocks the loader becomes a
deliberate, reviewable event.

---

## 3. Negative Control Result

**NOT EXECUTED.**

The negative-control test
(`b2_12a_8_real_wasm_clean_day_aligned_zero_residue`) requires the
production `loadCpmWasm` to succeed inside vitest's `node` environment.
That fails because the bundler-target wasm-pack artifact uses
`import * as wasm from "./cpm_wasm_bg.wasm";`, which vitest/Vite rejects
without `vite-plugin-wasm` (forbidden — vitest project config edit) or a
loader rewrite (forbidden — `loadCpmWasm.ts` production change).

**Interpretation:** The B2.12A.7 JS-translator-only hypothesis remains
**neither confirmed nor falsified at the real boundary**. All
conditional design recommendations below carry this caveat.

---

## 4. Boundary Residue Result

**NOT EXECUTED.** See §3 for the structural cause.

The B2.12A.7 synthetic prediction for this case is preserved verbatim:
the kernel emits `early_finish_minute = 481` (B2.12A.7 F12 — `cargo`
side), the translator should pass it through, and ProjectionAdapter
divides by `mpd = 480` yielding `1.00208333…` day-offset units.
Confirmation against the real boundary is deferred to the follow-on
milestone proposed in §14.

---

## 5. Lag / Relationship Boundary Result

**NOT EXECUTED.** See §3.

Synthetic Rust-side evidence (B2.12A.7 F13) shows zero drift at the FS
seam. Real-boundary confirmation of FS+lag survival is deferred.

---

## 6. Calendar Gap Boundary Result

**NOT EXECUTED.** See §3.

Synthetic Rust-side evidence (B2.12A.7 F10) pins the kernel-side
gap-resume to the exact gap-end minute. Real-boundary confirmation that
calendar interval `Vec<(i64, i64)>` serialization survives the boundary
without drift is deferred.

---

## 7. Candidate Design A — Float Unit Normalization

**Target seam:** β (B2.12A.7 F7) `[PROVEN-SYNTHETIC]`,
`[UNPROVEN-AT-BOUNDARY]`.

**Problem statement.** `TemporalScheduleTranslator` writes
`NormalizedScheduleFacts.totalFloatMinutes` in **working-minute units**
(kernel-native). `SlotScheduleTranslator` writes the same field in
**day-offset × mpd** units, which on integer-day inputs are
numerically identical to working minutes. `ProjectionAdapter` then
divides `totalFloatMinutes` by `mpd`. When the temporal kernel returns
a `totalFloatMinutes` value that is **not** a clean multiple of `mpd`
(e.g. 481 work-min), the post-projection day-offset float is
**fractional** (`481/480 = 1.00208333…`).

### Candidate A1 — Round-at-projection

`ProjectionAdapter`: replace `floatWorkMin / mpd` with
`Math.round(floatWorkMin / mpd)` or `Math.floor(...)`.

- **Pros:** Smallest possible diff. No translator change.
- **Cons:** Information-destroying — collapses every sub-day float
  distinction to integer days, including legitimately-fractional
  results. Likely to mask real bugs.
- **Blast radius:** Comparator input only. Downstream consumers of
  `totalFloatMinutes` would silently see integer-only values where
  fractional values previously appeared.
- **Verdict:** **Not recommended.** Lossy.

### Candidate A2 — Unit-tag at translator boundary `[RECOMMENDED candidate, NOT a final fix decision]`

Introduce a brand type pair (e.g. `WorkMinutes` vs `DayOffsetUnits`)
on `NormalizedScheduleFacts.totalFloatMinutes`. Both translators are
required to emit one specific unit (preferred:
`day-offset × mpd = working-minute`, which is what the slot translator
already emits on integer-day inputs). `ProjectionAdapter` then divides
once. The temporal translator becomes responsible for normalising the
kernel-native working-minute float into the agreed unit explicitly.

- **Pros:** Single source of truth; compile-time-enforceable.
  Surfaces the seam in the type system rather than masking it.
- **Cons:** Requires brand-type propagation through both translator
  signatures and the comparator's input type. Slightly larger diff.
- **Blast radius:** Both translators + `NormalizedScheduleFact.ts` +
  `ProjectionAdapter` + comparator input type. No downstream UI/
  persistence change required (the post-projection numeric value is
  unchanged for already-integer inputs).
- **Verdict:** **Recommended as the leading candidate, conditional on
  Track A confirmation** that the real boundary preserves the kernel's
  481 verbatim. If Track A reveals a *different* boundary-side residue
  (e.g. BigInt narrowing), A2 alone would be insufficient.

### Candidate A3 — Translator pre-divides

`TemporalScheduleTranslator` divides `totalFloatMinutes` by `mpd`
before writing to `NormalizedScheduleFacts`. `ProjectionAdapter` is
unchanged.

- **Pros:** Locality of the fix matches the locality of the seam.
- **Cons:** `NormalizedScheduleFacts.totalFloatMinutes` is currently
  read by other consumers as **minutes**; renaming the unit at one
  translator only forks the field's meaning by translator origin —
  fragile.
- **Verdict:** **Not recommended.** Hidden bifurcation.

---

## 8. Candidate Design B — Day-Bucket Symmetry

**Target seam:** α (B2.12A.7 F6) `[PROVEN-SYNTHETIC]`,
`[UNPROVEN-AT-BOUNDARY]`.

**Problem statement.** `TemporalScheduleTranslator` uses
`startDayBucket = Math.floor(minute / 1440)` and
`finishDayBucket = Math.ceil(minute / 1440)`. A task whose temporal
finish minute lies inside a wall-day (e.g. minute 1080) is reported
as finishing on **the next** wall-day. The slot translator's parallel
output (using engine-native day units) does not exhibit this rounding
direction. The asymmetry is the documented D4 day-bucketing rule but
it is **not parity-preserving** against the slot path.

### Candidate B1 — Floor both ends

`finishDayBucket = Math.floor(minute / 1440)`.

- **Pros:** Symmetric. Trivial one-line change.
- **Cons:** A task with `early_finish_minute = 1440` (exactly the
  wall-day boundary, the exclusive end of day 0) would map to
  `finishDate = day 0`, which collides with the half-open interval
  semantics — a 0-minute finish on the same day as it started, which
  the UI may render as "ends on day 0 inclusive" → confusing.
- **Verdict:** **Not recommended without UI review.**

### Candidate B2 — Ceil both ends

`startDayBucket = Math.ceil(minute / 1440)`.

- **Pros:** Symmetric.
- **Cons:** A task with `early_start_minute = 0` would map to start
  day 0 (since `ceil(0/1440) = 0`), but a task with
  `early_start_minute = 1` would map to start day 1 — surprising and
  contradicts the natural "start day contains the start minute"
  reading.
- **Verdict:** **Not recommended.**

### Candidate B3 — Floor + “end-inclusive day” `[RECOMMENDED candidate, NOT a final fix decision]`

Both ends use `floor`. Add an explicit semantic rule: a task's
`earlyFinishDate` represents the **first day on which work occurs after
the task's end** (i.e. the next-working-day cursor), making the field
exclusive-on-the-right by definition. Document the convention in
`NormalizedScheduleFact.ts` and the translator. This matches the
half-open interval semantics already pinned in B2.12A.7 F8/F9.

- **Pros:** Matches kernel semantics; symmetric; documentable.
- **Cons:** Renames the *meaning* of `earlyFinishDate` from
  "last day of work" to "first day after work". Downstream consumers
  (UI rendering, export round-trip, persistence) may currently read
  it as the former. Requires a downstream-consumer audit.
- **Blast radius:** **HIGH.** Translator + UI + export + (possibly)
  persisted snapshot meaning.
- **Verdict:** **Recommended candidate, conditional on Track A
  confirmation that seam α is observed at the real boundary and on a
  separate downstream-consumer audit** (proposed B2.12A.10.0 — Audit
  of `earlyFinishDate` consumers).

### Candidate B4 — Project the seam away

Both translators project to integer day-offsets at the translator
layer (already true for the slot path). `TemporalScheduleTranslator`
collapses any intra-wall-day finish minute by computing
`Math.floor(finish / 1440) + (finish % 1440 === 0 ? 0 : 1)`, which is
exactly the current `ceil` rule, but unified with an explicit start
rule of `Math.floor(start / 1440)` — i.e. the current asymmetric
behaviour, but **renamed and documented** as intentional rather than
treated as a bug.

- **Pros:** Zero behaviour change. Lowest risk.
- **Cons:** Does not fix the comparator divergence — the comparator
  will continue to report `+1` finish residue against the slot path.
  If the *slot* path is the deviation rather than the temporal path,
  this is the correct call.
- **Verdict:** **Holding pattern. Recommended only if Track A confirms
  the slot translator is the one that should change**, which would
  itself become a separate milestone.

---

## 9. Blast Radius Comparison

| Design | Files touched | Type-level change | Downstream consumer audit needed | Behavioural change visible to UI |
| --- | --- | --- | --- | --- |
| A2 (unit-tag) | `NormalizedScheduleFact.ts`, both translators, `ProjectionAdapter`, comparator input type | Yes (brand types) | No (numerical output unchanged on integer-day inputs) | None (or negligible) |
| B3 (floor + semantic rename) | Translator + `NormalizedScheduleFact.ts` + UI date renderers + export | No | **Yes — required** | **Yes** (finish dates shift by ±1 day for intra-wall-day finishes) |

A2 is **strictly smaller** in blast radius. B3 requires a separate
downstream audit milestone before it can be safely scoped.

---

## 10. Required Future Tests

Before any of the candidates above can be **scoped** (let alone
implemented), the following must land in test-only form:

- **R1.** Real-boundary unblock: at least the six `it.todo` scenarios in
  the Track A harness must be runnable. This requires a sanctioned
  non-production loader path (proposed milestone B2.12A.8.1).
- **R2.** A *cross-translator parity test* (synthetic): feed
  `SlotScheduleTranslator` and `TemporalScheduleTranslator` with
  semantically-equivalent kernel outputs and assert
  `NormalizedScheduleFacts` equality on every axis. The asymmetric
  bucketing (seam α) must fail this test today; that failure becomes
  the documentation of the bug.
- **R3.** A downstream-consumer audit of `earlyFinishDate` readers
  (UI, export, persistence) before B3 (B2.12A.10) is scoped.
- **R4.** A `% complete` / actuals residue test on synthetic inputs to
  close the gap noted in B2.12A.7 §12.

---

## 11. What Is Proven

- B2.12A.7 F1–F3: comparator math is pure subtraction; not a residue
  source. `[PROVEN-SYNTHETIC]`.
- B2.12A.7 F4–F5: slot translator + projection round-trip is identity
  on integer-day inputs. `[PROVEN-SYNTHETIC]`.
- B2.12A.7 F6: asymmetric `floor`/`ceil` bucketing reproduces a
  `+1 wall-day` finish residue. `[PROVEN-SYNTHETIC]`.
- B2.12A.7 F7: `481 / 480 = 1.00208333…` reproduces live
  `maxAbsTotalFloatVarianceMinutes` exactly. `[PROVEN-SYNTHETIC]`.
- B2.12A.7 F8–F13: Rust kernel is half-open, integer-exact, calendar-
  gap-exact, FS-drift-free. `[PROVEN-SYNTHETIC]` (Rust cargo tests).

---

## 12. What Is Conditional

Every recommendation in §7 and §8 is **conditional on Track A
confirmation** that the real JS↔WASM boundary preserves the kernel's
integer-minute outputs verbatim and does not itself introduce an
independent residue. Until R1 lands, A2 and B3 are **candidates, not
selections**.

---

## 13. What Is Unproven

- Real JS↔WASM boundary residue behaviour. `[UNPROVEN]` — Track A
  blocked, see §3.
- Whether seam α and seam β are the *complete* explanation of AI003's
  3053 unexplained-divergence tasks, or whether additional sources
  exist (`% complete` remapping, multi-calendar interaction,
  constraint-type-specific paths). `[UNPROVEN]`.
- BigInt → number narrowing across the boundary for very large minute
  values (kernel uses `i64`; JS `number` is safe up to 2^53). For
  typical project horizons (`~ 10⁸` minutes) this is far below the
  limit, but it has not been pinned. `[UNPROVEN]`.

---

## 14. Recommended Future Milestones

Strictly future, **not** B2.12A.8. Listed in recommended execution
order:

1. **B2.12A.8.1 — Real-WASM Loader Harness Wiring.** Sanctioned
   test-only path to load the cpm-wasm artifact from vitest. Two
   acceptable shapes; the milestone chooses one and justifies it:
   (a) a new test-only loader file under `packages/worker/tests/integration/`
   that calls `WebAssembly.instantiate` on the `.wasm` artifact
   directly (bypassing the bundler-target glue) and re-exposes
   `calculate_schedule_minute`; or (b) a sanctioned addition of
   `vite-plugin-wasm` to a **separate** vitest config used only for
   the integration directory (does not modify the default vitest
   config). Unblocks all six Track A `it.todo` scenarios.
2. **B2.12A.8.2 — Cross-Translator Parity Test (synthetic).** Adds
   R2 above. No production change.
3. **B2.12A.8.3 — Downstream `earlyFinishDate` Consumer Audit
   (read-only).** Adds R3 above. Doc-only.
4. **B2.12A.9 — Float Unit Normalization.** Implements A2 conditional
   on B2.12A.8.1 + 8.2 outcomes. Lower blast radius.
5. **B2.12A.10 — Day-Bucket Symmetry.** Implements B3 conditional on
   B2.12A.8.1 + 8.2 + 8.3 outcomes. Higher blast radius. Must not be
   merged with B2.12A.9.

---

**END W5B-B2.12A.8 Track B memo.**
**NO PRODUCTION CHANGE PROPOSED IN THIS MILESTONE.**
**AI003 REMAINS BLOCKED.**
