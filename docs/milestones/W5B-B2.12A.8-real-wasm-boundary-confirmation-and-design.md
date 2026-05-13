# W5B-B2.12A.8 — Real JS↔WASM Boundary Confirmation + Projection Normalization Design

**Status:** Track A **blocked at boundary loader** under strict no-production /
no-config rules. Blocker pinned by a deliberate probe test. Track B
memo produced as conditional design only. No production code modified.
AI003 remains **BLOCKED at the live cutover gate.**

---

## 1. Executive Summary

The objective of B2.12A.8 was to confirm — against the **real** JS↔WASM
boundary, not a mocked one — whether the two seams reproduced
synthetically in B2.12A.7 (asymmetric `floor`/`ceil` wall-day bucketing
in `TemporalScheduleTranslator`; minutes-vs-day-offset unit collapse in
`ProjectionAdapter`) account for the AI003 1–3 unit residue end-to-end.

While authoring the Track A harness, a structural blocker was
discovered and pinned:

- The production `loadCpmWasm` calls `import("@planner/engine")`, which
  resolves to a `wasm-pack --target bundler` artifact that uses
  `import * as wasm from "./cpm_wasm_bg.wasm";`.
- Vitest 1.6 / Vite 5 in the worker's `node` test environment rejects
  this with `"ESM integration proposal for Wasm" is not supported
  currently. Use vite-plugin-wasm …`.
- The two known unblocks are **both explicitly forbidden** by the
  B2.12A.8 brief:
  1. Editing `loadCpmWasm.ts` to use `?init` / manual instantiation
     (production change).
  2. Adding `vite-plugin-wasm` to `packages/worker/vitest.config.ts`
     (vitest project config edit).

Per the brief's stop-condition clause — *"loadCpmWasm cannot be used
without modifying production code … Stop after Track A tests, Track B
memo, and milestone documentation"* — Track A produced a documented
blocker probe in place of the six required scenario results, Track B
produced a memo with **conditional** candidate designs, and this
document records the milestone outcome. No production code, no vitest
config, no CI workflow, no protocol, no kernel, no WASM bindings were
modified.

---

## 2. Scope Confirmation

| Constraint | Status |
| --- | --- |
| Boundary confirmation + design only | ✅ |
| No production source file modified | ✅ |
| No `TemporalScheduleTranslator` change | ✅ |
| No `SlotScheduleTranslator` change | ✅ |
| No `ProjectionAdapter` change | ✅ |
| No `TemporalCandidateComparator` change | ✅ |
| No `loadCpmWasm.ts` change | ✅ |
| No `worker.ts` change | ✅ |
| No `cpm-kernel` source change | ✅ |
| No `cpm-wasm` source change | ✅ |
| No protocol contract change | ✅ |
| No `apps/web/src/**` change | ✅ |
| No gate / tolerance / authority / fallback / rollback / persistence change | ✅ |
| No UAT / production / `unsupportedFeatureFlags` activation | ✅ |
| No AI003 fixture read | ✅ |
| No CI workflow change | ✅ |
| No default test script change | ✅ |
| No vitest project config change | ✅ |
| No existing B2.12A.6 / B2.12A.7 test edit | ✅ |
| No `vi.mock` of `loadCpmWasm` in the harness | ✅ |

---

## 3. B2.12A.7 Findings Carried Forward

From [W5B-B2.12A.7](W5B-B2.12A.7-sub-minute-residue-mechanistic-trace.md):

- **F1–F3 (comparator):** pure subtraction; not a residue source.
- **F4–F5 (slot path):** integer-day round-trip is identity.
- **F6 (HYPOTHESIS-CONFIRMING, synthetic):** asymmetric
  `floor(start/1440)` / `ceil(finish/1440)` injects a `+1` wall-day
  finish residue when the temporal kernel emits intra-wall-day finish
  minutes.
- **F7 (HYPOTHESIS-CONFIRMING, synthetic):** `481 / 480 = 1.00208333…`
  reproduces live `maxAbsTotalFloatVarianceMinutes` exactly under
  `TemporalScheduleTranslator` (verbatim) + `ProjectionAdapter` (÷ mpd).
- **F8–F13 (Rust kernel):** half-open `[start, finish)`,
  `finish − start == duration` exactly, exact calendar-gap resume, zero
  FS drift, integer-exact `i64` minutes — the kernel cannot be the
  source of fractional residue.

All synthetic findings remain valid. B2.12A.8 does **not** invalidate
any of them. It also does **not** confirm them at the real boundary.

---

## 4. Gemini Architecture Review Carried Forward

The Gemini review of the B2.12A.8 proposal returned **Accept with
changes**. All required changes were honoured:

| Required change | Honoured |
| --- | --- |
| Track A executes before Track B | ✅ (Track A authored and run first; blocker found; Track B authored after) |
| Track B recommendations conditional on Track A evidence | ✅ (memo marks every recommendation `[UNPROVEN-AT-BOUNDARY]` or `[PROVEN-SYNTHETIC]`) |
| Track B memo-only | ✅ (separate file; no code, no tests, no flags, no scaffolding) |
| Negative-control test required | ✅ (declared as required scenario `b2_12a_8_real_wasm_clean_day_aligned_zero_residue`; status TODO due to boundary blocker — documented in §8) |
| No CI wiring | ✅ |
| No AI003 fixture | ✅ |
| No production code changes | ✅ |
| Future float-unit and day-bucket fixes split into two milestones | ✅ (Track B §14 — B2.12A.9 and B2.12A.10 distinct) |

---

## 5. Track A Test Harness Method

**File added:**
[packages/worker/tests/integration/w5b-b2-12a-8-real-wasm-boundary.test.ts](../../packages/worker/tests/integration/w5b-b2-12a-8-real-wasm-boundary.test.ts)

Harness contract (enforced by the file's banner comment and by §2 of
this document):

- Imports `loadCpmWasm`, `getCpmWasm`, `isWasmLoaded` from the **real**
  production module path. No `vi.mock` of any WASM/boundary module.
- Targets the already-built `packages/cpm-wasm/pkg/` artifact through
  the `@planner/engine` workspace alias — read-only.
- Does **not** trigger a WASM rebuild.
- Is **not** wired into CI or any default test script. Runs
  on-demand only via the explicit command in §6.

**Directory added:**
[packages/worker/tests/integration/](../../packages/worker/tests/integration/) with
[README.md](../../packages/worker/tests/integration/README.md) restating
the harness rules.

---

## 6. Build Precondition

| File | Size | Mtime (epoch) | Newer than |
| --- | --- | --- | --- |
| `packages/cpm-wasm/pkg/cpm_wasm_bg.wasm` | 204813 B | 1778677876 | `cpm-wasm/src/lib.rs` (1777903171) ✅ |
| | | | `cpm-kernel/src/temporal.rs` (1778317363) ✅ |

Build precondition **met**. No rebuild was attempted by the harness; no
rebuild scripting was added to the test file.

Manual rebuild command (out of scope for B2.12A.8, **not** executed):

```bash
pnpm -C packages/cpm-wasm run build
```

---

## 7. Track A Test Results

```text
$ pnpm -C packages/worker exec vitest run \
    tests/integration/w5b-b2-12a-8-real-wasm-boundary.test.ts
 ✓ tests/integration/w5b-b2-12a-8-real-wasm-boundary.test.ts  (7 tests | 6 skipped) 7ms
 Test Files  1 passed (1)
      Tests  1 passed | 6 todo (7)
```

- **1 probe test passed.** Pins the exact loader failure mode (Vite's
  `"ESM integration proposal for Wasm" is not supported currently`)
  and asserts `isWasmLoaded() === false`. Any future change that
  silently makes this loader succeed will cause this test to fail
  loudly — making the boundary becoming testable a deliberate event.
- **6 required scenario tests declared as `it.todo`.** Each carries
  the exact scenario, inputs, and assertions from the B2.12A.8 brief
  in its comment block, ready to be activated when a sanctioned
  non-production loader path lands (proposed B2.12A.8.1 — see §15).

```text
$ pnpm -C packages/worker exec tsc --noEmit
(no output — clean)
```

---

## 8. Boundary Negative Control Result

**`b2_12a_8_real_wasm_clean_day_aligned_zero_residue` — NOT EXECUTED.**

The negative control requires the production `loadCpmWasm` to succeed
inside vitest's `node` environment. It does not, for the reasons in
§1 and §13. Under the milestone's strict rules, both routes to
unblock the loader are forbidden. Per the brief's explicit stop
condition (*"loadCpmWasm cannot be used without modifying production
code"*), Track A halts here and documents the blocker via the probe
test instead.

**Interpretation:** the JS-translator-only hypothesis from B2.12A.7 is
**neither confirmed nor falsified at the real boundary** in this
milestone. The Track B memo is correspondingly marked
`[UNPROVEN-AT-BOUNDARY]` throughout.

---

## 9. Residue-Triggering Case Result

**`b2_12a_8_real_wasm_481_min_duration_preserves_kernel_minute` — NOT EXECUTED.**

Reason: same boundary loader blocker (§8).

The B2.12A.7 Rust-side synthetic prediction is preserved:
`run_schedule_temporal` returns `early_finish_minute = 481` exactly
(B2.12A.7 F12). Real-boundary confirmation deferred to B2.12A.8.1.

---

## 10. FS Lag Chain Result

**`b2_12a_8_real_wasm_fs_lag_chain_no_drift` — NOT EXECUTED.**

Reason: §8 blocker.

B2.12A.7 Rust-side synthetic evidence (F13) shows zero drift at the FS
seam. Real-boundary confirmation deferred.

---

## 11. Calendar Gap Result

**`b2_12a_8_real_wasm_calendar_gap_resume_byte_identical` — NOT EXECUTED.**

Reason: §8 blocker.

B2.12A.7 Rust-side synthetic evidence (F10) pins the kernel-side
gap-resume to the exact gap-end minute. Real-boundary confirmation of
calendar interval `Vec<(i64, i64)>` serialization deferred.

---

## 12. Fractional Minute Sweep Result

**`b2_12a_8_real_wasm_no_fractional_minutes_anywhere` — NOT EXECUTED.**

Reason: §8 blocker.

B2.12A.7 Rust-side synthetic evidence (F11) shows kernel-side
integer-exact `i64` minutes. The BigInt → JS-number narrowing concern
across the boundary remains **unverified** for the durations in the
brief's sweep.

---

## 13. Track B Memo Status

**File added:**
[docs/milestones/W5B-B2.12A.8-projection-normalization-design.md](W5B-B2.12A.8-projection-normalization-design.md)
(separate file from this milestone doc, per Gemini review).

Track B is **memo-only**:

- No production code edited.
- No test scaffolding added.
- No feature flags proposed.
- No single design recommended as approved.
- Each candidate is marked `[PROVEN-SYNTHETIC]`,
  `[UNPROVEN-AT-BOUNDARY]`, or `[UNPROVEN]`.
- Future fixes are split into two distinct milestones (B2.12A.9 float
  unit normalization, B2.12A.10 day-bucket symmetry).
- Track B explicitly cites Track A test names (and their TODO status)
  rather than presupposing boundary evidence.

---

## 14. Safety Confirmation

- AI003 remains **BLOCKED at the live cutover gate.** Nothing in this
  milestone changes that.
- **No AI003 fixture was read.**
- **No schedule output was produced or changed.**
- **No production code was modified.** Specifically:
  - No `TemporalScheduleTranslator` change.
  - No `SlotScheduleTranslator` change.
  - No `ProjectionAdapter` change.
  - No `TemporalCandidateComparator` change.
  - No `loadCpmWasm.ts` change.
  - No `worker.ts` change.
  - No `cpm-kernel/src/**` change.
  - No `cpm-wasm/src/**` change.
  - No WASM FFI binding change.
  - No protocol contract change.
- **No gate, tolerance, authority, fallback, rollback, persistence,
  UAT, or production flag was modified or activated.**
- **No `unsupportedFeatureFlags` was activated.**
- **No CI workflow was modified.**
- **No default test script was modified.**
- **No vitest project config was modified.**
- **No `vi.mock` was used on any WASM/boundary module in the new
  harness.**

---

## 15. Recommended Next Milestones

Strictly future. Not part of B2.12A.8. Listed in recommended execution
order:

1. **B2.12A.8.1 — Real-WASM Loader Harness Wiring.** Sanctioned
   test-only mechanism to load the cpm-wasm artifact from vitest's
   `node` environment without modifying production. Two acceptable
   shapes (the milestone selects and justifies one):

   - **Shape (a):** Add a test-only loader file under
     `packages/worker/tests/integration/` that calls
     `WebAssembly.instantiate` on the `.wasm` artifact directly,
     bypassing the bundler-target glue, and re-exposes the boundary
     functions. Does not modify production. Does not modify the
     default vitest config.
   - **Shape (b):** Add `vite-plugin-wasm` to a **separate**
     integration-only vitest config (e.g. `vitest.integration.config.ts`)
     used only by an opt-in script. The default vitest config remains
     untouched. The integration script is **not** added to the default
     `test` npm script.

   Unblocks the six Track A `it.todo` scenarios in
   [w5b-b2-12a-8-real-wasm-boundary.test.ts](../../packages/worker/tests/integration/w5b-b2-12a-8-real-wasm-boundary.test.ts).

2. **B2.12A.8.2 — Cross-Translator Parity Test (synthetic).** Feed
   `SlotScheduleTranslator` and `TemporalScheduleTranslator` with
   semantically-equivalent kernel outputs and assert
   `NormalizedScheduleFacts` equality on every axis. Documents seam α
   as a parity failure. No production change.

3. **B2.12A.8.3 — Downstream `earlyFinishDate` Consumer Audit
   (read-only).** Catalogues UI, export, and persistence consumers of
   `earlyFinishDate` and their interpretation of the field's semantics.
   Doc-only.

4. **B2.12A.9 — Float Unit Normalization.** Implements Track B
   Candidate A2 (unit-tag at translator boundary). Lower blast radius.
   Conditional on B2.12A.8.1 + 8.2 outcomes.

5. **B2.12A.10 — Day-Bucket Symmetry.** Implements Track B Candidate
   B3 (floor + semantic rename). Higher blast radius. Conditional on
   B2.12A.8.1 + 8.2 + 8.3 outcomes. **Must not** be merged with
   B2.12A.9.

---

## Appendix A — Files Added in This Milestone

| Path | Purpose | LOC |
| --- | --- | --- |
| [`packages/worker/tests/integration/README.md`](../../packages/worker/tests/integration/README.md) | Directory-purpose note; integration test rules | ~20 |
| [`packages/worker/tests/integration/w5b-b2-12a-8-real-wasm-boundary.test.ts`](../../packages/worker/tests/integration/w5b-b2-12a-8-real-wasm-boundary.test.ts) | Track A harness — 1 probe test + 6 `it.todo` placeholders | ~135 |
| [`docs/milestones/W5B-B2.12A.8-real-wasm-boundary-confirmation-and-design.md`](W5B-B2.12A.8-real-wasm-boundary-confirmation-and-design.md) | This milestone document | — |
| [`docs/milestones/W5B-B2.12A.8-projection-normalization-design.md`](W5B-B2.12A.8-projection-normalization-design.md) | Track B conditional design memo | — |

**Production files modified:** 0.
**Existing tests modified:** 0.
**CI workflows modified:** 0.
**Vitest configs modified:** 0.

## Appendix B — Test Commands & Results

```text
$ git status --short
?? docs/milestones/W5B-B2.12A.8-projection-normalization-design.md
?? docs/milestones/W5B-B2.12A.8-real-wasm-boundary-confirmation-and-design.md
?? packages/worker/tests/integration/

$ pnpm -C packages/worker exec vitest run \
    tests/integration/w5b-b2-12a-8-real-wasm-boundary.test.ts
 ✓ tests/integration/w5b-b2-12a-8-real-wasm-boundary.test.ts  (7 tests | 6 skipped)
 Test Files  1 passed (1)
      Tests  1 passed | 6 todo (7)

$ pnpm -C packages/worker exec tsc --noEmit
(no output — clean)
```

---

**END W5B-B2.12A.8.**
**STOP CONDITION HONORED: loadCpmWasm cannot be used in vitest without forbidden modifications.**
**No production code change attempted. AI003 remains BLOCKED.**
