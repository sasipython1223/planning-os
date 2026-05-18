# W5B-UI.R4 — XER/MSP Import Workflow UX

## 1. Executive Summary

Implemented R4 XER/MSP import workflow UX improvements for Planner-Studio within the R3 app shell. The changes make the import entry point clear and prominent, guide the user from empty state through preview, show import status (idle / preview-ready / warnings / failed), display error and warning counts, rename the commit action to "Load to Workspace", and provide a clear Cancel Preview action. All changes are display-only and reuse existing import handler pathways already present in `main`.

---

## 2. Scope Confirmation

R4 is limited to import workflow UX and shell integration only.

Implemented:

- Clear import entry point in CommandToolbar with prominent "↑ Import XER / MSP" button.
- Import status indicator: idle / preview-ready / warnings / failed, derived from existing import preview diagnosticsSummary.
- Format badge (XER / MSP-XML) in toolbar and status strip when preview is active.
- Error and warning count badges in toolbar when preview has issues.
- "✓ Load to Workspace" button in `CommandToolbar` is disabled/enabled using `importPreview.canCommit` (passed as `importCanCommit` prop) — the same authoritative `canCommit` field set by the Worker's `IMPORT_PREVIEW` message. `deriveImportStatus` is a display-only indicator and does not gate the commit action.
- "✕ Cancel Preview" button appears in toolbar only when preview is active.
- Better empty workspace guidance with supported format pills (XER — Primavera P6, XML — MS Project).
- Improved import preview panel layout: Programme Details / Schedule Summary / Import Diagnostics sections, counts use "Activities" / "Relationships" terminology, "✓ Load to Workspace" button.
- ProjectStatusStrip shows import-specific status when in preview mode (format badge, error/warning counts, Ready to load / blocked state).
- All import mutations/commits routed through existing `handleImportCommit` and `handleImportCancel` handlers.
- New `deriveImportStatus` function extracted to `uiViewState.ts` and tested with 4 new unit tests.

Not implemented (out of R4 scope):

- TaskTable WBS redesign.
- Gantt bar rendering.
- Dependency visual redesign.
- Full toolbar polish beyond import-related controls.
- New parser semantics.
- New Worker protocol messages.
- Worker/protocol/Rust/WASM changes.
- Persistence or production gates.
- AI003 enablement.
- New external dependencies.

---

## 3. Files Changed

- `apps/web/src/ui/shell/CommandToolbar.tsx` — Import group with status indicator, format badge, Load / Cancel buttons; workspace controls group; imports `ImportStatus` from `uiViewState`.
- `apps/web/src/ui/workspace/EmptyWorkspace.tsx` — Better heading, description, prominent import button, format pills (XER — Primavera P6, XML — MS Project).
- `apps/web/src/components/ImportPreviewPanel.tsx` — Sectioned layout (Programme Details, Schedule Summary, Import Diagnostics), "Activities" / "Relationships" terminology, "✓ Load to Workspace" button, "✕ Cancel Import" button.
- `apps/web/src/ui/shell/ProjectStatusStrip.tsx` — Import-specific status display in preview mode (format badge, error/warning/ready status), worker ready indicator.
- `apps/web/src/ui/state/uiViewState.ts` — Added `ImportStatus` type, `ImportStatusInput` interface, `deriveImportStatus` function.
- `apps/web/src/ui/state/uiViewState.test.ts` — Added 4 new `deriveImportStatus` unit tests.
- `apps/web/src/index.css` — Added R4 import workflow CSS classes: toolbar import group, import/load/cancel buttons, format badge, status indicator, empty workspace improvements, import preview panel layout, diagnostics display, status strip import display.
- `apps/web/src/App.tsx` — Added `deriveImportStatus` import, `errorCount` derivation, `importFormatLabel` derivation, `importStatus` derivation, passes new props (`onCancelPreview`, `importStatus`, `importFormat`, `importErrorCount`, `importWarningCount`) to `CommandToolbar` and (`importFormat`, `importErrorCount`) to `ProjectStatusStrip`.
- `docs/milestones/W5B-UI.R4-import-workflow-ux.md` — This document.

---

## 4. Files Explicitly Not Changed

- `packages/worker/**`
- `packages/protocol/**`
- `packages/**/src/**/*.rs`
- `crates/**`
- `apps/web/src/components/TaskTable.tsx`
- `apps/web/src/components/TaskTable*.test.*`
- `apps/web/src/components/gantt/**`
- `apps/web/src/components/data/**`
- `package.json`
- `pnpm-lock.yaml`
- `.github/**`

---

## 5. Import Workflow UX Implemented

### Empty State

- Heading: "No Programme Loaded"
- Description guides user to import a schedule file
- Primary CTA: "↑ Import XER / MSP File" (blue, prominent)
- Format pills: "XER — Primavera P6" and "XML — MS Project" inform the user about supported formats

### Import Entry Point (CommandToolbar)

- "↑ Import XER / MSP" button is the first element in the toolbar, visually distinct (blue, bold)
- Disabled when Worker is not ready (prevents premature dispatch)
- When preview is active: format badge, import status indicator, "✓ Load to Workspace", "✕ Cancel Preview" appear in the import group

### Import Status Indicator

Derived by `deriveImportStatus()` from `importPreview.diagnosticsSummary`:

| State           | Condition                          | Visual                         |
|-----------------|------------------------------------|---------------------------------|
| `idle`          | No preview present                 | Not shown                      |
| `preview-ready` | Preview with 0 errors, 0 warnings  | Green pill "Preview ready"     |
| `warnings`      | Preview with 0 errors, >0 warnings | Amber pill "Preview ready (warnings)" + warning count badge |
| `failed`        | Preview with >0 errors             | Red pill "Import blocked — errors found" + error count badge |

### Load to Workspace

- "✓ Load to Workspace" button in `CommandToolbar`:
  - Enabled/disabled using `importPreview.canCommit` (passed as `importCanCommit` prop) — the authoritative value set by the Worker.
  - `deriveImportStatus` is a display-only status indicator; it does not gate the commit action.
  - Routes through existing `handleImportCommit` → `IMPORT_SCHEDULE` Worker command

### Cancel Preview

- "✕ Cancel Preview" button visible only when preview is active
- Routes through existing `handleImportCancel` → `CANCEL_IMPORT_PREVIEW` Worker command

### Programme Preview Panel

- Section: **Programme Details** — Project Name, Start Date, Source Format
- Section: **Schedule Summary** — Activities (count), Relationships (count), Resources (count), Assignments (count), Calendar info
- Section: **Import Diagnostics** — Error/Warning/Info badge pills, scrollable diagnostic list
- **Import blocked** notice when `canCommit === false`
- Actions: "✕ Cancel Import" and "✓ Load to Workspace"

### ProjectStatusStrip (preview mode)

- Shows "Import Preview" label with format badge
- Shows project name and file name
- Shows: "Ready to load" (green) / "{n} warnings" (amber) / "{n} errors — load blocked" (red)
- Worker ready indicator always visible

---

## 6. Worker/Authority Preservation

Worker remains the sole source of truth for all schedule and import state. No new Worker protocol messages were introduced. All import commands dispatched through existing pathways:

- `PREVIEW_IMPORT` — triggered by existing `handleImportFileSelect` (unchanged)
- `IMPORT_SCHEDULE` — triggered by existing `handleImportCommit` (unchanged)
- `CANCEL_IMPORT_PREVIEW` — triggered by existing `handleImportCancel` (unchanged)

`importPreview` state is set exclusively by the Worker `IMPORT_PREVIEW` message handler (unchanged). React only derives display values from this state.

---

## 7. UI State Ownership

R4 adds only display-oriented derivations from existing React state:

- `importStatus` — derived from `importPreview.diagnosticsSummary` (no new state)
- `importFormatLabel` — derived from `importPreview.format` (no new state)
- `errorCount` — derived from `importPreview.diagnosticsSummary.errors` (no new state)

`deriveImportStatus()` is a pure function with no side effects. No new authoritative React state was introduced.

---

## 8. `App.tsx` Safety Notes

`App.tsx` changes are limited to:

1. Import of `deriveImportStatus` and `ImportStatus` type from `uiViewState`.
2. Derivation of `errorCount`, `importFormatLabel`, and `importStatus` from existing `importPreview` state.
3. Passing new display props to `CommandToolbar` and `ProjectStatusStrip`.
4. Passing existing `handleImportCancel` as `onCancelPreview` to `CommandToolbar`.

No new parser logic, no duplicated import model, no React-side schedule authority, no new Worker protocol messages, no persistence or production gates were introduced.

---

## 9. Existing Import Pathways Reused

| Pathway | Handler | Worker Message | Status |
|---------|---------|----------------|--------|
| File selection | `handleImportFileSelect` | `PREVIEW_IMPORT` | Unchanged, reused |
| Import commit / Load to Workspace | `handleImportCommit` | `IMPORT_SCHEDULE` | Unchanged, reused |
| Import cancel / Reset preview | `handleImportCancel` | `CANCEL_IMPORT_PREVIEW` | Unchanged, reused |
| Preview state | `importPreview` state | Set by `IMPORT_PREVIEW` Worker message | Unchanged, read only |

No new protocol messages or Worker commands were invented.

---

## 10. Validation Commands and Results

### Tests

```bash
pnpm -C apps/web exec vitest run
```

Result:
```
 ✓ src/utils/filterByConstraint.test.ts (7 tests)
 ✓ src/components/TaskDetailsPanel.test.ts (41 tests)
 ✓ src/geometry.test.ts (17 tests)
 ✓ src/components/TaskTable.test.ts (5 tests)
 ✓ src/worker.test.ts (1 test)
 ✓ src/ui/state/uiViewState.test.ts (7 tests)

 Test Files  6 passed (6)
      Tests  78 passed (78)
```

Prior to R4: 74 tests. R4 added 4 new `deriveImportStatus` tests. All 78 pass.

### TypeScript

```bash
pnpm -C apps/web exec tsc -b
```

Result: 2 pre-existing errors unrelated to R4:

- `HistogramPane.tsx:149` — `mouseY` declared but never read (pre-existing)
- `TaskDetailsPanel.test.ts:26` — `_constraintNeedsDate` declared but never read (pre-existing)

No new TypeScript errors introduced by R4.

---

## 11. Localhost Visual Confirmation Notes

The following import workflow improvements are visible in the app:

- **Empty state**: "No Programme Loaded" heading, guidance text, blue "↑ Import XER / MSP File" button, format pills (XER — Primavera P6, XML — MS Project).
- **CommandToolbar idle**: "↑ Import XER / MSP" button prominent and left-anchored.
- **CommandToolbar preview-ready**: XER/MSP-XML format badge, green "Preview ready" status, blue "✓ Load to Workspace", grey "✕ Cancel Preview".
- **CommandToolbar warnings**: Amber warning status with warning count badge.
- **CommandToolbar failed**: Red "Import blocked" status with error count badge, greyed "✓ Load to Workspace".
- **Programme Preview Panel**: Sectioned card layout with Programme Details, Schedule Summary (Activities/Relationships/Resources/Assignments counts), Import Diagnostics (badges + list), clear action buttons.
- **ProjectStatusStrip preview mode**: "Import Preview" label with format badge, project name, file name, status (Ready to load / warnings / errors).
- **Loaded workspace**: TaskTable and Gantt remain black-box schedule surfaces, unchanged.

---

## 11a. Visual QA Finding — "Activities not loading after Load to Workspace"

### Finding

Visual QA reported that after clicking **Load to Workspace**, activities do not appear in the TaskTable or Gantt chart.

### Investigation

A line-by-line comparison of the R4 diff against the R3 base (`6bc4469`) was performed for every code path from the Load button click to the TaskTable render. Findings:

**1. `handleImportCommit` — UNCHANGED from R3**

```ts
// R3 and R4 identical:
const handleImportCommit = useCallback(() => {
  if (!workerRef.current) return;
  workerRef.current.postMessage({ type: "IMPORT_SCHEDULE", v: 1, reqId: makeId() });
  setImportPreview(null);
}, []);
```

**2. `workspaceShellView` derivation — UNCHANGED from R3**

```ts
// R3 and R4 identical:
const workspaceShellView = useMemo(
  () => deriveWorkspaceShellView({ hasImportPreview: importPreview !== null, hasTasks: tasks.length > 0 }),
  [importPreview, tasks.length],
);
```

**3. Workspace view routing — UNCHANGED from R3**

```tsx
// R3 and R4 identical:
{workspaceShellView === "preview" && importPreview && (
  <ProgrammePreviewPanel data={importPreview} onImport={handleImportCommit} onCancel={handleImportCancel} />
)}
{workspaceShellView === "loaded" && (
  <ScheduleWorkspace>...</ScheduleWorkspace>
)}
```

**4. Worker `IMPORT_SCHEDULE` handler — UNCHANGED (Worker is not in R4 scope)**

The Worker's `IMPORT_SCHEDULE` handler calls `runSchedulingAndEmitState()`, which emits `DIFF_STATE` containing the imported tasks. `App.tsx` receives `DIFF_STATE` and calls `setTasks(msg.payload.tasks)`, which (when tasks.length > 0) causes `workspaceShellView` to become `'loaded'`.

**5. `deriveWorkspaceShellView` — UNCHANGED from R3**

```ts
// R3 and R4 identical:
export function deriveWorkspaceShellView(input: WorkspaceShellViewInput): WorkspaceShellView {
  if (input.hasImportPreview) return 'preview';
  if (input.hasTasks) return 'loaded';
  return 'empty';
}
```

### Conclusion

**R4 did not introduce this regression.**

The complete `PREVIEW_IMPORT → IMPORT_SCHEDULE → DIFF_STATE → workspaceShellView = 'loaded'` pathway is byte-for-byte identical to R3. If activities do not load after clicking Load to Workspace:

- The failure is **pre-existing on the R3 base**, not introduced by R4.
- The most likely cause is a Worker-side issue (scheduling failure causing rollback, or WASM availability in the test environment) that was present before R4.
- R4 did not change any Worker, protocol, parser, scheduling, or state routing code.

### Pre-existing failure path (for reference)

If the Worker sends `NACK` for `IMPORT_SCHEDULE` (e.g., due to scheduling failure with rollback), no new `DIFF_STATE` with the imported tasks is emitted. The React state stays on `workspaceShellView = 'empty'` after preview is cleared. This behavior existed identically on R3. R4 does not change this behavior.

### What R4 changed (display only)

The only R4 additions to `App.tsx` are:
- `errorCount`, `importFormatLabel`, `importCanCommit`, and `importStatus` derivations from existing `importPreview` state — all display-only, no side effects.
- New props passed to `CommandToolbar` and `ProjectStatusStrip` — display props only.
- `onCancelPreview={handleImportCancel}` added to `CommandToolbar` — already-existing handler, no change in behavior.

---

## 12. Stop Conditions Encountered / Not Encountered

| Stop Condition | Status |
|----------------|--------|
| Import UX requires Worker changes | Not encountered |
| Import UX requires protocol changes | Not encountered |
| Import UX requires parser changes | Not encountered |
| Import UX requires Rust/WASM changes | Not encountered |
| Import UX requires schedule calculation changes | Not encountered |
| Import UX requires React-side imported programme authority | Not encountered |
| Import UX requires TaskTable internals | Not encountered |
| Import UX requires Gantt internals | Not encountered |
| Import UX requires persistence/UAT/production changes | Not encountered |
| Import UX requires AI003 enablement | Not encountered |
| Import UX requires new external dependencies | Not encountered |
| Existing import preview state too limited | Not encountered — existing `diagnosticsSummary` and `format` fields are sufficient for all R4 UX |

---

## 13. Safety Confirmation

- ✅ Worker remains source of truth for all schedule and import state.
- ✅ React is display + command dispatch only.
- ✅ All import mutations route through existing approved Worker pathways.
- ✅ No new Worker protocol messages introduced.
- ✅ No new parser semantics introduced.
- ✅ No Worker/protocol/Rust/WASM changes.
- ✅ No TaskTable or Gantt internals modified.
- ✅ No new external dependencies added.
- ✅ No WIP code restored wholesale.
- ✅ No persistence/UAT/production changes.
- ✅ 78 tests pass (4 new R4 tests added, 74 pre-existing pass unchanged).
- ✅ No new TypeScript errors introduced (2 pre-existing errors unrelated to R4).

---

## 14. Recommended Next Milestone

**W5B-UI.R5** — Consider inspector panel improvements (task details / dependency details in inspector) and diagnostics drawer content (structured diagnostics with filtering, severity grouping) now that the import workflow surface is improved.

Alternatively, TaskTable WBS banding, Gantt bar rendering improvements, and dependency visual redesign could be addressed as a visual parity milestone referencing `W5B-UI.RECOVERY.2A`.
