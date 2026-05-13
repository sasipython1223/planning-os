# Integration tests — local/on-demand only

Files in this directory exercise the **real** `cpm-wasm` artifact.

**Rules (W5B-B2.12A.8):**

- Tests here MUST NOT be wired into CI or any default test script.
- Tests here MUST NOT call `vi.mock` on `loadCpmWasm.ts`, any WASM bridge,
  or any boundary module.
- Tests here consume `packages/cpm-wasm/pkg/` as a **read-only**, already
  built artifact. Do not add rebuild logic to these tests.
- Tests here MUST NOT import or read AI003 fixtures.
- Tests here MUST NOT modify any production source file or production
  configuration (vitest config, tsconfig, package scripts, CI workflows).

## Run on demand only

Integration tests use the `.itest.ts` extension (instead of `.test.ts`) so
that the default vitest config — `packages/worker/vitest.config.ts`, which
globs `**/*.{test,spec}.ts` — does **not** pick them up. Running the default
suite (`pnpm -C packages/worker test`) therefore excludes this directory.

To run an integration test, invoke the **dedicated** integration config
(`packages/worker/vitest.integration.config.ts`), which wires
`vite-plugin-wasm` + `vite-plugin-top-level-await` so the real wasm-pack
bundler artifact at `packages/cpm-wasm/pkg/cpm_wasm.js` can be loaded
through production `loadCpmWasm.ts` without modification:

```bash
pnpm -C packages/worker exec vitest \
  -c vitest.integration.config.ts run \
  tests/integration/<file>.itest.ts
```

The dedicated integration config and the `.itest.ts` extension convention
are sanctioned by milestone **W5B-B2.12A.8.1 — Real-WASM Loader Harness
Wiring** (see `docs/milestones/`). They exist solely to unblock the
B2.12A.8 boundary tests; they do not change the default test run, CI, or
any production code path.

### Build precondition

If the build precondition is not met (artifact missing or stale relative to
sources), STOP and rebuild manually via `pnpm -C packages/cpm-wasm run build`
**outside** the test run. Do not embed rebuild steps in test files.
