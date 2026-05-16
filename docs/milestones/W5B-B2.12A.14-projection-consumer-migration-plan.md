# W5B-B2.12A.14 — ProjectionAdapter Consumer Migration Plan

## 1. Executive Summary

This milestone defines a safe, staged migration plan for ProjectionAdapter consumers from ambiguous legacy float usage to explicit unit policy, without performing any consumer migration in this milestone.

Recommended direction:

1. Complete planning only in B2.12A.14 (this document).
2. Migrate Worker diagnostics/internal consumers to raw-minute fields first.
3. Migrate comparator/evidence consumers next, also on raw-minute fields.
4. Migrate UI display consumers later, using display workday fields.
5. Keep `totalFloat` as a temporary compatibility alias until deprecation milestone.
6. Split `freeFloat` asymmetry into a later milestone.

AI003 remains blocked.

## 2. Scope Confirmation

In scope for B2.12A.14:

- Design and sequencing only.
- Consumer-group classification and field policy definition.
- Safety constraints, stop conditions, and implementation guardrails.

Out of scope for B2.12A.14:

- Any code migration.
- Any protocol/type contract changes.
- Any Worker/UI/Rust/WASM changes.
- Any test implementation changes.
- Any CI/config/gate/tolerance/authority/persistence/UAT/production changes.

## 3. B2.12A.13 Findings Carried Forward

From the B2.12A.13 audit context:

- Extended ProjectionAdapter paired fields exist.
- Production/runtime/UI consumers still rely mainly on legacy float fields (notably `totalFloat`).
- Consumer migration must be sequenced to avoid unit ambiguity and accidental use of display projections as authoritative values.

Primary consumer groups identified:

- Worker runtime/diagnostics
- Protocol/types
- UI/display surfaces
- Tests/contract-shape coverage

## 4. ChatGPT Review Carried Forward

Accepted ChatGPT direction:

- B2.12A.14 must remain documentation-only.
- No code migration in this milestone.
- No protocol/type, Worker, UI, Rust/WASM, CI, gate, tolerance, authority, persistence, UAT, or production changes.
- AI003 remains blocked.

ChatGPT recommended sequence:

1. B2.12A.14 — plan only
2. B2.12A.15 — Worker diagnostics raw-minute migration
3. B2.12A.16 — comparator/evidence raw-minute migration
4. B2.12A.17 — UI display workday migration
5. B2.12A.18 — legacy field deprecation plan

## 5. Gemini Review Carried Forward

Accepted Gemini direction:

- Worker-side migration should happen before UI display migration.
- Comparator/evidence migration should happen early.
- Protocol/types readiness should be established before runtime consumer migration proceeds.
- UI migration should be split into a separate milestone.
- `totalFloat` should remain a temporary compatibility alias.
- `freeFloat` asymmetry should be split into a later milestone.
- B2.12A.14 remains documentation-only.

## 6. Consumer Group Classification

| Consumer group | Primary files (from audit context) | Migration phase | Criticality |
|---|---|---|---|
| Worker runtime/diagnostics | `packages/worker/src/constraintDiagnostics.ts`, `rollupSummaries.ts`, `resourceHistogram.ts`, `state.ts`, `variance.ts`, `worker.ts`, `schedule/applyScheduleResult.ts` | B2.12A.15 | High |
| Comparator/evidence consumers | Evidence/comparator paths that evaluate schedule deltas and diagnostics (Worker-adjacent consumers) | B2.12A.16 | High |
| Protocol/types contracts | `packages/protocol/src/types.ts`, `packages/protocol/src/kernel.ts` | Readiness gate before/at start of implementation migration (no change in B2.12A.14) | High |
| UI/display consumers | `apps/web/src` TaskTable/Gantt surfaces, `TaskDetailsPanel.tsx` | B2.12A.17 | Medium-High |
| Legacy compatibility/deprecation | `totalFloat` alias consumers and cleanup points | B2.12A.18 | Medium |
| `freeFloat` asymmetry follow-up | `freeFloat`-related contract/consumer paths | Later split milestone | Medium |

## 7. Field Policy

| Consumer group | Required field policy |
|---|---|
| Worker runtime/diagnostics | Use raw-minute fields as authoritative (`*Minutes` when available). Do not use display/workday fields for logic. |
| Comparator/evidence | Use raw-minute fields for comparisons, thresholds, and evidence generation. Avoid display/workday values in comparator math. |
| Protocol/types | Keep contracts stable in B2.12A.14. Any future protocol/type extension must be explicit, additive, and approved before consumer rewiring depends on it. |
| UI/display | Use display workday fields (`*Workdays`) for presentation only; never treat them as authoritative scheduling inputs. |
| Legacy compatibility | Keep `totalFloat` temporarily as compatibility alias until B2.12A.18 deprecation plan executes. |
| Diagnostic-only fields | Restrict diagnostic-only fields to evidence/debug/reporting contexts; do not feed authoritative scheduling decisions. |

## 8. Recommended Migration Sequence

Recommended safe sequence:

1. **B2.12A.14 (current):** planning and safety constraints only.
2. **B2.12A.15:** Worker diagnostics/internal raw-minute migration (no UI migration).
3. **B2.12A.16:** comparator/evidence raw-minute migration.
4. **B2.12A.17:** UI display migration to display/workday fields.
5. **B2.12A.18:** legacy `totalFloat` deprecation/removal plan and cleanup.
6. **Later split milestone:** `freeFloat` asymmetry resolution.

Protocol/types rule for sequence safety:

- Before runtime consumer migration is considered complete, protocol/types readiness must be confirmed (either no extension required, or explicit additive contract extension approved in the relevant implementation milestone).

## 9. Risk Ranking

| Risk ID | Risk | Rank | Why it is risky | Mitigation |
|---|---|---|---|---|
| R1 | Worker or comparator logic reads display/workday fields as authoritative | Critical | Can cause unit drift and incorrect evidence/runtime behavior | Migrate Worker/comparators to raw minutes first; enforce field policy in tests/review |
| R2 | Runtime consumers migrate before protocol/types readiness is clear | High | Can create contract mismatches and partial migrations | Add readiness gate before runtime migration completion |
| R3 | UI migrates before runtime/comparator consumers | High | Presentation units can become implicitly authoritative via accidental reuse | Keep UI migration separate and later (B2.12A.17) |
| R4 | Legacy `totalFloat` removed too early | High | Breaks existing consumers still on compatibility path | Keep compatibility alias through migration and deprecate only in B2.12A.18 |
| R5 | `freeFloat` asymmetry bundled into early migration | Medium | Expands scope and raises regression surface | Split `freeFloat` into later dedicated milestone |
| R6 | Scope creep into CI/config/protocol/UI during B2.12A.15 | Medium | Increases risk beyond approved migration slice | Strict allowed/forbidden file list and stop conditions |

## 10. Required Tests Before Migration

The following test requirements must be satisfied before or with implementation milestones:

1. **Projection contract shape tests**
   - Confirm paired raw-minute and display-workday fields expected by migration phases.
2. **Boundary conversion tests**
   - Cover `479`, `480`, `481`, `960`, `961` minute cases with exact division behavior.
   - Rationale for these values: they bracket one-day and two-day `minutesPerDay=480` boundaries (just below, exact boundary, and just above), where unit/projection mistakes are most likely.
3. **Immutability tests**
   - Ensure projection/consumer paths do not mutate authoritative source objects.
4. **Worker diagnostics raw-minute tests**
   - Verify diagnostics/evidence logic reads raw-minute fields, not display/workday fields.
5. **Comparator/evidence regression tests**
   - Verify comparator math and evidence outputs are minute-authoritative.
6. **UI round-trip safety tests**
   - Verify display/workday fields are presentation-only and not written back as authoritative scheduling input.
7. **Compatibility alias tests**
   - Verify `totalFloat` remains available during phased migration until deprecation milestone.

## 11. B2.12A.15 Allowed / Forbidden Files

Allowed files for B2.12A.15 (first implementation milestone):

- `packages/worker/src/constraintDiagnostics.ts`
- `packages/worker/src/rollupSummaries.ts`
- `packages/worker/src/resourceHistogram.ts`
- `packages/worker/src/state.ts`
- `packages/worker/src/variance.ts`
- `packages/worker/src/worker.ts`
- `packages/worker/src/schedule/applyScheduleResult.ts`
- Worker tests directly covering the above migration slice (`packages/worker/tests/**` as needed)
- Milestone documentation updates under `docs/milestones/`

Forbidden files for B2.12A.15:

- `apps/**`
- `crates/**`
- `.github/**`
- `pnpm-lock.yaml`
- `package.json`
- CI files
- Vitest config files
- Any unrelated protocol/type, UI, Rust/WASM, or config file outside explicitly approved scope

Protocol/types handling for B2.12A.15:

- If protocol/type changes are discovered as mandatory for safe worker migration, stop and raise scope decision before editing `packages/protocol/**`.
- Escalation path: open a follow-up milestone issue describing the required protocol/type change, link it to B2.12A.15, and wait for explicit human approval before any protocol file edits.

## 12. Stop Conditions

Stop migration work immediately if any of the following occurs:

1. A required change crosses into forbidden file groups without explicit milestone approval.
2. Protocol/types must change but no explicit approval for that scope exists.
3. Worker/comparator migration cannot proceed without UI coupling changes.
4. Tests show display/workday fields are re-entering authoritative runtime paths.
5. Any change would alter scheduling outputs, gate/tolerance behavior, temporal authority, persistence, or production enablement state.
6. AI003 unblocking is requested implicitly or explicitly.

## 13. Safety Confirmation

For B2.12A.14:

- AI003 remains blocked.
- No code migration performed.
- No production behavior changed.
- No protocol/type change.
- No Worker change.
- No UI change.
- No Rust/WASM change.
- No CI/config change.
- No gate/tolerance/authority/persistence/UAT/production change.

## 14. Recommended Next Milestone

Proceed to **W5B-B2.12A.15 — Worker diagnostics raw-minute migration** under the file constraints and stop conditions in this plan.

Execution requirements for B2.12A.15:

- Keep migration limited to Worker diagnostics/internal consumers.
- Preserve legacy compatibility alias (`totalFloat`) during transition.
- Do not include UI migration.
- Do not include `freeFloat` asymmetry scope.
- Maintain AI003 blocked state.
