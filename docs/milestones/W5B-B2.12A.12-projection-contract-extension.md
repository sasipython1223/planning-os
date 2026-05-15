# W5B-B2.12A.12 — ProjectionAdapter Output Contract Extension

## 1. Executive Summary

This milestone implements the first controlled production ProjectionAdapter contract extension for `totalFloat` by exposing canonical integer minutes and derived workdays together:

```ts
{
  totalFloat: 481,
  totalFloatMinutes: 481,
  totalFloatWorkdays: 481 / 480
}
```

## 2. Background

Previous milestones established policy (B2.12A.9), audited output gaps (B2.12A.10), and added regression tests for the intended shape (B2.12A.11). This milestone implements the smallest production step in the projection/output layer only.

## 3. Policy Carried Forward from B2.12A.9

- Canonical schedule values remain integer minutes.
- Workday values remain derived projection/display values.
- Workday derivation uses `minutes / minutesPerDay`.
- No rounding/truncation is introduced in adapter projection.

## 4. Audit Findings Carried Forward from B2.12A.10

- `totalFloat` was previously ambiguous in unit naming.
- Paired `*Minutes` / `*Workdays` fields were missing from projection output.
- `freeFloat` remains unavailable in the current production contract.

## 5. Test Expectations Carried Forward from B2.12A.11

- Validate boundaries: `479`, `480`, `481`, `960`, `961`.
- Assert exact minute preservation.
- Assert raw division for workday projection.
- Assert no source object mutation.
- Assert projected workdays are derived/non-authoritative.

## 6. Implementation Summary

- Added `projectScheduleResult` in `ProjectionAdapter.ts`.
- The adapter is pure: returns a new object and preserves source object fields.
- Added `totalFloatMinutes` = canonical `totalFloat`.
- Added `totalFloatWorkdays` = `totalFloat / minutesPerDay`.
- Kept legacy `totalFloat` unchanged for compatibility.

## 7. Files Changed

- `packages/worker/src/schedule/ProjectionAdapter.ts` (new)
- `packages/worker/tests/schedule/w5b-b2-12a-11-projection-contract-shape.test.ts`
- `packages/worker/tests/schedule/w5b-b2-12a-12-projection-contract-extension.test.ts` (new)

## 8. Contract Shape Introduced

For projected schedule records containing `totalFloat`, the adapter now emits:

```ts
{
  ...existingFields,
  totalFloat: number, // legacy canonical minutes field, preserved
  totalFloatMinutes: number, // explicit canonical minutes
  totalFloatWorkdays: number // derived projection value
}
```

## 9. Boundary Cases Covered

| Minutes | Expected Workdays |
|---:|---:|
| `479` | `479 / 480` |
| `480` | `1` |
| `481` | `481 / 480` |
| `960` | `2` |
| `961` | `961 / 480` |

## 10. What Is Proven

- Canonical minutes are preserved exactly in `totalFloatMinutes`.
- Workdays are derived by direct division with no rounding/truncation.
- Clean multiples (480, 960) project to exact integers (`1`, `2`).
- One-minute residue cases (481, 961) retain fractional values.
- Input objects are not mutated.

## 11. What Is Not Proven

- `freeFloatMinutes` / `freeFloatWorkdays` production output pairing is not implemented in this milestone.
- No UI/protocol exposure migration is implemented in this milestone.
- No broad schedule field migration beyond `totalFloat` is implemented.

## 12. Safety Confirmation

- Change is isolated to projection adapter, focused tests, and milestone docs.
- No React/UI, protocol, Rust/WASM, CI, package, lockfile, fixture, or UAT files were modified.
- No scheduling algorithm, translator semantics, or worker command-handler logic was changed.

## 13. Recommended Next Milestone

Implement the next controlled projection contract extension for additional schedule fields (and optionally `freeFloat` if available in upstream data), while preserving the same policy: canonical minutes authoritative, workdays derived/display-only.
