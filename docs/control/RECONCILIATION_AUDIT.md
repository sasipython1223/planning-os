# Planning OS Reconciliation Audit

Status: **SESSION 2 — REVISE pending clean-tree confirmation / DRIFT HOLD**  
Date: 2026-09-05  
Control issue: #67  
Source of truth candidate: `sasipython1223/planning-os` `main`

## 1. Executive conclusion

Two repositories were being used as if each were the Planning OS source of truth. `planning-os` contains the real implementation; `ai-scheduler-planning-os` contains the later VPM/lifecycle package.

The implementation baseline is materially stronger than the governance-only repo assumed. Fresh execution now proves the Worker/protocol/Rust/WASM baseline is viable. The correct direction remains: make **`sasipython1223/planning-os` the single product source of truth**, preserve the working deterministic architecture, map the VPM onto it item-by-item, then archive the governance repo after migration.

Current audit disposition is **REVISE**, not because tests failed, but because the web test run was executed against a locally dirty `apps/web` tree. One final clean-tree equivalence check is required before the audit can be accepted.

## 2. Existing implementation — disposition

| Existing area | Disposition | One-line basis |
|---|---|---|
| React web app / app shell | **MODIFY** | Preserve the real application and align future screens to the accepted planner workflow. |
| Web Worker authoritative state | **KEEP** | Correct deterministic state/orchestration boundary; 413 Worker tests pass fresh. |
| Translator / adapter layer | **KEEP / MODIFY** | Correct separation boundary; extend for Schedule State/comparison/provenance rather than replace. |
| Rust CPM kernel | **KEEP** | 90 Rust tests pass fresh; deterministic engine is valuable existing capability. |
| WASM boundary | **KEEP** | 6 wasm-bindgen tests pass through `wasm-pack test --node`. |
| XER/MSP import path | **KEEP / VERIFY REPRESENTATIVE FILES LATER** | Parser/mapper/commit tests pass; representative-file fidelity remains a later acceptance concern. |
| Protocol package | **KEEP / MODIFY ONLY BY RFC** | 17 protocol tests pass; preserve contract discipline. |
| TaskTable | **MODIFY** | Reuse existing professional/WBS work; align to progressive disclosure/latest-change product direction. |
| Gantt / timescale | **MODIFY** | Existing Gantt is a strong base; evolve toward Control Roadmap + detailed schedule. |
| Existing UI recovery milestones | **KEEP AS HISTORY** | Useful technical/QA evidence; not lifecycle authority by themselves. |
| `docs/cpm-kernel-contract.md` | **REWRITE** | It is materially stale against current protocol/kernel capability. |
| Gemini dry-run workflow | **KEEP / RECONCILE** | Workflow genuinely exists; automated and manual review records need consistent provenance. |
| Car Finder feature | **REMOVE FROM PRODUCT REPO** | Unrelated product scope contaminates Planning OS; preserve history and move it out. |
| Governance/VPM repo | **MIGRATE THEN ARCHIVE** | Retain read-only until reconciliation/migration merge; never delete drift history. |

## 3. VPM-to-code reconciliation

| Accepted VPM concept | Current code relation | Classification |
|---|---|---|
| Source schedule read-only / no silent write-back | Current architecture is import/Worker centric; no P6 write-back path identified | **Already compatible** |
| Deterministic facts separate from AI interpretation | Worker/WASM/Rust architecture is deterministic and repo instructions keep AI advisory | **Already satisfied architecturally** |
| Human authority over acceptance/changes | GitHub workflow requires human approval; runtime authority object model not yet complete | **Compatible; product implementation required** |
| Schedule State / authorised-state lifecycle | Worker state exists, but current protocol does not model immutable authorised monthly states | **New/modified scope** |
| Data date / progress semantics | Current `Task` contract has duration, constraints, hierarchy and schedule results, but no data date, actual start/finish or percent-complete fields | **New/modified scope — Stage 3 design item** |
| Baseline Assurance + Monthly Programme Assurance workbenches | Current app remains primarily a schedule workspace | **New product-layer scope** |
| What Changed / material-change compression | Comparator/evidence work exists, but exact VPM workflow is not yet proven | **Compatible; extend existing** |
| Control Roadmap + detailed Gantt | Gantt already exists | **Modify existing, do not rewrite** |
| Finding → Decision → Action → Expected Signature → Verification | Complete persistent closed loop not yet proven | **New product-layer scope** |
| Project World / 2D / BIM lenses | No production proof in current R1 baseline | **Future/new scope** |

The VPM therefore **does not justify a rewrite**. It is product intent to be reconciled with the existing application/engine.

## 4. Fresh execution evidence — Session 2

Repository identity was confirmed as `origin https://github.com/sasipython1223/planning-os.git`, branch `main`, commit `798adc3`.

`pnpm -r test` was proven unsuitable for unattended verification because `packages/worker` runs plain `vitest` in watch mode. Equivalent one-shot commands were used without modifying package scripts.

### JS/TS

```text
$ pnpm --filter protocol test
Test Files  1 passed (1)
Tests       17 passed (17)
EXIT 0

$ pnpm --filter web test
Test Files  15 passed (15)
Tests       110 passed (110)
EXIT 0

$ pnpm --filter worker exec vitest run
Test Files  11 passed (11)
Tests       413 passed (413)
EXIT 0
```

**Fresh JS/TS total: 27 test files / 540 tests passed / 0 failed.**

### Rust / WASM

```text
$ cargo test   # packages/cpm-kernel
running 90 tests
test result: ok. 90 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
EXIT 0

$ wasm-pack test --node   # packages/cpm-wasm
running 6 tests
test result: ok. 6 passed; 0 failed; 0 ignored; 0 filtered out
EXIT 0
```

A host-target `cargo test` in `packages/cpm-wasm` exited 0 but executed 0 tests and is **not** counted as PASS evidence. Warnings observed: unused Rust `parent` field and wasm-pack 0.15.0 update notice; neither is treated as failure or acceptance evidence.

### Evidence-integrity caveat

The local `main` working tree reported 37 modified files, all in the Car Finder/web area. The agent did not create those changes. Therefore Worker/protocol/Rust/WASM results certify committed code, but the web result currently certifies the local working-tree content rather than pristine `798adc3`.

Before audit ACCEPT, run a no-change equivalence check such as:

```bash
git diff --ignore-space-at-eol --exit-code -- apps/web
```

If exit code is 0, the apparent changes are whitespace/line-ending-only and the fresh web result may be accepted for the committed content. If non-zero, inspect the diff and rerun web tests from a clean worktree/checkout without discarding user work.

## 5. CPM contract reconciliation

`docs/cpm-kernel-contract.md` is stale. It still describes WASM wiring, backward pass/float, calendars, lag and non-FS relationship types as deferred. Current protocol code already exposes early/late dates, total float, criticality, all four PDM relationship types (`FS/SS/FF/SF`) with lag, constraints and `nonWorkingDays`; fresh kernel/WASM tests also exercise these capabilities.

Disposition: **rewrite the documentation to describe the implemented contract; do not redesign the kernel merely to match the stale document.** Any real protocol/schema change remains DRIFT/RFC controlled.

## 6. Stage 3 entry conditions

These remain mandatory hygiene gates before Stage 3 architecture work:

1. **Test CI required:** add a GitHub Actions workflow for agreed one-shot JS/TS + Rust/WASM tests and make it a required check for production-development merges.
2. **Evict Car Finder:** move/remove Car Finder product scope from Planning OS while preserving history/audit trace.
3. **Root README:** state product purpose, architecture, development/test commands, source-of-truth/governance location and lifecycle authority.
4. **Project instruction correction:** change ChatGPT Project source-of-truth instruction from `ai-scheduler-planning-os` to `planning-os` before future lifecycle work.

## 7. Final remaining audit action

One execution-integrity check remains: determine whether the 37 local `apps/web` modifications are only line-ending/whitespace changes. After that:

- if equivalent to committed `main`: finalize this audit **ACCEPT** and proceed to the Stage 3 hygiene entry conditions;
- if substantive changes exist: keep **REVISE**, identify their origin, and rerun web tests against pristine `main`.

No Stage 3 architecture, VPM migration, product coding or PR merge is authorised by this audit while DRIFT HOLD remains active.
