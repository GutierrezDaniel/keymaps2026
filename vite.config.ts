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
    setupFiles: ["./test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "App.tsx",
        "api.tsx",
        "components/**/*.tsx",
        "helpers/**/*.tsx",
        "contexts/**/*.tsx",
      ],
      exclude: ["**/*.test.tsx", "**/*.test.ts", "**/test/**"],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
