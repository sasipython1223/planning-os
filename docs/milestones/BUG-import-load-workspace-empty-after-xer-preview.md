# [BUG] Import Load to Workspace does not populate TaskTable/Gantt after XER preview

## Investigation scope and outcome

This investigation was run as evidence-first (no product code changes). In the current local QA environment, the import flow cannot reach `PREVIEW_IMPORT -> IMPORT_SCHEDULE` because Worker startup fails before `WORKER_READY` due to unresolved `cpm-wasm` package entry.

This is a **partial investigation finding for the Copilot sandbox environment only**. It does **not** yet prove the root cause of the user-reported localhost symptom (preview visible, then Load to Workspace does not populate TaskTable/Gantt).

## 1) Reproduction steps

1. Open repo at `/home/runner/work/planning-os/planning-os`.
2. Start web dev server:
   - `corepack pnpm -C apps/web dev --host 127.0.0.1 --port 4173`
3. Verify served app module wiring (`/src/App.tsx`) references Worker entry:
   - `new URL("/@fs/.../packages/worker/worker.ts?worker_file&type=module", import.meta.url)`
4. Request Worker WASM loader module endpoint from dev server:
   - `/@fs/.../packages/worker/src/wasm/loadCpmWasm.ts`
5. Observe Vite import-analysis error response and server log diagnostics.
6. Restart dev server and repeat; also request with cache-busting query (`?t=<timestamp>`) to rule out cache.

## 2) Imported file/sample used

Prepared minimal valid XER sample for QA reproduction attempts:

- `/tmp/planning-os-investigation/minimal-valid.xer`

(Import execution via browser UI was blocked by Worker startup failure; sample prepared but flow could not proceed to preview/commit in this environment.)

## 3) Environment/setup checks

- **Repository path served from expected workspace:** `/home/runner/work/planning-os/planning-os`
- **Node.js:** `v24.14.1`
- **pnpm:** `11.1.2`
- **Browser used:** Browser UI automation via Playwright Chromium was unavailable in this sandbox (browser lock/permission issue). Runtime evidence was collected from Vite-served modules, HTTP responses, and dev-server logs.
- **Dev server command used:** `corepack pnpm -C apps/web dev --host 127.0.0.1 --port 4173`
- **WASM package/build artifact availability:** `packages/cpm-wasm/pkg` is missing locally.
- **Browser/dev-server console errors:** Vite repeatedly reports:
  - `Failed to resolve entry for package "cpm-wasm"`
  - Location: `packages/worker/src/wasm/loadCpmWasm.ts` at `import("cpm-wasm")`
- **Worker startup status:** startup fails before ready (no successful wasm load path).
- **Cache/hard-refresh ruled out:** same error after restart and with cache-busting querystring.
- **Dev server restart check:** repeated same failure after restart.
- **Known minimal import file check:** minimal XER file prepared (above), but runtime import flow blocked before preview stage.

## 4) Whether `PREVIEW_IMPORT` is sent

Not observed in this environment because Worker readiness is blocked by WASM package resolution failure. UI import flow is worker-ready-gated.

## 5) Whether `IMPORT_PREVIEW` is received and non-empty

Not observed (same startup blocker).

## 6) Whether `IMPORT_SCHEDULE` is sent

Not observed (same startup blocker).

## 7) Whether `NACK` or `DIFF_STATE` is received after `IMPORT_SCHEDULE`

Not observed (same startup blocker).

## 8) If `DIFF_STATE` is received, payload task count

N/A in this environment (no `DIFF_STATE` observed for import flow).

## 9) Whether WASM is loaded/available

No. Evidence:

- `packages/cpm-wasm/package.json` exports `./pkg/cpm_wasm.js`
- `packages/cpm-wasm/pkg` directory missing
- Vite cannot resolve package entry for `cpm-wasm`

## 10) Whether scheduling rollback occurs

Not observed in this environment because import commit path did not execute.

## 11) Whether React `tasks` state updates

Not observed for import path in this environment (startup blocker before import commands).

## 12) Whether TaskTable/Gantt receive non-empty tasks

Not observed for import path in this environment (startup blocker before import commands).

## 13) Root cause classification

### Root cause classification for Copilot investigation environment

- **Environment/setup blocker**
- **WASM unavailable / WASM not initialized**

The currently observed failure point is earlier than the reported issue path: Worker cannot initialize due to unresolved `cpm-wasm` entry.

### Root cause classification for the user-reported localhost issue

- **Not yet proven.**
- Requires evidence from an environment where import preview succeeds and `Load to Workspace` can be clicked.

The user-reported path (preview success followed by empty TaskTable/Gantt after commit) was **not** reproduced in this run because this environment failed earlier at Worker startup.

## 14) Recommended fix scope

**Environment/setup-level** first:

1. Ensure `packages/cpm-wasm/pkg` exists before running web QA (or ensure the equivalent generated artifact is available to Vite resolution).
2. Re-run the exact UI reproduction after WASM availability is restored.
3. Only if the original symptom still reproduces (preview succeeds but load does not populate), proceed with targeted instrumentation of:
   - `IMPORT_SCHEDULE` dispatch
   - post-commit `NACK` vs `DIFF_STATE`
   - `DIFF_STATE.payload.tasks.length`
   - scheduling rollback path

No Worker/protocol/parser/product behavior change is recommended at this stage of this investigation note.

## Next Evidence Required From User Localhost

Collect evidence from a Worker-ready localhost environment where preview is visible and `Load to Workspace` is clicked:

1. Browser console logs immediately after clicking `Load to Workspace`.
2. Whether `IMPORT_SCHEDULE` is sent.
3. Whether `NACK` or `DIFF_STATE` is received after `IMPORT_SCHEDULE`.
4. If `DIFF_STATE` is received, `DIFF_STATE.payload.tasks.length`.
5. Whether React `tasks.length` updates after commit.
6. Whether status strip/activity count changes after commit.

Issue #41 should remain open until those checkpoints are captured and the preview->commit failure point is proven in that environment.

## 15) Message-path checkpoint summary (`PREVIEW_IMPORT -> ... -> TaskTable/Gantt`)

| Checkpoint | Status in this run | Evidence |
|---|---|---|
| PREVIEW_IMPORT sent | Not reached | Worker not ready due to wasm resolution failure |
| IMPORT_PREVIEW received | Not reached | Same blocker |
| IMPORT_SCHEDULE sent | Not reached | Same blocker |
| NACK/DIFF_STATE after import commit | Not reached | Same blocker |
| React tasks update | Not reached | Same blocker |
| TaskTable/Gantt render imported tasks | Not reached | Same blocker |

## 16) Temporary instrumentation usage

None used in this investigation PR.

## 17) Evidence pointers (commands/logs)

- `node -v` -> `v24.14.1`
- `corepack pnpm -v` -> `11.1.2`
- `corepack pnpm -C apps/web dev --host 127.0.0.1 --port 4173`
- `curl http://127.0.0.1:4173/@fs/.../packages/worker/src/wasm/loadCpmWasm.ts`
- Dev server logs showing `Failed to resolve entry for package "cpm-wasm"`
- `packages/cpm-wasm/package.json` points to `./pkg/cpm_wasm.js`; local `packages/cpm-wasm/pkg` missing

## 18) Implementation gating recommendation

Do **not** implement product fix for TaskTable/Gantt population until environment-level wasm initialization is corrected and the original preview->commit symptom is re-verified under a worker-ready run.
