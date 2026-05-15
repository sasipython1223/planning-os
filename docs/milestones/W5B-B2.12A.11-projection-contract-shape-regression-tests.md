# W5B-B2.12A.11 — ProjectionAdapter Contract Shape Regression Tests

## 1. Executive Summary

This milestone adds **test-only** regression coverage and documentation for the intended future ProjectionAdapter output contract shape that pairs canonical integer minute fields with projected workday fields.

No production code was changed.

## 2. Background

W5B-B2.12A.9 established policy that canonical schedule values remain integer minutes and that workday conversion is projection/display only. W5B-B2.12A.10 audited the current contract and confirmed the current downstream shape is still ambiguous for numeric schedule fields and does not expose paired `*Minutes` / `*Workdays` fields.

## 3. Findings Carried Forward from B2.12A.9 and B2.12A.10

- Canonical schedule values must remain integer minutes.
- Workday conversion remains projection/display only.
- `481 / 480 = 1.00208333...` is expected projection behavior.
- Current downstream contract does not yet expose paired `*Minutes` and `*Workdays` fields.
- `freeFloat` is currently absent from the production schedule output contract.

## 4. Test Strategy

Chosen strategy: **active tests against a local test-only helper** in `packages/worker/tests/schedule/w5b-b2-12a-11-projection-contract-shape.test.ts`.

Rationale:

- Least invasive way to define expected future contract shape now.
- Avoids production code edits while still running assertions in CI.
- Makes intended future behavior explicit and executable instead of purely skipped.

## 5. Boundary Cases

The tests cover required boundary values using `minutesPerDay = 480`:

| Minutes | Expected Workdays |
|---:|---:|
| `479` | `479 / 480` |
| `480` | `1` |
| `481` | `481 / 480` |
| `960` | `2` |
| `961` | `961 / 480` |

## 6. Intended Future Contract Shape

Conceptual shape documented by tests:

```ts
{
  totalFloatMinutes: 481,
  totalFloatWorkdays: 481 / 480
}
```

The tests also document an optional future `freeFloatMinutes` / `freeFloatWorkdays` pairing as a **future expectation**, not as current production behavior.

## 7. Current Production Gap

Confirmed gap remains unchanged: production output contract does not currently expose explicit paired `*Minutes` and `*Workdays` fields for schedule values.

## 8. Why Tests Are Pending / Skipped, if applicable

Not applicable for this milestone: tests are active (not skipped) because they run against a local test-only helper and do not require any production implementation.

## 9. Safety Confirmation

- No production adapter, translator, worker command, React/UI, protocol, WASM/Rust, CI, or lockfile edits were made.
- Tests are isolated to a new test file under `packages/worker/tests/schedule/`.
- Documented risks:
  - **Mock drift risk**: local test helper could diverge from future production implementation if not reconciled in the implementation milestone.
  - **Floating-point precision risk**: ratio checks depend on exact JS numeric division semantics.

## 10. Recommended Next Milestone

Proceed to the implementation milestone that extends the ProjectionAdapter/output contract to expose explicit paired canonical `*Minutes` and projected `*Workdays` fields in production, then replace test-only helper usage with assertions against real adapter output.
