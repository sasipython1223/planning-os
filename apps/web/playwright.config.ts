import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.pw.ts",
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4199",
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 4199 --strictPort",
    url: "http://127.0.0.1:4199",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
