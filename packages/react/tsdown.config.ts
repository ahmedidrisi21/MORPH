import { defineConfig } from "tsdown";

// Library build (SPEC §14 M8): ESM + .d.ts. React, motion and @morph/core stay external.
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: "esm",
  platform: "neutral",
  dts: true,
  clean: true,
  outDir: "dist",
});
