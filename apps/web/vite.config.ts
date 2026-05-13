import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait()],
  resolve: {
    alias: [
      { find: "@planner/protocol/kernel", replacement: path.resolve(__dirname, "../../packages/protocol/src/kernel.ts") },
      { find: "@planner/protocol/types", replacement: path.resolve(__dirname, "../../packages/protocol/src/types.ts") },
      { find: "@planner/protocol/domain", replacement: path.resolve(__dirname, "../../packages/protocol/src/domain.ts") },
      { find: "@planner/protocol/activities", replacement: path.resolve(__dirname, "../../packages/protocol/src/activities.ts") },
      { find: "@planner/protocol/compiler", replacement: path.resolve(__dirname, "../../packages/protocol/src/compiler.ts") },
      { find: "@planner/protocol/schedule", replacement: path.resolve(__dirname, "../../packages/protocol/src/schedule.ts") },
      { find: "@planner/protocol", replacement: path.resolve(__dirname, "../../packages/protocol/src/index.ts") },
    ],
  },
  server: {
    fs: {
      allow: ["../.."]
    },
    proxy: {
      "/api/ai": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  worker: {
    format: "es",
    plugins: () => [wasm(), topLevelAwait()]
  }
});