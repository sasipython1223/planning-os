# W5B-B2.12A.18 — Legacy Float Field Deprecation Plan

## 1. Executive Summary

This milestone is planning-only and defines a controlled deprecation path for legacy float aliases (`totalFloat`, `freeFloat`) after consumer migration to explicit fields.

Recommendation: use staged removal with a soft-deprecation window first, require explicit evidence that legacy consumers are gone, and require explicit approval before any hard removal milestone.

## 2. Scope Confirmation

In scope for this milestone:

- consumer inventory verification
- deprecation strategy
- compatibility-window recommendation
- required tests before any future removal
- rollback strategy
- milestone documentation

Out of scope (unchanged in this milestone):

- no legacy field removal
- no protocol/type contract changes
- no UI/Worker/comparator behavior changes
- no Rust/WASM changes
- no scheduling output/authority/gate/tolerance changes
- no persistence/UAT/production enablement

## 3. Legacy Float Fields Inventory

Legacy compatibility fields remaining:

- `totalFloat` (legacy authoritative alias currently retained in protocol/kernel/task schedule shapes)
- `freeFloat` (legacy alias present in UI-side compatibility/update-sanitization typing)

Explicit migrated fields currently used by consumers:

- `totalFloatMinutes` (raw-minute consumer field)
- `totalFloatWorkdays` (display/workday consumer field)

Discovered but not currently projected in production schedule output:

- `freeFloatMinutes`
- `freeFloatWorkdays`

## 4. Consumer Inventory

### Worker diagnostics/internal

- Uses raw-minute helper path (`getTotalFloatMinutesForComparison`) with fallback to legacy `totalFloat`.
- `constraintDiagnostics.mergeResultDiagnostics` uses helper-based minute preference.
- Worker audit evidence (`[AUDIT Kernel Math]`) uses helper-based minute preference.

### Comparator/evidence

- `getTotalFloatMinutesForComparison` and `maxAbsTotalFloatVarianceMinutes` are raw-minute-first with `totalFloat` fallback.

### UI display

- `TaskTable` display prefers `totalFloatWorkdays`, fallback `totalFloat`.
- UI update sanitizer strips `totalFloat`, `totalFloatMinutes`, `totalFloatWorkdays`, `freeFloat`, `freeFloatMinutes`, `freeFloatWorkdays` from outgoing updates.
- `TaskDetailsPanel` has no active total/free float rendering logic.

### Protocol/types

- `ScheduleResultMap` and kernel schedule result contract still define `totalFloat`.
- No protocol-level `freeFloat` contract field is currently present.

### Tests

- Worker tests cover raw-minute preference and legacy fallback behavior.
- UI tests cover display preference/fallback and update-payload stripping for total/free float fields.
- Projection contract tests explicitly document no `freeFloatMinutes`/`freeFloatWorkdays` projection today.

### Imports/exports/reporting

- No in-repo import/export/reporting runtime consumer was found that depends on `freeFloat*` fields.
- Audit reporting still references total float through the raw-minute helper path.

### Downstream/out-of-repo unknowns

- External consumers of Worker/protocol payloads may still depend on legacy `totalFloat` and/or ad-hoc `freeFloat` aliases.
- Removal cannot proceed without explicit downstream confirmation window and telemetry/evidence collection.

## 5. Field Authority Model

- Authoritative schedule field currently emitted by kernel/protocol contract: `totalFloat`.
- Worker/comparator internal authority for comparison math: raw-minute (`totalFloatMinutes`) when available, otherwise legacy `totalFloat`.
- UI authority for display: `totalFloatWorkdays` when available, otherwise `totalFloat`.
- `freeFloat*` fields are not part of authoritative in-repo scheduling contracts and are treated as compatibility/sanitized display-side aliases when present.

## 6. Deprecation Strategy

Recommended staged strategy:

1. **Soft deprecation (documentation + inventory freeze: no new runtime reads/writes that depend on legacy float aliases)**
   - Mark `totalFloat` and `freeFloat` aliases as deprecated in milestone docs and migration guidance.
   - Keep runtime compatibility unchanged.
2. **Compatibility window (evidence gathering)**
   - Require confirmation that all in-repo and known downstream consumers are migrated.
   - Keep fallback behavior intact.
3. **Approval gate for future removal milestone**
   - Start a separate implementation milestone only after explicit approval.
4. **Staged implementation (future, not this milestone)**
   - Remove non-authoritative aliases in controlled sequence with rollback checkpoints.

Hard failure/removal is not recommended in this planning milestone.

## 7. Compatibility Window

Recommended minimum compatibility period: **two release cycles** after explicit deprecation notice.

Compatibility can end only when all criteria are met:

- in-repo consumer inventory shows no runtime dependency on legacy aliases for behavior
- protocol/downstream stakeholders explicitly acknowledge compatibility cutoff
- required tests (Section 8) pass with removal candidate branch
- rollback plan is rehearsed and approved

Evidence required before removal approval:

- updated consumer inventory with zero blocking dependencies
- test run evidence across Worker/UI/comparator suites
- explicit approval artifact for contract-affecting changes

## 8. Required Tests Before Removal

Before any future removal milestone, require at minimum:

- **Worker tests**
  - diagnostics negative-float checks remain correct with minute-authoritative path
  - audit/comparator evidence float computations remain deterministic
- **Comparator/evidence tests**
  - `getTotalFloatMinutesForComparison` and variance helpers preserve expected semantics
- **UI tests**
  - `TaskTable` display still renders correct value order for supported fields
  - update payload sanitization still blocks display-only float fields from mutation paths
- **Protocol/contract tests**
  - schedule result shape tests updated/approved for any contract transition
- **Import/export/reporting tests (if consumers are found)**
  - add targeted tests to verify compatibility behavior for those paths

No removal should proceed without this test matrix green in CI.

## 9. Rollback Strategy

If future removal causes breakage:

1. if a future approved removal milestone requires rollback, re-enable legacy field compatibility aliases in projection/adapter boundary in a hotfix branch
2. restore fallback read paths in affected consumers
3. redeploy only after regression tests and compatibility checks pass

Rollback triggers/evidence:

- downstream parse/runtime failures tied to missing legacy fields
- comparator/evidence drift from expected baseline outputs
- UI regressions in float rendering or payload handling
- contract test failures after removal candidate deployment

## 10. Soft Warning / Hard Failure / Staged Removal Recommendation

Recommended sequence:

1. **Soft warning** (now/planning): documentation-level deprecation only
2. **Staged removal prep** (future approved milestone): remove low-risk aliases first with checkpoints
3. **Hard failure** only at final stage and only after explicit approval + compatibility evidence

Explicit stop points and approval gates:

- stop if any protocol/type break is required without separate approval
- stop if any UI/Worker/comparator behavior changes are required in a planning milestone
- stop if downstream unknowns are unresolved at compatibility-window end

## 11. freeFloat Asymmetry Assessment

Current state is asymmetric:

- `totalFloat` has defined raw-minute/display companions (`totalFloatMinutes`, `totalFloatWorkdays`) and active consumer migrations.
- `freeFloat` does **not** have equivalent in-repo authoritative projection/contract support; tests explicitly document missing `freeFloatMinutes`/`freeFloatWorkdays` projection.

Recommendation:

- do **not** force `freeFloat` removal or normalization inside this milestone.
- create a **separate follow-up milestone** to decide whether `freeFloat` should gain symmetric projection fields or be deprecated independently.

## 12. Risk Register

- **Protocol compatibility risk:** removing `totalFloat` while contract still exposes it will break consumers.
- **Downstream consumer risk:** out-of-repo clients may rely on legacy aliases.
- **UI interpretation risk:** inconsistent display fallback behavior if alias removal is premature.
- **Evidence/comparator drift risk:** minute-vs-legacy mismatch if fallback paths are removed without proof.
- **Import/export/reporting risk:** hidden integrations may deserialize legacy fields.
- **Rollback risk:** delayed rollback increases blast radius if compatibility restoration is not preplanned.

## 13. Stop Conditions

Stop and do not implement removal when any of the following is true:

- legacy field removal appears necessary in this planning milestone
- protocol/type changes are required without explicit approval
- UI/Worker/comparator behavior changes are required
- Rust/WASM or scheduling output changes are required
- authority/gate/tolerance or persistence/UAT/production changes are required
- files outside `docs/milestones` are required for this milestone scope

## 14. Safety Confirmation

- Planning-only milestone.
- No legacy fields removed.
- No protocol/type changes.
- No UI changes.
- No Worker changes.
- No comparator/evidence changes.
- No Rust/WASM changes.
- No scheduling output changes.
- No authority/gate/tolerance changes.
- No persistence/UAT/production enablement.
- AI003 remains blocked.

## 15. Recommended Next Milestone

Proceed with a separate implementation-gated milestone only after compatibility evidence is collected.

Recommended immediate next milestone:

- **freeFloat asymmetry decision milestone** (define whether to add symmetric `freeFloatMinutes`/`freeFloatWorkdays` support or deprecate `freeFloat` independently), followed by a dedicated approved removal milestone for legacy aliases if still warranted.
