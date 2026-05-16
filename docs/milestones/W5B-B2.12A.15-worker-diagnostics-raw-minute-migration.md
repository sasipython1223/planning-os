# W5B-B2.12A.15 — Worker Diagnostics Raw-Minute Migration

## 1. Executive Summary

Worker diagnostics/internal consumers were migrated to prefer explicit raw-minute float fields (`totalFloatMinutes`) where available, while preserving legacy `totalFloat` compatibility.  
No UI/protocol/Rust/WASM/CI/config files were changed.

## 2. Scope Confirmation

- Implemented only Worker diagnostics/internal consumer migration in allowed Worker files.
- Added/updated Worker tests under `packages/worker/tests/**`.
- Added this milestone evidence document.
- No comparator/evidence migration.
- No protocol/type changes.
- No scheduling algorithm, gate/tolerance/authority, persistence/UAT/production changes.

## 3. Files Changed

- `packages/worker/src/constraintDiagnostics.ts`
- `packages/worker/src/worker.ts`
- `packages/worker/tests/worker.test.ts`
- `docs/milestones/W5B-B2.12A.15-worker-diagnostics-raw-minute-migration.md`

## 4. Worker Consumers Migrated

- `constraintDiagnostics.ts`
  - `mergeResultDiagnostics` now reads float minutes via:
    - `totalFloatMinutes` when present
    - fallback to legacy `totalFloat`
- `worker.ts`
  - Worker audit logging for float now reports canonical minute value using the same preference order:
    - `totalFloatMinutes` when present
    - fallback to legacy `totalFloat`

Reviewed but unchanged (no float field logic to migrate in this slice):
- `rollupSummaries.ts`
- `resourceHistogram.ts`
- `state.ts`
- `variance.ts`
- `schedule/applyScheduleResult.ts`

## 5. Field Usage Before / After

- Before:
  - Diagnostics/internal float reads used only `totalFloat` in migrated consumers.
- After:
  - Diagnostics/internal float reads prefer explicit raw-minute `totalFloatMinutes` where available.
  - Legacy `totalFloat` is retained as a compatibility alias fallback.
  - No Worker logic uses `totalFloatWorkdays` (derived display/workday field).

## 6. Tests Added or Updated

Updated: `packages/worker/tests/worker.test.ts`

Added tests in `mergeResultDiagnostics` suite:
- `prefers totalFloatMinutes over legacy totalFloat when available`
- `does not use derived workday float values for diagnostics logic`

These prove:
- raw-minute field preference for diagnostics logic,
- display/workday float is not used for diagnostics logic,
- legacy alias behavior is preserved by fallback path and existing tests.

## 7. Validation Commands and Results

Commands run:

- `git --no-pager status --short`
- `git --no-pager diff --stat`
- `npx -y pnpm@10 -C packages/worker exec tsc --noEmit`
- `npx -y pnpm@10 -C packages/worker exec vitest run`
- `npx -y pnpm@10 -C packages/worker exec vitest run tests/worker.test.ts`

Results:

- `vitest run`: pass (`9` files, `387` tests).
- `vitest run tests/worker.test.ts`: pass (`269` tests).
- `tsc --noEmit`: fails due to pre-existing environment/type issues not introduced by this milestone:
  - DOM globals in `src/import/parsers/mspParser.ts`
  - unresolved `cpm-wasm` types in `src/wasm/loadCpmWasm.ts`

## 8. Forbidden Files Confirmation

Confirmed: no forbidden files were modified (`apps/**`, `packages/protocol/src/**`, Rust/WASM/CI/config/lock/package files, etc.).

## 9. Safety Confirmation

- AI003 remains blocked.
- No temporal authority changes.
- No persistence/UAT/production enablement.
- No gate/tolerance changes.
- No scheduling output behavior changes.
- No UI migration.
- No Rust/WASM changes.
- No protocol changes.

## 10. Recommended Next Milestone

Proceed to the next approved ProjectionAdapter consumer migration slice outside this Worker diagnostics-only scope (for example, the explicitly approved comparator/evidence migration milestone when authorized).
