import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/demo/**/*.golden.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**"],
    environment: "node",
    testTimeout: 30_000,
    passWithNoTests: true,
  },
});
