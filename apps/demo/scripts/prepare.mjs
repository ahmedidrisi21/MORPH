#!/usr/bin/env node
// Build-time preparation for the demo: compile replay fixtures and publish the dataset.
// Runs before `dev` and `build` (pnpm does not run pre* scripts by default).
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const demo = fileURLToPath(new URL("..", import.meta.url));
await import("./compile-fixtures.mjs");
// The browser computes facts client-side from the committed CSV (SPEC §11.6).
mkdirSync(join(demo, "public", "data"), { recursive: true });
copyFileSync(join(demo, "data", "sales.csv"), join(demo, "public", "data", "sales.csv"));
console.log("prepare: data/sales.csv → public/data/sales.csv");
