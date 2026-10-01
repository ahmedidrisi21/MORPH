import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.{ts,tsx}",
      "apps/demo/**/*.test.{ts,tsx}",
      "scripts/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/.next/**", "**/*.golden.test.ts", "apps/demo/e2e/**"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["packages/core/src/**/*.ts"],
      exclude: ["**/*.test.ts", "packages/core/src/__fixtures__/**"],
      reporter: ["text-summary", "json-summary"],
      thresholds: { lines: 85, branches: 80 },
    },
  },
});
