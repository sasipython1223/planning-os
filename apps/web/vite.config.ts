import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait()],
  server: {
    fs: {
      allow: ["../.."]
    }
  },
  worker: {
    format: "es",
    plugins: () => [wasm(), topLevelAwait()]
  }
});