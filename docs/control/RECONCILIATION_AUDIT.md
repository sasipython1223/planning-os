# Planning OS Reconciliation Audit

Status: **DRAFT — Session 1 of 2 / DRIFT HOLD**  
Date: 2026-09-03  
Control issue: #67  
Source of truth candidate: `sasipython1223/planning-os` `main`

## 1. Executive conclusion

Two different repositories have been used as if each were the Planning OS source of truth. `planning-os` contains the real implementation; `ai-scheduler-planning-os` contains the later VPM/lifecycle package. Until they are reconciled, no Stage 3 gate or further VPM witness is valid.

Recommendation: make **`sasipython1223/planning-os` the single product source of truth**, but do not migrate the VPM wholesale. First reconcile each accepted VPM concept against the existing implementation and preserve working architecture where it already satisfies the product intent.

## 2. Existing implementation — disposition

| Existing area | Disposition | One-line basis |
|---|---|---|
| React web app / app shell | **MODIFY** | Real application exists; preserve technical shell but align future screens to accepted planner workflow rather than rebuild from prototype HTML. |
| Web Worker authoritative state | **KEEP** | Existing repo explicitly assigns state/orchestration authority to Worker; consistent with deterministic-facts/human-authority VPM boundary. |
| Translator / adapter layer | **KEEP / MODIFY** | Correct separation boundary; needs reconciliation with Schedule State, comparison and provenance semantics. |
| Rust CPM kernel | **KEEP** | Deterministic engine is valuable existing capability and should not be replaced without contrary evidence. |
| WASM boundary | **KEEP** | Explicit testable calculation boundary is compatible with product architecture. |
| XER/MSP import path | **KEEP / VERIFY** | Existing issues/PRs show import → preview → Worker → Gantt flow; exact current fidelity still requires execution evidence. |
| Protocol package | **KEEP / MODIFY ONLY BY RFC** | Existing contract boundary is valuable; any VPM-driven contract change must be explicit DRIFT/RFC. |
| TaskTable | **MODIFY** | Existing professional/WBS work is reusable, but current product direction requires human-first progressive disclosure and latest-change emphasis. |
| Gantt / timescale | **MODIFY** | Existing Gantt is a strong base; evolve toward Control Roadmap + detailed schedule rather than replace the scheduling surface. |
| Existing UI recovery milestones | **KEEP AS HISTORY** | They contain useful technical/QA evidence but are not the new lifecycle source by themselves. |
| `docs/cpm-kernel-contract.md` | **REWRITE** | It still says WASM wiring, backward pass/float and other capabilities are deferred while current repo history shows later implementation work. |
| Gemini dry-run workflow | **KEEP / RECONCILE** | Workflow genuinely exists; manual Gemini records and automated review evidence should be linked consistently. |
| Car Finder feature | **REMOVE FROM PRODUCT REPO** | Unrelated personal-product feature merged into Planning OS and creates scope contamination; preserve history and move to its own repo. |
| Governance/VPM repo | **MIGRATE THEN ARCHIVE** | Retain read-only until reconciliation/migration merge; never delete drift history. |

## 3. VPM-to-code reconciliation

| Accepted VPM concept | Current code relation | Classification |
|---|---|---|
| Source schedule remains read-only / no silent write-back | Existing architecture is import/Worker centric; no evidence found of authoritative P6 write-back | **Already compatible; execution verification pending** |
| Deterministic facts separate from AI interpretation | Worker/WASM/Rust architecture is deterministic and AI is explicitly advisory/read-only in repo instructions | **Already satisfied architecturally** |
| Human authority over acceptance/changes | Existing issue workflow repeatedly requires human approval; product-level authority model is not yet proven in runtime | **Compatible but requires product implementation** |
| Schedule State / authorised-state lifecycle | Existing repo has authoritative Worker state, but no evidence yet of the VPM's immutable authorised monthly-state lineage | **New/modified scope** |
| Baseline Assurance + Monthly Programme Assurance workbenches | Existing app is still primarily schedule workspace / UI recovery | **New product-layer scope** |
| What Changed / material-change compression | Existing comparator/evidence work exists, but the exact VPM material-change workflow is not yet proven | **Compatible; requires mapping/extension** |
| Control Roadmap + detailed Gantt | Gantt already exists | **Modify existing, do not rewrite** |
| Finding → Decision → Action → Expected Signature → Verification | No runtime proof yet of the complete persistent closed loop | **New product-layer scope** |
| Project World / 2D / BIM lenses | No production proof in current R1 code baseline reviewed here | **Future/new scope; do not force into first release** |
| Grounded AI | AI advisory boundary exists in governance/instructions, but not required for deterministic first release | **Later-bound** |

The frozen VPM therefore **does not justify a rewrite**. It becomes product intent to be mapped onto the existing engine/application.

## 4. Evidence and execution status

Repository identity is proven through GitHub metadata: `planning-os` is the implementation repository and contains `apps/`, `packages/`, `scripts`, pnpm workspace, Worker/protocol/WASM/kernel packages and current product history.

Current `main` is commit `798adc3582510dbfb4c55a1df9d8049db13452e4` (merge of PR #64). Root `package.json` currently contains a placeholder failing `test` script, so a repo-level test command must be checked carefully rather than assumed.

### Required raw execution evidence

The audit requires fresh raw output from:

```bash
pnpm -r test
cargo test
```

**Session 1 result: NOT VERIFIED.** The agent runtime could not clone GitHub because outbound DNS/network access from the shell was unavailable:

```text
Cloning into '/tmp/planning-os-audit'...
fatal: unable to access 'https://github.com/sasipython1223/planning-os.git/':
Could not resolve host: github.com
```

Existing PR descriptions report passing Vitest/typecheck/test counts, but these are historical evidence and are **not substituted for a fresh audit run**. Audit acceptance is blocked until Session 2 captures raw test output through a trusted runner/local checkout/CI.

## 5. Stage 3 entry conditions

The following are mandatory hygiene gates before architecture work:

1. **Test CI required:** add a GitHub Actions workflow that runs the agreed JS/TS and Rust test commands, then configure it as a required check for production-development merges. `mergeable` alone is not test evidence.
2. **Evict Car Finder:** move/remove Car Finder product files and issue scope from Planning OS into its own repository while preserving history/audit trace.
3. **Root README:** add/update `README.md` with product purpose, current architecture, development/test commands, source-of-truth/governance location and lifecycle authority.
4. **Project instruction correction:** update the ChatGPT Project instruction from `ai-scheduler-planning-os` to `planning-os` before future lifecycle work.

## 6. Claims not yet verified by execution

- Fresh `pnpm -r test` result on current `main`.
- Fresh `cargo test` result on current `main`.
- Claimed aggregate test count (e.g. ~540) on the exact current commit.
- Current XER/MSP import fidelity across representative files.
- Current 3,000+ activity performance after PR #64.
- Exact current data-date/progress-state semantics.
- Whether all historical CPM/kernel contract statements are superseded and by which implementation/test evidence.
- Whether automated Gemini dry-run output and manual Gemini review records represent the same review events.

## 7. Session 2 completion criteria

Session 2 is limited to: obtain raw test output; verify data-date/progress model and current CPM contract against code/tests; confirm CI plan; then finalize this file to **ACCEPT / REVISE**. No architecture redesign, no VPM migration and no product coding in the reconciliation audit.
