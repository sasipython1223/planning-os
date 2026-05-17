# 1. Executive Summary

This issue was executed as **audit-only** for `W5B-UI.RECOVERY.2A`.

`main` localhost (`127.0.0.1:5173`) and WIP reference localhost (`127.0.0.1:5174`, from `backup/wip-before-ai-workflow-2026-05-13`) were compared for visible product/UI parity.

Primary finding: current `main` still presents an early/basic command surface and incomplete workflow visibility versus WIP reference. The largest parity gaps are in **XER import usability**, **menu/toolbar command depth**, **TaskTable/WBS visual treatment**, and **Gantt bar visibility/state confidence**.

This document proposes recovery slices focused on **target product state** (not implementation detail).

# 2. Audit Scope

Compared visible product behavior/appearance for:

1. XER import visibility and workflow
2. Main menu / toolbar / command surface
3. Workspace layout / shell composition
4. TaskTable/WBS hierarchy visual behavior
5. Gantt bars / timescale / split layout
6. Right-side / side panels (if expected)
7. Bottom drawer / logs / histogram / task details
8. Data state after import or sample task creation visibility
9. Critical controls missing from current main

# 3. Source Baselines Compared

- Technical baseline: latest `main` (current branch based on latest main lineage)
- Current localhost baseline: `http://127.0.0.1:5173`
- Visual/product reference: `backup/wip-before-ai-workflow-2026-05-13`
- WIP localhost reference: `http://127.0.0.1:5174`
- WIP reference served from temporary worktree at `/tmp/planning-os-wip` (created with `git worktree add /tmp/planning-os-wip origin/backup/wip-before-ai-workflow-2026-05-13`)

# 4. Screenshot / Localhost Evidence Used

Evidence captured during this audit:

- Screenshot (current main): `/tmp/w5b-main-5173.png` (1280×720)
- Screenshot (WIP reference): `/tmp/w5b-wip-5174.png` (1280×720)
- Structured UI control/text extraction: `/tmp/w5b-ui-parity-observation.txt`
- Screenshot color-density comparison: `/tmp/w5b-ui-screenshot-metrics.txt`

Note: `/tmp/*` evidence artifacts are transient audit captures from this run and are not intended as permanent repository artifacts.

Observed command-surface delta from captured evidence:

- Main: 9 visible top-level buttons (`Histogram`, `Logs`, `Add Task`, `Link Last Two`, `Set Baseline`, `Clear Baseline`, `Undo`, `Redo`, `Import…`)
- WIP: 28 visible toolbar/menu controls (includes `File/Edit/View/Insert/Structure/Baseline/Help` menu surface and hierarchy commands like add child/sibling, expand/collapse, move, indent)

Known current observations (required carry-forward) are confirmed in this audit:

- Import button exists but XER import visibility/function is not acceptable.
- Toolbar remains too early/basic.
- TaskTable shows hierarchy rows but no expected WBS coloring/banding.
- Gantt area shows timescale/grid but no visible bars from tested state.
- Bottom drawer, task details, histogram, and logs region is visible.

# 5. Visual/Product Gap Table

| Area | WIP expected behavior / appearance | Current main behavior / appearance | Gap severity | Recovery recommendation | Proposed follow-up issue |
|---|---|---|---|---|---|
| XER import visibility/workflow | Import is clearly discoverable in a richer command context and should support obvious end-to-end user flow (select file → parse/import feedback → visible data result) | Import control exists, but visibility/usability is not acceptable in current shell context; workflow confidence remains low from current state | Critical | Recover import workflow to an unmistakable, user-confirmed state with clear affordance and post-import visible result criteria | `W5B-UI.RECOVERY.2B — XER Import Workflow Visual/UX Recovery` |
| Main menu / toolbar / command surface | Product-like menu + dense toolbar (File/Edit/View/Insert/Structure/Baseline/Help + hierarchy/task commands) | Early/basic toolbar with limited controls; lacks expected product command depth | High | Restore product-level command surface parity (menu taxonomy + core workflow actions visible without hidden context) | `W5B-UI.RECOVERY.2C — Menu/Toolbar Product Parity Recovery` |
| Workspace layout / shell composition | WIP shell presents clearer multi-region composition and workflow framing | Current layout reads as partial shell; core working regions remain less explicit | High | Restore shell composition so task editing, gantt inspection, and secondary panels read as one cohesive product workflow | `W5B-UI.RECOVERY.2D — Workspace Shell Composition Parity` |
| TaskTable / WBS visual behavior | WBS table exhibits expected hierarchy emphasis and visual banding/coloring cues | Hierarchy data rows visible, but expected WBS coloring/banding cues are not present | High | Recover WBS visual hierarchy treatment (banding/color cues) to match WIP readability goals | `W5B-UI.RECOVERY.2E — TaskTable/WBS Visual Hierarchy Parity` |
| Gantt bars / timescale / split layout | Timescale plus visible task bars and recognizable schedule rendering state | Timescale/grid visible but bars are not visibly rendering for tested state | Critical | Recover visible Gantt-bar rendering parity with explicit acceptance screenshots for non-empty schedule state | `W5B-UI.RECOVERY.2F — Gantt Bar Visibility & Split Parity` |
| Right/side panels | Side panels (if present in WIP workflow) should be clearly discoverable and integrated | Side-panel parity is unclear/not visibly recovered in current baseline | Medium | Reintroduce only WIP-validated side-panel surfaces that are necessary for core workflow parity | `W5B-UI.RECOVERY.2G — Side Panel Visibility Parity` |
| Bottom drawer / logs / histogram / task details | Bottom utility region present and behaves as integrated diagnostics/analysis surface | Bottom drawer/logs/histogram/task details region is visible (closest parity area) | Low | Preserve current working bottom region behavior while aligning visual polish with WIP shell style | `W5B-UI.RECOVERY.2H — Bottom Drawer Visual Alignment` |
| Data state visibility after import/sample creation | Imported or created tasks should immediately produce coherent table+gantt product state | Current state does not provide confident visual confirmation of full product flow | Critical | Define explicit “data-in → bars/table/panels visible” acceptance scene and require parity screenshots | `W5B-UI.RECOVERY.2I — Data-State Visual Confirmation Slice` |
| Missing critical controls | WIP includes structure operations (add child/sibling, expand/collapse, move, indent) and calendar/help affordances | Current main lacks most of these visible controls from shell surface | High | Recover missing high-value controls in priority order tied to workflow-critical user outcomes | `W5B-UI.RECOVERY.2J — Critical Command Surface Completion` |

# 6. XER Import Workflow Gap Analysis

- Current main has an import entry point, but usability/visibility is not at acceptable product level.
- In both captured pages, import appeared disabled while worker state remained `Worker: Starting...`; therefore this audit does **not** claim functional import parity from automated session alone.
- Human QA observation requiring carry-forward remains authoritative: import visibility/function is not acceptable on current main.

Required future acceptance state (product-level):

- Import affordance is obvious from primary shell controls.
- User can execute import without ambiguity.
- UI confirms imported data with immediate visible TaskTable + Gantt evidence.

# 7. App Shell / Toolbar Gap Analysis

- WIP exposes menu categories (`File`, `Edit`, `View`, `Insert`, `Structure`, `Baseline`, `Help`) and significantly broader command set.
- Current main shows a minimal action strip and lacks product-like menu architecture.
- Gap is not cosmetic only; command discoverability and workflow breadth are materially reduced.

# 8. TaskTable / WBS Gap Analysis

- Current main displays table headers/rows but does not present expected WBS visual banding/color hierarchy cues.
- WIP reference is expected to provide stronger hierarchy readability.
- This is a high-severity parity gap because structural readability is core to planning workflows.

# 9. Gantt / Timescale Gap Analysis

- Current main shows timescale/grid region.
- Visible task bars are not present in tested state, resulting in weak schedule visualization confidence.
- WIP expected state includes clearly visible bars/timescale interplay as part of core workflow.

# 10. Panels / Drawer / Histogram / Logs Gap Analysis

- Bottom drawer region (including histogram/logs/task details) is visibly present in current main.
- This is the nearest parity-positive area versus other shell surfaces.
- Remaining work here is alignment/integration polish, not foundational restoration.

# 11. Risk of Further Abstract Recovery

High risk if recovery proceeds as “abstract shell reconstruction” again:

- May reintroduce draft-like shell elements that do not match expected product workflow.
- May consume implementation effort without resolving visible parity acceptance blockers.
- May repeat prior rejection pattern from rejected shell-composition attempt.

Therefore each recovery slice must be driven by **before/after product evidence** and explicit visual acceptance checks.

# 12. Recommended Recovery Sequence

Evaluation of proposed sequence: **accepted as correct priority order**.

1. Recover XER import workflow visibility/function first.
2. Recover main menu / toolbar / command surface.
3. Recover TaskTable/WBS visual structure.
4. Recover Gantt/timescale bars and layout.
5. Recover side/right panels where WIP parity requires them.
6. Close parent issue `#25` only after visible product parity is confirmed end-to-end.

# 13. Proposed Follow-up Issues

Recommended follow-up issue set (product-state focused):

1. `W5B-UI.RECOVERY.2B — XER Import Workflow Visual/UX Recovery`
2. `W5B-UI.RECOVERY.2C — Menu/Toolbar Product Parity Recovery`
3. `W5B-UI.RECOVERY.2D — Workspace Shell Composition Parity`
4. `W5B-UI.RECOVERY.2E — TaskTable/WBS Visual Hierarchy Parity`
5. `W5B-UI.RECOVERY.2F — Gantt Bar Visibility & Split Parity`
6. `W5B-UI.RECOVERY.2G — Side Panel Visibility Parity`
7. `W5B-UI.RECOVERY.2H — Bottom Drawer Visual Alignment`
8. `W5B-UI.RECOVERY.2I — Data-State Visual Confirmation Slice`
9. `W5B-UI.RECOVERY.2J — Critical Command Surface Completion`

Each follow-up should require same-viewport screenshot evidence against WIP baseline and product-visible acceptance criteria.

# 14. Stop Conditions for Future Implementation

Stop implementation immediately if any slice:

- starts changing Worker/protocol/Rust/WASM contracts,
- introduces scheduling/authority/gate/tolerance behavior drift,
- attempts persistence/UAT/production enablement,
- attempts to unblock AI003,
- cannot demonstrate product-visible parity improvement for targeted slice,
- broadens beyond declared slice scope.

Parent issue `sasipython1223/planning-os#25` must remain open until full visible parity confirmation is completed.

# 15. Safety Confirmation

Confirmed for this issue execution:

- This is **documentation-only**.
- No production code changed.
- No UI implementation files changed.
- No Worker/protocol/Rust/WASM changes.
- No scheduling logic changes.
- No authority/gate/tolerance changes.
- No persistence/UAT/production enablement.
- AI003 was not modified and remains blocked.
- No recovery implementation PR content was produced from this issue; only this audit document was added.

## Validation Commands and Output

Executed as requested:

```bash
git status --short
# (clean before doc write; doc file added after write)

git branch --show-current
# copilot/w5b-ui-recovery-visual-parity-audit

git log --oneline -5
# e376597 Initial plan
# 970b272 Merge pull request #28 ...
# a12182c style(web): preserve toolbar/topbar font and cursor parity
# 82bd0e1 feat(web): apply controlled shell chrome restore and add phase2 evidence
# 2f8d4a2 Initial plan
```

Localhost runs used for audit evidence:

```bash
pnpm -C apps/web exec vite --host 127.0.0.1 --port 5173
# WIP worktree separately on 5174
```
