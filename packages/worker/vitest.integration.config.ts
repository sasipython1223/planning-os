/**
 * TEST-ONLY VITEST CONFIG — DO NOT IMPORT FROM PRODUCTION.
 *
 * Dedicated integration-test config for W5B-B2.12A.8.1.
 *
 * Purpose:
 *   Provide a sanctioned, local/on-demand execution environment that can
 *   load and run the real `cpm-wasm` bundler-target artifact through the
 *   production `loadCpmWasm` path. The default config
 *   (`packages/worker/vitest.config.ts`) intentionally does NOT enable
 *   WASM handling — that constraint is preserved.
 *
 * Rules (W5B-B2.12A.8.1):
 *   - This file MUST NOT be referenced by CI, by the worker's
 *     `package.json` `"test"` script, or by any default script.
 *   - Run on demand only:
 *       pnpm -C packages/worker exec vitest \
 *         -c vitest.integration.config.ts run \
 *         tests/integration/<file>
 *   - Targets only `tests/integration/**` by include pattern.
 *   - Adds the same WASM plugins already sanctioned in
 *     `apps/web/vite.config.ts` (`vite-plugin-wasm` +
 *     `vite-plugin-top-level-await`) to handle the
 *     `wasm-pack --target bundler` artifact:
 *       `import * as wasm from "./cpm_wasm_bg.wasm";`
 *   - Mirrors the alias map of the default worker vitest config so that
 *     `@planner/protocol/*` imports resolve identically. The default
 *     config is not modified.
 *
 * Build precondition:
 *   `packages/cpm-wasm/pkg/cpm_wasm_bg.wasm` must already exist (built
 *   via `pnpm -C packages/cpm-wasm run build`). This config does NOT
 *   trigger a rebuild.
 */

import path from "node:path";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
  resolve: {
    alias: {
      "@planner/protocol/kernel": path.resolve(__dirname, "../protocol/src/kernel.ts"),
      "@planner/protocol/types": path.resolve(__dirname, "../protocol/src/types.ts"),
      "@planner/protocol/domain": path.resolve(__dirname, "../protocol/src/domain.ts"),
      "@planner/protocol/activities": path.resolve(__dirname, "../protocol/src/activities.ts"),
      "@planner/protocol/compiler": path.resolve(__dirname, "../protocol/src/compiler.ts"),
      "@planner/protocol/schedule": path.resolve(__dirname, "../protocol/src/schedule.ts"),
      "@planner/protocol/import": path.resolve(__dirname, "../protocol/src/import.ts"),
      "@planner/protocol": path.resolve(__dirname, "../protocol/src/index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    // Integration tests use `.itest.ts` extension so the default vitest
    // config (which globs `**/*.{test,spec}.ts`) does not pick them up —
    // preserving the rule that this harness is not wired into the
    // default test run while leaving `vitest.config.ts` untouched.
    include: ["tests/integration/**/*.itest.ts"],
  },
});
