# [BUG] Import Load to Workspace does not populate TaskTable/Gantt after XER preview

## Investigation scope and outcome

This investigation was run as evidence-first (no product code changes). In the current local QA environment, the import flow cannot reach `PREVIEW_IMPORT -> IMPORT_SCHEDULE` because Worker startup fails before `WORKER_READY` due to unresolved `cpm-wasm` package entry.

This note includes two evidence sources:

1. Copilot sandbox environment evidence (startup blocked by missing wasm package artifact).
2. User localhost evidence (Worker-ready preview succeeds, then import commit fails after `Load to Workspace`).

Both are documented together to separate an environment-specific sandbox blocker from the actual user-reported localhost failure path.

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

- **Worker scheduling failure after `IMPORT_SCHEDULE`.**
- **`IMPORT_SCHEDULE` returns `error`.**
- **Imported programme is not committed because scheduling fails/rolls back.**
- **TaskTable/Gantt do not populate because imported non-empty state is never successfully emitted/committed.**

User-localhost evidence now confirms the failure point is after preview and inside the Worker scheduling/commit path.

## 14) Recommended fix scope

**Worker-level, evidence-driven scope**:

1. Inspect `IMPORT_SCHEDULE` handler behavior for imported programmes.
2. Inspect `runSchedulingAndEmitState()` error path and rollback/emit behavior.
3. Capture and classify the concrete `schedule-error path` / `IMPORT_SCHEDULE error` reason.
4. Verify whether failure is triggered by unsupported imported relationships, calendar/resource data, invalid task dates, dependency normalization edge cases, or wasm/kernel limits.
5. Keep TaskTable/Gantt unchanged until Worker emits a successful non-empty post-commit workspace state.

No Worker/protocol/parser/product behavior change is recommended at this stage of this investigation note.

## User Localhost Evidence — Worker-ready preview succeeds, commit fails

- Worker ready: **yes**.
- `PREVIEW_IMPORT` ack observed: **yes**.
- Import preview data is non-empty (example): **`taskCount: 3062`, `depCount: 5024`**.
- User clicks `Load to Workspace`: **yes**.
- `IMPORT_SCHEDULE` result: **`error`**.
- Worker `schedule-error path` observed for imported programme counts: **`taskCount: 3062`, `depCount: 5024`**.
- Worker emits/restores persisted fallback state after failure (example): **`taskCount: 6`, `depCount: 0`**.
- Status strip after commit remains: **`Tasks: 6 | Deps: 0 | Scheduled: 0 | Worker: Ready`**.
- Preview disappears after `Load to Workspace`: **yes**.
- TaskTable/Gantt remain unchanged because imported programme is not committed to workspace state.

Issue #41 should remain open, and follow-up should target Worker scheduling failure analysis in a Worker-ready environment.

## 15) Message-path checkpoint summary (`PREVIEW_IMPORT -> ... -> TaskTable/Gantt`)

| Checkpoint | Copilot sandbox evidence | User localhost evidence |
|---|---|---|
| PREVIEW_IMPORT sent | Not reached (worker startup blocked) | Reached, ack observed |
| IMPORT_PREVIEW received | Not reached (same blocker) | Reached, non-empty programme shown |
| IMPORT_SCHEDULE sent | Not reached (same blocker) | Sent after `Load to Workspace` |
| NACK/DIFF_STATE after import commit | Not reached (same blocker) | `IMPORT_SCHEDULE error` + schedule-error path observed |
| React tasks update | Not reached (same blocker) | Remains persisted fallback state (`tasks: 6`) |
| TaskTable/Gantt render imported tasks | Not reached (same blocker) | No imported render because commit fails/rolls back |

## 16) Temporary instrumentation usage

None used in this investigation PR.

## 17) Evidence pointers (commands/logs)

- `node -v` -> `v24.14.1`
- `corepack pnpm -v` -> `11.1.2`
- `corepack pnpm -C apps/web dev --host 127.0.0.1 --port 4173`
- `curl http://127.0.0.1:4173/@fs/.../packages/worker/src/wasm/loadCpmWasm.ts`
- Dev server logs showing `Failed to resolve entry for package "cpm-wasm"`
- `packages/cpm-wasm/package.json` points to `./pkg/cpm_wasm.js`; local `packages/cpm-wasm/pkg` missing
- User localhost evidence provided in PR review from browser runtime observations (console/message-path checkpoints): Worker-ready preview success + `IMPORT_SCHEDULE error` + schedule-error fallback to persisted state

## 18) Implementation gating recommendation

Do **not** implement TaskTable/Gantt product changes first; prioritize diagnosing and fixing Worker scheduling failure after `IMPORT_SCHEDULE` in a Worker-ready run.
