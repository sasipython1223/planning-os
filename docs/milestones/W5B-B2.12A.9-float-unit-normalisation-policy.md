# Milestone: W5B-B2.12A.9 — Float Unit Normalisation Policy

## Executive Summary

This milestone establishes the canonical policy for float-unit normalisation in the
Planning OS projection pipeline. It follows directly from milestone B2.12A.8.2, which
proved that a task duration of 481 minutes projects to `481 / 480 = 1.00208333…`
workdays when passed through `ProjectionAdapter`.

**Recommended policy:** Preserve integer minutes as the canonical internal value at all
layers below the projection boundary. Treat workday conversion as a display/projection
concern only. No normalisation, rounding, or truncation must occur inside the engine,
WASM boundary, or translator. Rounding or mixed-unit formatting is permitted exclusively
in `ProjectionAdapter` and downstream UI/reporting layers, subject to a future
implementation milestone.

No production code is changed by this milestone.

---

## Background

Planning OS follows a strict layered architecture:

```
React UI → Web Worker (authoritative state) → Translator / Engine Adapter → WASM boundary → Rust CPM kernel
```

The layers carry the following responsibilities for numeric values:

| Layer | Responsibility |
|---|---|
| Rust CPM kernel | Deterministic scheduling; operates on integer minutes |
| WASM boundary | Transmits integer minutes without transformation |
| TemporalScheduleTranslator | Keeps integer minutes; no unit conversion |
| ProjectionAdapter | Converts minutes → workdays for display/reporting |
| React UI | Reads projected workday value; must not perform scheduling logic |

Prior milestone B2.12A.8.2 established empirically that:

- The Real-WASM boundary preserves integer minutes exactly.
- The `481`-minute value remains exact at the WASM boundary.
- `TemporalScheduleTranslator` keeps integer float minutes.
- `ProjectionAdapter` converts using `minutes / minutesPerDay` where `minutesPerDay = 480`.
- `481 / 480` produces `1.00208333…`.
- No production code was changed by B2.12A.8.2.

---

## B2.12A.8.2 Findings Carried Forward

The following facts are accepted as the current state of the system:

1. **Integer minutes are canonical.** The Rust kernel and Web Worker authoritative state
   both operate on integer minute values. No fractional minutes exist at the engine level.

2. **Fractional workdays are a projection artefact.** The value `1.00208333` is not a
   kernel value; it is the result of dividing an integer minute count by `minutesPerDay`
   at the `ProjectionAdapter` boundary.

3. **The 481-minute example is representative.** Any task duration that is not an exact
   multiple of `minutesPerDay` will produce a fractional workday result. This is not a
   bug in the arithmetic; it is an inherent consequence of projecting discrete minutes
   into continuous workday units.

4. **No data loss has occurred.** The integer-minute canonical value is preserved
   throughout the pipeline up to and including the projection step.

---

## Problem Statement

When `ProjectionAdapter` converts `481` integer minutes to workdays it produces
`1.00208333…`. This fractional workday value is:

- Arithmetically correct.
- Potentially confusing to end users who expect a duration expressed as whole or
  neatly-rounded workdays.
- Potentially harmful if a downstream component accidentally treats the projected
  workday value as a new canonical input and passes it back to the engine.

The system currently has no explicit policy governing what the `ProjectionAdapter` or
the UI layer should do with fractional workday results. This milestone defines that
policy.

---

## Policy Options Considered

### Option A — Raw Fraction (status quo)

Leave the projected value as `1.00208333…` with no transformation after division.

- **Advantage:** No data loss; the fractional residue is visible to the user.
- **Advantage:** Simple to implement; requires no additional logic.
- **Disadvantage:** Poor user experience; fractional workdays are not meaningful in most
  scheduling contexts.
- **Disadvantage:** Risk that UI components round or truncate inconsistently without a
  defined policy.

### Option B — Standard Rounding

Round the projected workday value to a fixed number of decimal places (e.g. 2 d.p.),
yielding `1.00` for the `481`-minute example.

- **Advantage:** Cleaner display.
- **Disadvantage:** Masks fractional residue; `481` minutes and `480` minutes would both
  display as `1.00 days`, hiding one minute of schedule slippage.
- **Disadvantage:** Cumulative rounding errors if rounded values are reused in further
  calculations.

### Option C — Floor / Truncation

Truncate fractional workdays to the integer part, yielding `1` for the `481`-minute
example.

- **Advantage:** Whole-number display is intuitive.
- **Disadvantage:** Systematically discards residual minutes; a task of `479` minutes
  and a task of `1` minute would both truncate to `0` days, which is actively misleading.
- **Disadvantage:** Completely hides schedule slippage below the one-day threshold.

### Option D — Ceiling

Always round up to the next whole workday, yielding `2` for the `481`-minute example.

- **Advantage:** Conservative; never under-reports duration.
- **Disadvantage:** Heavily overstates short tasks. A `1`-minute task would project to
  `1` day, which is wrong by a factor of `480`.
- **Disadvantage:** Not suitable as a general policy.

### Option E — Mixed-Unit Formatting

Do not express duration in fractional workdays. Instead decompose into whole days plus
a remainder expressed in minutes or hours (e.g. `"1 day, 1 min"` for `481` minutes).

- **Advantage:** Exact; no information is lost.
- **Advantage:** Human-readable without ambiguity.
- **Disadvantage:** Requires a dedicated formatting function; increases UI complexity.
- **Disadvantage:** Sorting and comparison of mixed-unit strings require additional care.
- **Disadvantage:** Out of scope for this milestone; deferred to future implementation.

### Option F — Preserve Canonical Integer Minutes; Defer Display Policy

Keep the canonical value as integer minutes throughout the pipeline. Expose integer
minutes alongside the workday projection in `ProjectionAdapter` output. Allow the
product and UI layer to apply a display format appropriate to context (Options B, C, or
E above) without changing the engine or translator.

- **Advantage:** Separates concern cleanly; engine correctness is independent of
  display choice.
- **Advantage:** Does not force a single rounding policy onto all consumers.
- **Advantage:** Future UI or reporting changes require no engine change.
- **Disadvantage:** Requires `ProjectionAdapter` output to carry both `minutes` and
  `workdays` fields, which is a minor interface extension.

---

## Recommended Policy

> **Canonical internal representation must remain integer minutes at all layers up to
> and including `ProjectionAdapter` input.**
>
> **Workday conversion is a projection/display concern only.**
>
> **`ProjectionAdapter` must expose integer minutes alongside derived workday values,
> so that downstream consumers are never forced to reverse an imprecise division.**
>
> **No rounding, truncation, or normalisation is permitted at the engine, WASM
> boundary, translator, or adapter input layers.**
>
> **If the UI or a reporting consumer requires a rounded or mixed-unit display, that
> transformation must be applied as close to the point of display as possible, and the
> rounded value must never be passed back to the engine as a new input.**

This corresponds to **Option F** as the architectural baseline, with the door left open
for the product to select Option B (rounding) or Option E (mixed units) as the display
policy in a future milestone, applied exclusively in the UI/reporting layer.

---

## Rationale

1. **Determinism.** The Rust CPM kernel is deterministic only when it operates on
   integer minutes. Allowing rounded workday values to re-enter the engine would
   introduce floating-point non-determinism.

2. **Auditability.** Preserving the canonical integer-minute value at all internal
   layers means that every projected workday value can be traced back to an exact minute
   count without loss.

3. **Separation of concerns.** Schedule correctness (kernel) and schedule communication
   (UI/reporting) are different concerns. The recommended policy keeps them separated by
   assigning unit conversion to the projection layer and display formatting to the UI
   layer.

4. **Safety under composition.** When multiple projected values are composed (e.g.
   total project duration = sum of task durations), computing in integer minutes first
   and dividing once at the end is safer than summing pre-divided fractional workdays,
   because it avoids accumulation of division remainders.

5. **Forward compatibility.** If `minutesPerDay` changes (e.g. for a site operating a
   450-minute working day), no engine change is required; only the projection layer
   parameter changes. This is already true in the current design and must be preserved.

---

## Risks

### R1 — Masked schedule slippage (rounding risk)

If a future implementation milestone chooses to round or truncate the projected workday
value, fractional residues smaller than the rounding granularity will be invisible to
the user. For the `481`-minute example, rounding to two decimal places yields `1.00`,
hiding one minute of schedule slippage. If tasks are tightly packed against a shift
boundary or a non-working period, that hidden minute can cause a dependent task to
cascade into the next day, producing a much larger visible delay that the display value
failed to predict.

**Mitigation:** The recommended policy requires that integer minutes remain accessible
alongside any rounded display value, so that the system can always warn or recalculate
against the exact value.

### R2 — Contamination of engine input with projected values

If a UI component reads a projected (possibly rounded) workday value and writes it back
to the authoritative Web Worker state without converting back to integer minutes, the
engine will receive a corrupt duration. Repeated round-trip edits will accumulate drift.

**Mitigation:** Web Worker command handlers must validate that incoming duration values
are integer minutes. A future implementation milestone must include immutability tests
that assert the engine state before and after a UI-triggered update cycle.

### R3 — Multiple inconsistent display policies

Without a single defined display policy, different parts of the UI may format the same
duration differently (e.g. one component shows `1.00 days`, another shows `1 day`),
producing inconsistency.

**Mitigation:** The recommended display format (rounding precision or mixed units) must
be defined in a single shared formatting utility and applied consistently. This is
deferred to the implementation milestone that follows this policy decision.

### R4 — `minutesPerDay` configuration drift

If `minutesPerDay` is changed without updating all projection sites, the projected
workday values will silently diverge from the kernel's implicit day definition.

**Mitigation:** `minutesPerDay` must be a single-source constant shared across
`ProjectionAdapter` and any UI formatting utilities. It must not be hard-coded in
multiple places.

---

## Future Implementation Tests

The following tests are required before any production change implementing this policy.

### T1 — Boundary coverage for `ProjectionAdapter`

| Input (minutes) | Expected workdays (raw) | Notes |
|---|---|---|
| `479` | `0.99791666…` | Under one workday |
| `480` | `1.0` | Exact one workday |
| `481` | `1.00208333…` | One minute over one workday |
| `0` | `0.0` | Zero duration |
| `960` | `2.0` | Exact two workdays |
| `961` | `2.00208333…` | One minute over two workdays |

These tests must assert both the raw `workdays` field and the `minutes` field of the
`ProjectionAdapter` output.

### T2 — Engine immutability through projection cycle

Assert that after a full cycle of:

1. Engine receives integer `481` minutes.
2. `ProjectionAdapter` projects to `1.00208333` workdays.
3. UI reads projected workday value.
4. UI triggers an update that writes a duration back to the Web Worker.

…the Web Worker authoritative state still holds exactly `481` integer minutes. The
projected workday value must not have been passed back to the engine without conversion.

### T3 — Rounding regression safety

If a rounding display format is adopted, the following edge cases must pass:

- A value that rounds to `0.00` (e.g. `1` minute → `0.00208333` → rounds to `0.00`)
  must not be displayed as zero workdays without a fallback (e.g. `< 1 min`).
- A value of `.999…` days must not trigger an infinite loop or type coercion error in
  React rendering.
- Rounding must be applied symmetrically; `0.5` rounds to `1`, not to `0`.

### T4 — `minutesPerDay` single-source assertion

A configuration test must assert that exactly one definition of `minutesPerDay` exists
in the codebase at the time the implementation milestone is delivered. A duplicated
constant is a defect.

### T5 — Mixed-unit formatter (if Option E is adopted)

If the mixed-unit display policy is adopted:

- `480` minutes → `"1 day"`
- `481` minutes → `"1 day, 1 min"`
- `479` minutes → `"7 hr, 59 min"` (or equivalent, depending on hour definition)
- `0` minutes → `"0 min"`

The formatter must be a pure function with no side effects and must be testable in
isolation from the React rendering tree.

---

## What Is Proven

- The arithmetic `481 / 480 = 1.00208333…` is correct and expected.
- The WASM boundary preserves integer minutes without transformation (established by
  B2.12A.8.2).
- `TemporalScheduleTranslator` preserves integer minutes (established by B2.12A.8.2).
- Fractional workdays are a projection-layer artefact, not an engine defect.
- The recommended policy is consistent with the existing layered architecture.

---

## What Is Not Proven

- That any specific rounding precision (e.g. 2 d.p.) is acceptable to product
  stakeholders. This requires a product decision before implementation.
- That mixed-unit formatting (Option E) is feasible within the current UI component
  library without additional dependencies.
- That `ProjectionAdapter` exposes integer minutes alongside workdays in its current
  output shape. This must be verified and, if absent, added in a future milestone.
- That all Web Worker command handlers validate incoming duration values as integer
  minutes. An audit is required before the implementation milestone.

---

## Safety Confirmation

No production code was changed by this milestone.

The only file created or modified is:

- `docs/milestones/W5B-B2.12A.9-float-unit-normalisation-policy.md`

The following file categories were not touched:

- `apps/**` — no change
- `packages/**` — no change
- `crates/**` — no change
- `.github/**` — no change
- `pnpm-lock.yaml` — no change
- CI files — no change
- Vitest config files — no change

---

## Recommended Next Milestone

**W5B-B2.12A.10 — ProjectionAdapter Output Contract Extension**

Scope: Extend `ProjectionAdapter` output to expose `minutes` (integer) alongside
`workdays` (float), so that downstream consumers always have access to the canonical
value. Add tests T1 and T2 from this document. Decide and implement the display
rounding policy (Options B or E) in a thin UI formatting utility. Confirm T3 and T4.

This milestone must not be started until the product decision on display format
(rounding precision vs. mixed units) has been recorded.
