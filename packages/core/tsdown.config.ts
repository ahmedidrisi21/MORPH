import { defineConfig } from "tsdown";

// Library build (SPEC §14 M8): ESM + .d.ts, one entry per public subpath.
export default defineConfig({
  entry: {
    index: "src/index.ts",
    "providers/jev": "src/providers/jev/index.ts",
    node: "src/node/index.ts",
  },
  format: "esm",
  platform: "neutral",
  dts: true,
  clean: true,
  outDir: "dist",
  // Node built-ins are only used by the ./node subpath.
  deps: { neverBundle: [/^node:/] },
});
