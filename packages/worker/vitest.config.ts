import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
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
  },
});
