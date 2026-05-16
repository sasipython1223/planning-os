# W5B-B2.12A.16 — Comparator / Evidence Raw-Minute Migration

## 1. Executive Summary

Comparator/evidence-side float comparison helpers were made explicitly raw-minute authoritative.  
Comparator/evidence consumers now resolve float values via `totalFloatMinutes` when present, with legacy `totalFloat` fallback retained for compatibility.

## 2. Scope Confirmation

- In scope: worker comparator/evidence float comparison helpers and direct tests.
- In scope: milestone evidence documentation.
- Out of scope and unchanged: UI, protocol/types, Rust/WASM, scheduling algorithm, gate/tolerance/authority behavior, persistence/UAT/production enablement.

## 3. Raw-Minute Field Definition

For this milestone, comparator/evidence "raw-minute fields" are:

- `totalFloatMinutes` (primary authoritative field when available)
- `totalFloat` (legacy compatibility fallback while migration is in progress)

Display/workday fields (for example `totalFloatWorkdays`) are derived/display-only and are not used for comparator math.

## 4. Files Changed

- `packages/worker/src/floatMinutes.ts`
- `packages/worker/src/constraintDiagnostics.ts`
- `packages/worker/src/worker.ts`
- `packages/worker/tests/floatMinutes.test.ts`
- `docs/milestones/W5B-B2.12A.16-comparator-evidence-raw-minute-migration.md`

## 5. Comparator / Evidence Consumers Migrated

- `getTotalFloatMinutesForComparison` (new shared comparator/evidence float resolver)
- `maxAbsTotalFloatVarianceMinutes` (new shared comparator/evidence max absolute variance helper)
- `constraintDiagnostics.mergeResultDiagnostics` now reads through shared raw-minute comparator helper
- `worker` audit evidence (`[AUDIT Kernel Math]` TF field) now reads through shared raw-minute comparator helper

## 6. Field Usage Before / After

- Before:
  - Comparator/evidence float reads were duplicated per file.
  - Raw-minute preference existed in specific paths but was not centralized.
- After:
  - Comparator/evidence float comparison uses shared `getTotalFloatMinutesForComparison`.
  - Comparator/evidence variance helper is explicitly minute-based.
  - `totalFloatMinutes` is preferred where available.
  - `totalFloat` remains fallback.
  - `totalFloatWorkdays` is not used for comparator math.

## 7. Tests Added or Updated

Added:

- `packages/worker/tests/floatMinutes.test.ts`
  - prefers `totalFloatMinutes` over legacy `totalFloat`
  - confirms legacy `totalFloat` fallback remains available
  - confirms max absolute variance is computed in minutes from raw-minute values
  - confirms empty comparison set behavior remains deterministic (`0`)

Existing coverage retained:

- `packages/worker/tests/worker.test.ts` diagnostics coverage already verifies workday/display float is not used for diagnostic logic.

## 8. Validation Commands and Results

Commands run:

- `git --no-pager status --short`
- `git --no-pager diff --stat`
- `npx -y pnpm@10 install`
- `npx -y pnpm@10 -C packages/worker exec vitest run`
- `npx -y pnpm@10 -C packages/worker exec vitest run tests/floatMinutes.test.ts tests/worker.test.ts`
- `npx -y pnpm@10 -C packages/worker exec tsc --noEmit`

Results:

- `vitest run`: pass.
- targeted `vitest run tests/floatMinutes.test.ts tests/worker.test.ts`: pass.
- `tsc --noEmit`: fails due to pre-existing unrelated issues:
  - DOM globals unresolved in `src/import/parsers/mspParser.ts`
  - unresolved `cpm-wasm` type declaration in `src/wasm/loadCpmWasm.ts`

## 9. Forbidden Files Confirmation

Confirmed: no forbidden files were modified (`apps/**`, `packages/protocol/src/**`, Rust/WASM paths, CI/config/package/lock files, etc.).

## 10. Stop / Rollback Notes

No stop condition was triggered.  
No rollback required.

## 11. Safety Confirmation

- AI003 remains blocked (no AI003 enablement changes made).
- No gate/tolerance weakening.
- No authority/apply/rollback behavior changes.
- No scheduling output semantic changes.
- No persistence/UAT/production enablement changes.

## 12. Recommended Next Milestone

Proceed to the next approved milestone in sequence (UI/display consumer migration slice) after review confirms comparator/evidence migration acceptance.
