import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Vite configuration for the React/TypeScript UI (Phase 4 adds the real
// components; this only wires the build + test tooling for the scaffold).
export default defineConfig({
  plugins: [react()],
  root: "src/ui",
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
