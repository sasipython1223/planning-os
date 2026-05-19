# W5B-UI.R5A — TaskTable WBS Professional View

## 1. Executive Summary

R5A implements a narrow UI-only refinement to the imported programme TaskTable. The change improves WBS / summary row readability, hierarchy indentation safety, and summary/activity row distinction while preserving the current Worker-authoritative scheduling architecture.

This PR implements only the first R5 slice:

```text
R5A — TaskTable WBS hierarchy, indentation, summary/activity row styling
```

It does not implement R5B banding, R5C column/indicator expansion, or R5D virtualization polish.

---

## 2. Parent Register Reference

Parent control source:

- #47 — UI Recovery Register / master control source

R5 parent issue:

- #48 — [UI] W5B-UI.R5 — TaskTable / WBS Professional View

---

## 3. R5/R5A Scope Confirmation

R5A scope implemented:

- Use existing `task.depth` for hierarchy indentation.
- Use existing `task.isSummary` for summary/WBS-style row distinction.
- Improve summary/activity row visual distinction.
- Preserve imported row order.
- Preserve current TaskTable virtualization behavior.
- Preserve Gantt rendering behavior.
- Keep React as display/projection only.

Out of scope and not implemented:

- No Worker changes.
- No protocol changes.
- No Rust/WASM/kernel changes.
- No parser/import changes.
- No persistence/gate/AI003/production changes.
- No scheduling logic in React.
- No WBS rollups or summary calculations in React.
- No hierarchy inference from dependency relationships in React.
- No wholesale restoration of old WIP UI.

---

## 4. Gemini Dry-Run Result

Gemini dry-run review for #48 accepted the R5 parent issue structure and confirmed R5A as the correct first implementation slice.

Gemini refinements adopted:

1. Hierarchy depth must come from existing Worker / Translator / UI projection metadata.
2. React must not calculate WBS rollups, summary values, dates, duration, float, or criticality.
3. R5D virtualization work must remain a separate future slice.

---

## 5. ChatGPT Review Result

ChatGPT reviewed Gemini output and accepted the refinements. ChatGPT also completed a pre-implementation codebase review when Copilot's optional plan-only PR did not produce implementation changes.

Finding:

- `TaskTable.tsx` owns TaskTable row rendering.
- `TaskTable.test.ts` is the correct focused unit test file.
- `Task` already exposes `depth`, `isSummary`, and `parentId` in protocol metadata.
- R5A is feasible without Worker/protocol/Rust/WASM/import/parser changes.

---

## 6. Human Approval Result

Human planning-scope approval and implementation approval were recorded in #48 before this implementation request.

---

## 7. Optional Copilot Pre-Review Result

PR #49 was created as a plan-only pre-implementation PR. It was closed unmerged because it contained 0 changed files and no implementation. Its planning findings were retained as reference in #48.

---

## 8. Files Changed

```text
apps/web/src/components/TaskTable.tsx
apps/web/src/components/TaskTable.test.ts
docs/milestones/W5B-UI.R5-tasktable-wbs-professional-view.md
```

Note: `apps/web/src/index.css` was intentionally not changed. The R5A visual refinement is kept self-contained in `TaskTable.tsx` to reduce global CSS risk.

---

## 9. Files Explicitly Not Changed

```text
packages/worker/**
packages/protocol/**
packages/cpm-wasm/**
packages/cpm-kernel/**
crates/**
apps/web/src/import/**
apps/web/src/services/import/**
apps/web/src/worker*.ts
apps/web/src/**/*Worker*.ts
apps/web/src/App.tsx
apps/web/src/components/gantt/**
package.json
pnpm-lock.yaml
.github/**
```

---

## 10. Architecture Guardrails Confirmation

Confirmed:

- React remains display/projection only.
- Worker remains source of truth.
- No scheduling calculations were added to React.
- No WBS rollups or summary values are calculated in React.
- No hierarchy inference from dependencies was added.
- No import/load protocol behavior was changed.
- No Gantt behavior was changed.

---

## 11. WBS Hierarchy Display Behaviour

Implemented behavior:

- Existing `task.depth` is used through `getTaskIndentPx()` for safe display indentation.
- Existing `task.isSummary` is used through `getTaskRowKind()` for summary/activity classification.
- Summary rows receive distinct row background and border treatment.
- Summary rows retain collapse/expand affordance.
- Activity rows retain normal display behavior.
- Imported order is not changed.

---

## 12. Missing Metadata Handling

`getTaskIndentPx()` defensively handles invalid, missing, negative, or excessive depth values for display safety only.

This is not hierarchy reconstruction. It only prevents unsafe visual indentation values from reaching the DOM.

---

## 13. TaskTable/Gantt Preservation

Preserved:

- Existing TaskTable virtualization.
- Existing selected-row behavior.
- Existing critical-row marker behavior for activities.
- Existing editable-cell update path.
- Existing Gantt files and rendering path.

---

## 14. Validation Commands and Results

Required commands:

```bash
pnpm -C apps/web exec vitest run
pnpm -C apps/web exec tsc -b
```

Status at PR creation:

- Not run locally in this ChatGPT environment.
- Prior plan-only PR #49 reported `vitest` passing and `tsc -b` failing due to pre-existing unrelated unused locals in:
  - `apps/web/src/components/HistogramPane.tsx:149`
  - `apps/web/src/components/TaskDetailsPanel.test.ts:26`

PR reviewer should run the required commands before merge and document exact current results.

---

## 15. Manual Localhost Visual QA Notes

Required manual validation before merge:

1. Import XER.
2. Load to Workspace.
3. Confirm `IMPORT_SCHEDULE ack`.
4. Confirm Worker success path.
5. Confirm TaskTable rows render.
6. Confirm WBS / summary rows are visually distinguishable.
7. Confirm hierarchy indentation is visible.
8. Confirm activity rows remain readable.
9. Confirm Gantt still renders.
10. Confirm no `undefined`, `NaN`, or raw object values are visible.
11. Confirm 3,000+ row schedule remains usable.

---

## 16. Stop Conditions Encountered / Not Encountered

No stop conditions encountered during implementation.

Specifically, the implementation did not require:

- Worker changes.
- Protocol changes.
- Parser/import changes.
- Rust/WASM/kernel changes.
- Gantt changes.
- Virtualization rewrite.
- Package/lockfile changes.

---

## 17. Remaining Risks

- Final visual quality must be confirmed through localhost review with a real imported 3,000+ row XER schedule.
- Typecheck status must be confirmed in the PR environment because prior baseline had unrelated unused-local errors.
- R5B visual banding should remain separate and not be considered complete under this PR.

---

## 18. Recommended Next Slice

After R5A visual QA and merge decision:

```text
R5B — WBS banding / visual grouping
```

R5B should proceed only after R5A is validated and merged.
