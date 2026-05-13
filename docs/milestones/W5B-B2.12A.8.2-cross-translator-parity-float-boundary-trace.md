# W5B-B2.12A.8.2 — Cross-Translator Parity & Float-Bearing Boundary Trace

**Status:** Complete (test-only observation milestone).
**Predecessors:** W5B-B2.12A.7 (synthetic mechanistic trace),
W5B-B2.12A.8.1 (real-WASM loader harness).
**Successor candidate:** W5B-B2.12A.9 (float-unit normalisation policy).

---

## 1. Executive Summary

B2.12A.8.1 proved that the real `cpm-wasm` artifact loads through the
production `loadCpmWasm` path under the sanctioned integration config
and that integer-minute boundary fidelity holds for single-task and
linear chain inputs. It did **not** exercise float arithmetic, because
single-task scenarios collapse to `totalFloat = 0`.

This milestone extends the harness with a synthetic diamond
(`A→B→D, A→C→D`) that forces deterministic non-zero
`totalFloatMinutes` and `freeFloatMinutes` at the real-WASM boundary,
then routes the output through the production `TemporalScheduleTranslator`
and `ProjectionAdapter`. A separate synthetic-only path additionally
drives the `SlotScheduleTranslator` so the two translator routes can be
compared on equivalent-by-construction inputs.

Six tests run; six pass. Findings: the real WASM kernel preserves
integer-minute float exactly; the `1.00208333` unit pattern from the
B2.12A.7 synthetic trace is reproduced at the projection layer using
real-WASM-compatible facts; slot-vs-temporal date parity is **not
achievable** under a continuous calendar by construction, and the
divergence is recorded as evidence rather than papered over.

No production code, configuration, CI script, or fixture was touched.

## 2. Scope Confirmation

| Constraint                                                | Status      |
| --------------------------------------------------------- | ----------- |
| Test-only observation; no fix implemented                 | Confirmed   |
| No production `src/**/*.ts` or `src/**/*.tsx` modified    | Confirmed   |
| No Rust source modified                                   | Confirmed   |
| No `packages/worker/vitest.config.ts` modified            | Confirmed   |
| No `packages/worker/vitest.integration.config.ts` modified | Confirmed |
| No CI workflow / default test script modified             | Confirmed   |
| No production `loadCpmWasm` modified                      | Confirmed   |
| No `TemporalScheduleTranslator` / `SlotScheduleTranslator` modified | Confirmed |
| No `ProjectionAdapter` modified                           | Confirmed   |
| No `TemporalCandidateComparator` modified                 | Confirmed   |
| No protocol contract / WASM FFI modified                  | Confirmed   |
| No AI003 fixture access                                   | Confirmed   |
| No `vi.mock` of any WASM / boundary module                | Confirmed   |

## 3. B2.12A.8.1 Findings Carried Forward

- Real WASM preserves integer minute coordinates.
- 481-minute duration preserved at boundary.
- FS + 60 min lag has zero drift across boundary.
- Calendar gap finish byte-identical to B2.12A.7 Rust F10.
- Intra-wall-day finish confirms production `TemporalScheduleTranslator`
  floor/ceil day-bucket artifact.

These hold in this milestone; this milestone does not retest them.

## 4. Gemini Architecture Review Carried Forward

- Use a synthetic diamond graph to force non-zero float.
- Use the isolated real-WASM integration config from B2.12A.8.1.
- Compare `TemporalScheduleTranslator` and `SlotScheduleTranslator` outputs.
- Do not modify production translators.
- Do not fix discrepancies in this milestone.

All four requirements followed.

## 5. Synthetic Diamond Graph Design

```
            ┌──── B (longer path) ────┐
            │                         ▼
A (start) ──┤                         D (join / end)
            │                         ▲
            └──── C (slack path) ─────┘
```

All edges are FS with `lagMinutes = 0`. The longer path B forces a
deterministic positive total float on the slack path C.

| Variant            | dA  | durB | durC | dD  | Expected C totalFloat (min) |
| ------------------ | --- | ---- | ---- | --- | --------------------------- |
| Clean multiple     | 480 | 2400 | 1440 | 480 | **960** (2 × MPD)           |
| Fractional trigger | 480 | 1921 | 1440 | 480 | **481** (¬ multiple of MPD) |

## 6. Calendar Definition and Expected Float Math

**Calendar:** `intervals: [[0, 100_000]]` on `projectCalendarId = "project"`.
Continuous working time — every minute is working. Documented in the
harness preamble. The "8-hour workday = 480 minutes" convention is a
**JS-side** convention applied by `ProjectionAdapter` via the
`minutesPerDay = 480` argument; the kernel operates on raw minutes.

The brief permits a continuous calendar where the kernel does not
require a discontinuous one to produce non-zero float. The diamond
above produces non-zero float on a continuous calendar without any
calendar gap.

**Closed-form math** (FS-0-lag, continuous calendar):

```
A.ES = 0
A.EF = dA

B.ES = dA;          B.EF = dA + durB
C.ES = dA;          C.EF = dA + durC

D.ES = max(B.EF, C.EF) = dA + max(durB, durC)
D.EF = D.ES + dD

Critical path: A → B → D  (assuming durB > durC)
C.LF = D.ES = dA + durB
C.LS = C.LF − durC = dA + (durB − durC)
C.totalFloat = C.LS − C.ES = durB − durC
C.freeFloat  = D.ES − C.EF = (dA + durB) − (dA + durC) = durB − durC
```

For FS-0-lag with a single immediate successor, `freeFloat == totalFloat`
on the slack path.

## 7. Real-WASM Float-Bearing Boundary Results

**Test 1** — `b2_12a_8_2_real_wasm_diamond_generates_non_zero_float`:

Clean-multiple diamond yielded (from real `calculate_schedule_minute`):

| Task | ES   | EF   | LS   | LF   | totalFloat | freeFloat | critical |
| ---- | ---- | ---- | ---- | ---- | ---------- | --------- | -------- |
| A    | 0    | 480  | 0    | 480  | 0          | 0         | true     |
| B    | 480  | 2880 | 480  | 2880 | 0          | 0         | true     |
| C    | 480  | 1920 | 1440 | 2880 | **960**    | **960**   | false    |
| D    | 2880 | 3360 | 2880 | 3360 | 0          | 0         | true     |

All numeric fields finite and integer. `C.totalFloat = durB − durC =
2400 − 1440 = 960` minutes — matches closed-form exactly. C is
correctly marked non-critical; A/B/D critical.

**Test 5** — `b2_12a_8_2_float_parity_fractional_trigger` (raw boundary):

Fractional-trigger diamond yielded `C.totalFloatMinutes = 481` (=
1921 − 1440) exactly. Integer; finite; no fractional residue at the
raw boundary.

**Proven at real-WASM boundary:** the temporal kernel produces exact
integer float minutes on a deterministic synthetic diamond, for both
clean (960) and pathological (481) values.

## 8. Temporal Translator / ProjectionAdapter Results

**Test 2** — `b2_12a_8_2_temporal_projection_reproduces_float_unit_pattern`:

`TemporalScheduleTranslator` passes float through unchanged
(minutes-as-minutes). For the clean diamond:

```
boundary.C.totalFloatMinutes        = 960
temporalFacts.C.totalFloatMinutes   = 960    (passthrough)
projected.C.totalFloatMinutes       = 960 / 480 = 2.0   (clean)
```

Then a **projection-only** synthetic fact with `totalFloatMinutes = 481`
was driven through `ProjectionAdapter` without touching the kernel or
translator:

```
fact.totalFloatMinutes = 481
projected.totalFloatMinutes = 481 / 480 ≈ 1.00208333…
```

**Test 5 (projection leg)** — same fractional pattern reproduced
end-to-end via real WASM → temporal translator → projection:

```
real-WASM.C.totalFloatMinutes  = 481
temporalFacts.C.totalFloatMinutes = 481   (still integer at facts layer)
projected.C.totalFloatMinutes   ≈ 1.00208333
```

**Proven in projection-only path:** `ProjectionAdapter` is the sole
producer of fractional-minute values; it divides
`totalFloatMinutes` (in working minutes) by `minutesPerDay` without
rounding, producing `481 / 480 ≈ 1.00208333` for any 481-minute float
input regardless of whether the float originated from the real kernel
or from a synthetic fact.

## 9. Slot vs Temporal Translator Parity Results

**Test 3** — `b2_12a_8_2_slot_vs_temporal_translator_float_parity`:

Strategy: the slot ABI (v1, `calculate_schedule`) and the temporal ABI
(v2, `calculate_schedule_minute`) take different request shapes. Exact
same-payload parity cannot be invoked without a production ABI change
(out of scope). Per the brief, the harness uses the "nearest equivalent
normalized facts" comparison: a synthesised slot `ScheduleResponse`
(day-offset units, float in workdays) is fed to
`SlotScheduleTranslator` and compared to the real-WASM minute response
fed to `TemporalScheduleTranslator`.

### 9.1 Float parity at the facts layer — **Proven**

Both translators store float in **working minutes** at the
`NormalizedScheduleFact` layer:

```
slotFacts.C.totalFloatMinutes      = 2 (days) × 480 = 960  ✓
temporalFacts.C.totalFloatMinutes  = 960               (passthrough)  ✓
```

### 9.2 Float parity after projection — **Proven (clean multiple)**

```
slotProjected.C.totalFloatMinutes      = 960 / 480 = 2.0
temporalProjected.C.totalFloatMinutes  = 960 / 480 = 2.0
→ identical
```

### 9.3 Date parity — **Not proven** (incompatible by construction)

`SlotScheduleTranslator` interprets its `earlyStartMinutes` field as
**workday-offset** (multiplied by `MS_PER_DAY` directly), so task B
lands on calendar **day 1**. `TemporalScheduleTranslator` buckets
**wall-minute** coordinates by 1440 (floor/ceil), so B at wall-minute
480 lands on calendar **day 0** with a continuous calendar.

Under a continuous calendar these models are **incompatible by
construction** — a 480-minute workday does not consume a 1440-minute
wall-day. Achieving same-payload date parity requires a calendar where
each workday occupies a full wall-day (1440-minute working blocks).
That calendar regime is outside this milestone's scope.

The divergence is recorded explicitly in test 3:

```
slotFacts.B.earlyStartDate − startMs        = 1 × MS_PER_DAY  (day 1)
temporalFacts.B.earlyStartDate − startMs    = 0 × MS_PER_DAY  (day 0)
```

### 9.4 freeFloat asymmetry — **Documented**

```
slotFacts.C.freeFloatMinutes      = 0   (slot kernel does not compute freeFloat)
temporalFacts.C.freeFloatMinutes  = 960 (temporal kernel produces freeFloat)
```

This is documented behaviour in `SlotScheduleTranslator`, not a defect
introduced here.

## 10. Clean-Multiple Control Result

**Test 4** — `b2_12a_8_2_float_parity_control_clean_multiple`:

Synthetic facts with `totalFloatMinutes = 960` projected via
`ProjectionAdapter` yield exactly `2.0` workdays through both routes.
The real-WASM clean diamond projects identically. No unexpected
fractional residue.

**Proven in projection-only path:** clean-multiple floats survive the
day-offset projection without fractional residue.

## 11. Fractional Trigger Result

**Test 5** — `b2_12a_8_2_float_parity_fractional_trigger`:

The B2.12A.7 synthetic `1.00208333…` residue pattern was reproduced
end-to-end through real-WASM diamond → `TemporalScheduleTranslator` →
`ProjectionAdapter`. The integer-minute discipline holds through the
boundary and translator; the fractional residue is introduced **only**
at the projection step (`totalFloatMinutes / minutesPerDay = 481 / 480`).

**Proven at real-WASM boundary + projection-only path:** the unit
conversion in `ProjectionAdapter` is the deterministic source of the
fractional-workday pattern when minute float is not a multiple of
`minutesPerDay`.

## 12. What Is Proven

- **Real-WASM boundary** — Temporal kernel produces exact integer
  `totalFloat` and `freeFloat` on a synthetic diamond, equal to the
  closed-form expression `durB − durC` (verified for 960 and 481).
- **Real-WASM boundary** — `freeFloat == totalFloat` on the slack
  path of an FS-0-lag diamond with single successor.
- **Projection-only path** — `ProjectionAdapter` produces clean
  integer workdays for float multiples of `minutesPerDay` (960 → 2.0).
- **Projection-only path** — `ProjectionAdapter` produces
  `481 / 480 ≈ 1.00208333` for the B2.12A.7 synthetic trigger value,
  via both the real-WASM diamond route and a direct projection-only
  fact.
- **Translator-layer float parity** — slot and temporal translators
  both store float in **working minutes**; for the diamond they agree
  exactly on `C.totalFloatMinutes = 960`.

## 13. What Is Not Proven

- **Slot-vs-temporal date parity under a continuous calendar.**
  Incompatible by construction; documented divergence rather than
  asserted equality.
- **Slot ABI v1 boundary fidelity for float-bearing inputs.** The
  legacy slot kernel ABI is not invoked in this milestone — the slot
  translator is exercised only with synthesised equivalent responses.
- **freeFloat parity.** Slot kernel does not produce freeFloat; the
  slot translator forces zero. Temporal kernel produces freeFloat
  natively. This asymmetry is documented, not closed.
- **AI003 reproduction.** AI003 remains blocked; no fixture accessed.
- **Multi-calendar / calendar-gap interaction with float.** Diamond
  uses a single continuous calendar.
- **Authority flip / persistence / UAT / production / gates.** All
  remain untouched; none enabled.

## 14. Safety Confirmation

- AI003 remains blocked.
- No AI003 fixture used.
- No production code change.
- No production translator change.
- No `ProjectionAdapter` change.
- No comparator change.
- No Rust kernel change.
- No WASM FFI change.
- No protocol contract change.
- No global `vitest.config.ts` change.
- No `vitest.integration.config.ts` change.
- No CI / default script change.
- No schedule output change.
- No gate change.
- No tolerance change.
- No authority apply change.
- No rollback change.
- No persistence enablement.
- No UAT / production enablement.
- No `unsupportedFeatureFlags` activation.

## 15. Recommended Next Milestones

1. **W5B-B2.12A.9 — Float unit normalisation policy.** Decide whether
   `ProjectionAdapter` should round, truncate, or preserve fractional
   workdays when the underlying minute float is not a multiple of
   `minutesPerDay`. The policy must be specified before any UI or
   persistence layer renders these values. Inputs: this milestone's
   evidence + B2.12A.7 mechanistic trace.

2. **W5B-B2.12A.10 — Slot/temporal date parity under a wall-day
   workday calendar.** Exercise a calendar where each workday is a
   contiguous 1440-minute working block, eliminating the
   continuous-calendar mismatch documented in §9.3. Determines whether
   slot day-offset and temporal wall-minute bucketing agree under the
   workday-as-wall-day convention.

3. **W5B-B2.12A.11 — freeFloat asymmetry resolution.** Decide whether
   the slot kernel should compute freeFloat or whether downstream
   consumers must read freeFloat exclusively from the temporal
   path.

---

## Files Added (this milestone)

- `packages/worker/tests/integration/w5b-b2-12a-8-2-float-boundary-parity.itest.ts`
- `docs/milestones/W5B-B2.12A.8.2-cross-translator-parity-float-boundary-trace.md`
  (this doc)

## Files Modified

None. No production source, no translator, no projection adapter, no
config, no CI, no protocol, no Rust, no WASM FFI, no fixture.

## Test Commands and Results

```
$ pnpm -C packages/worker exec vitest -c vitest.integration.config.ts run \
    tests/integration/w5b-b2-12a-8-2-float-boundary-parity.itest.ts

 ✓ tests/integration/w5b-b2-12a-8-2-float-boundary-parity.itest.ts  (6 tests) 54ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

Default suite (unchanged):

```
$ pnpm -C packages/worker exec vitest run
 Test Files  67 passed (67)
      Tests  1319 passed (1319)
```

Typecheck:

```
$ pnpm -C packages/worker exec tsc --noEmit
(exit 0 — clean)
```
