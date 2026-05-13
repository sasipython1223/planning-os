# W5B-B2.12A.8.1 — Real-WASM Loader Harness Wiring

**Status:** Complete
**Predecessors:** W5B-B2.12A.7 (synthetic mechanistic trace — accepted),
W5B-B2.12A.8 (real-WASM boundary — blocked at loader)
**Successor candidate:** W5B-B2.12A.8.2 (cross-translator parity tests)

---

## 1. Executive Summary

B2.12A.8 stopped because the production WASM loader could not be exercised
under the default vitest configuration: `await import("@planner/engine")`
resolves to a wasm-pack `--target bundler` artifact, which Vite refuses to
load without `vite-plugin-wasm` + top-level-await support. The brief
forbids modifying production code, the global vitest config, CI, the
protocol, the Rust kernel, the WASM FFI, or any scheduling logic.

This milestone delivers a **sanctioned, isolated, on-demand** integration
harness that satisfies all of those constraints. A dedicated
`vitest.integration.config.ts` plus an `.itest.ts` file extension carries
the real wasm-pack artifact through the production loader into the real
`cpm_kernel::run_schedule_temporal` and back through the production
translator and projection adapter — without altering the default test run.

All six B2.12A.8 Track A required scenarios now execute and pass at the
real boundary. A loader smoke test is included as test #1 (7 tests total).

## 2. Scope Confirmation

| Constraint                                                | Status      |
| --------------------------------------------------------- | ----------- |
| No production source modified                             | Confirmed   |
| No global `packages/worker/vitest.config.ts` modified     | Confirmed   |
| No CI / default `test` script modified                    | Confirmed   |
| No protocol / WASM FFI / Rust kernel source modified      | Confirmed   |
| No scheduling production logic modified                   | Confirmed   |
| No `vi.mock` of any WASM / boundary module                | Confirmed   |
| No manual JS reimplementation of Rust algorithms          | Confirmed   |
| No AI003 fixture accessed                                 | Confirmed   |
| No rebuild of `cpm-wasm` embedded in test execution       | Confirmed   |

## 3. B2.12A.8 Stop Condition Carried Forward

From B2.12A.8: the moment a test invoked production `loadCpmWasm`, vitest
threw `"ESM integration proposal for Wasm" is not supported currently. Use
vite-plugin-wasm or other community plugins to handle this`. No further
boundary observation was possible without violating one of the forbidden
edits. B2.12A.8.1 was authorised to install plugin support **only** in an
isolated integration config.

## 4. Gemini Architecture Review Carried Forward

Gemini-approved approach: a dedicated `vitest.integration.config.ts`
co-located with the default config but explicitly invoked, wiring
`vite-plugin-wasm` + `vite-plugin-top-level-await`. No change to default
suite, no CI wiring, no production import path changes.

## 5. Harness Architecture

```
test (.itest.ts)
   │
   ▼
ensureRealWasmLoaded()  ← helpers/wasmTestLoader.ts (test-only)
   │
   ▼
PRODUCTION loadCpmWasm.ts (unmodified)
   │
   ▼
import("@planner/engine")  →  packages/cpm-wasm/pkg/cpm_wasm.js
                                (wasm-pack --target bundler)
   │  resolved via vite-plugin-wasm + vite-plugin-top-level-await
   │  (loaded by vitest.integration.config.ts ONLY)
   ▼
REAL Rust kernel: calculate_schedule_minute → run_schedule_temporal
   │
   ▼
JS response  →  PRODUCTION TemporalScheduleTranslator (unmodified)
              →  PRODUCTION projectFacts             (unmodified)
   │
   ▼
test assertions
```

The harness never bypasses the production loader. It does not reimplement
any Rust logic. It does not stub or mock any boundary module.

## 6. Dedicated Integration Config

File: `packages/worker/vitest.integration.config.ts`

Plugins: `vite-plugin-wasm`, `vite-plugin-top-level-await`.
Alias map: copies the default config's `@planner/protocol/*` aliases so
production sources can be imported by the harness unchanged.
Test include: `tests/integration/**/*.itest.ts`.
Environment: `node`.

Integration tests use the **`.itest.ts` extension** (not `.test.ts`) so
that the default vitest config — which globs `**/*.{test,spec}.ts` — does
not pick them up. This preserves the rule that the harness is not wired
into the default test run while leaving `vitest.config.ts` untouched.

## 7. Build Precondition

`packages/cpm-wasm/pkg/cpm_wasm_bg.wasm` and `cpm_wasm.js` must be present
and current relative to `packages/cpm-wasm/src/lib.rs`. If absent or stale,
rebuild **manually** with `pnpm -C packages/cpm-wasm run build` outside the
test run. The harness does not invoke a rebuild. The harness does not
silently accept a stale artifact — `ensureRealWasmLoaded()` throws if any
required export (`calculate_schedule`, `calculate_schedule_minute`,
`analyze_float_paths`) is missing.

## 8. Tests Implemented

File: `packages/worker/tests/integration/w5b-b2-12a-8-real-wasm-boundary.itest.ts`

| #   | Name                                                                       | Purpose                                                                   |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | `b2_12a_8_1_real_wasm_loader_smoke`                                        | Sanity: integration config loads and executes real WASM                   |
| 2   | `b2_12a_8_real_wasm_clean_day_aligned_zero_residue`                        | Negative control — clean integer day end-to-end                           |
| 3   | `b2_12a_8_real_wasm_481_min_duration_preserves_kernel_minute`              | Reproduces 481 verbatim at real boundary                                  |
| 4   | `b2_12a_8_real_wasm_intra_wall_day_finish_produces_plus_one_day_bucket`    | Confirms B2.12A.7 F6 on real-WASM data via production translator         |
| 5   | `b2_12a_8_real_wasm_fs_lag_chain_no_drift`                                 | FS + 60 min lag survives boundary integer-exact                           |
| 6   | `b2_12a_8_real_wasm_calendar_gap_resume_byte_identical`                    | Reproduces B2.12A.7 Rust F10 (`90 min → finish=1530`) at boundary         |
| 7   | `b2_12a_8_real_wasm_no_fractional_minutes_anywhere`                        | Sweep over 10 durations × 6 fields → all integer-finite; finish−start=dur |

## 9. Test Results

Run command:
```
pnpm -C packages/worker exec vitest \
  -c vitest.integration.config.ts run \
  tests/integration/w5b-b2-12a-8-real-wasm-boundary.itest.ts
```

Output:
```
 RUN  v1.6.1 /home/sasi1223/dev/planning-os/packages/worker

 ✓ tests/integration/w5b-b2-12a-8-real-wasm-boundary.itest.ts  (7 tests) 56ms

 Test Files  1 passed (1)
      Tests  7 passed (7)
   Duration  445ms
```

Default suite (unchanged) — `pnpm -C packages/worker exec vitest run`:
```
 Test Files  67 passed (67)
      Tests  1319 passed (1319)
   Duration  2.96s
```

Typecheck — `pnpm -C packages/worker exec tsc --noEmit`: clean (exit 0).

## 10. Boundary Findings

Confirmed at the real WASM boundary:

- **F-Boundary-1 (integer minute preservation):** Every numeric field of
  every result for durations `{1, 59, 60, 61, 479, 480, 481, 1439, 1440,
  1441}` is finite and integer; no BigInt → Number narrowing introduces
  fractional residue.
- **F-Boundary-2 (kernel half-open semantics intact):** For each duration
  `d`, `earlyFinishMinute − earlyStartMinute === d`. The boundary does not
  alter the kernel's half-open `[start, start+duration)` convention.
- **F-Boundary-3 (FS + lag drift-free):** B's `earlyStartMinute === A's
  earlyFinishMinute + lagMinutes` exactly. No drift across the JS↔WASM
  hop.
- **F-Boundary-4 (intra-wall-day finish → +1 day bucket):** B2.12A.7 F6
  reproduced via the **production** `TemporalScheduleTranslator`: start
  600 / finish 1080 (both same wall-day) produce `earlyStartDate = day 0`
  and `earlyFinishDate = day 0 + MS_PER_DAY`. The +1-day bucket residue is
  a translator artifact (floor/ceil bucketing), not a kernel artifact.
- **F-Boundary-5 (calendar gap resume byte-identical):** A 90-minute task
  on calendar `[0,60] + [1500,5000]` finishes at minute **1530** — exact
  match with B2.12A.7 Rust F10. Real WASM does not perturb the resume
  point by even one minute.
- **F-Boundary-6 (clean wall-day input → zero residue end-to-end):** A
  1440-minute task in a continuous calendar yields zero fractional residue
  through translator AND projection adapter. The +1-day residue observed
  in F-Boundary-4 is **only** triggered by intra-wall-day finishes; it is
  not a generic boundary defect.

## 11. What Is Proven

- The production WASM loader works with the real wasm-pack bundler
  artifact under a Vite-compatible config.
- The real Rust kernel's minute-domain outputs cross the JS boundary as
  exact integers with no fractional residue, across a representative
  duration sweep.
- Production `TemporalScheduleTranslator` and `projectFacts` are
  deterministic and correct on real-WASM output for the six B2.12A.8
  scenarios.
- B2.12A.7 synthetic findings F6, F8, F10 are now boundary-confirmed on
  real WASM.
- The intra-wall-day +1-day bucket effect is real, reproducible at the
  boundary, and isolated to the translator's ceil-bucketing of
  `earlyFinishMinute`.

## 12. What Is Not Proven

- **Total-float residue with a float-bearing task:** all single-task
  scenarios collapse to `totalFloat = 0`. A multi-path graph is required
  to exercise float arithmetic at the boundary. Deferred to B2.12A.8.2.
- **Multi-calendar / per-task calendar divergence:** harness uses a single
  `project` calendar (plus one split variant). Cross-calendar lag and
  per-task calendar inheritance not exercised.
- **Actuals / data-date interactions:** `dataDateMinute = 0` throughout;
  no actual-start, actual-finish, or in-progress task scenarios.
- **AI003 reproduction:** AI003 fixture is explicitly not accessed by this
  milestone. AI003 root-cause investigation remains blocked until a
  separately-sanctioned milestone re-enables fixture access.

## 13. Safety Confirmation

- AI003 fixture access: **NOT performed.**
- Production `loadCpmWasm.ts`: **NOT modified.**
- Production `TemporalScheduleTranslator.ts`: **NOT modified.**
- Production `ProjectionAdapter.ts`: **NOT modified.**
- Global `packages/worker/vitest.config.ts`: **NOT modified.**
- `packages/worker/tsconfig.json`: **NOT modified.**
- `packages/worker/package.json` `scripts`: **NOT modified** (only
  `devDependencies` added: `vite-plugin-wasm`, `vite-plugin-top-level-await`).
- CI workflows: **NOT modified.**
- Protocol / Rust kernel / WASM FFI source: **NOT modified.**
- `vi.mock` of any WASM / boundary module: **NOT used.**
- Manual JS reimplementation of Rust algorithms: **NOT used.**
- `cpm-wasm` rebuild from inside test execution: **NOT triggered.**

## 14. Recommended Next Milestone

**W5B-B2.12A.8.2 — Cross-translator parity & float-bearing boundary
trace.** Extend the harness with a multi-path graph (≥2 chains converging)
so total-float and free-float can be observed at the boundary; assert
parity between B2.12A.7 synthetic mechanistic trace values and real-WASM
values for the same input. Continues to use the sanctioned integration
config; remains local/on-demand.

Subsequent: **W5B-B2.12A.9** float unit normalisation (kernel minutes vs
business-day float reporting) and **W5B-B2.12A.10** day-bucket symmetry
per the Track B memo (floor-vs-ceil end-bucket consistency).

---

## Files Touched (this milestone)

Added:
- `packages/worker/vitest.integration.config.ts`
- `packages/worker/tests/integration/helpers/wasmTestLoader.ts`
- `packages/worker/tests/integration/w5b-b2-12a-8-real-wasm-boundary.itest.ts`
  (replaces the prior probe/`it.todo` placeholder from B2.12A.8)
- `docs/milestones/W5B-B2.12A.8.1-real-wasm-loader-harness-wiring.md` (this doc)

Modified:
- `packages/worker/package.json` — `devDependencies` only:
  `vite-plugin-wasm@^3.3.0`, `vite-plugin-top-level-await@^1.4.4`.
- `packages/worker/tests/integration/README.md` — documents
  `.itest.ts` convention and the sanctioned integration config command.

No production source, no global vitest config, no CI workflow, no
protocol, no Rust kernel, no WASM FFI, and no scheduling logic was
modified.
