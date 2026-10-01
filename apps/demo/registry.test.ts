import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = import.meta.dirname;
const registry = JSON.parse(readFileSync(join(dir, "registry.json"), "utf8")) as {
  items: { name: string; files: { path: string }[]; registryDependencies?: string[] }[];
};

describe("shadcn registry.json", () => {
  it("publishes every Morph component", () => {
    const files = new Set(registry.items.flatMap((i) => i.files.map((f) => f.path)));
    const expected = readdirSync(join(dir, "components/morph"))
      .filter((f) => f.endsWith(".tsx") && f !== "MorphPayroll.tsx")
      .map((f) => `components/morph/${f}`);
    for (const f of expected) expect(files, f).toContain(f);
  });

  it("uses the official shadcn/ui primitives instead of shipping its own", () => {
    const files = registry.items.flatMap((i) => i.files.map((f) => f.path));
    expect(files.filter((f) => f.startsWith("components/ui/") || f === "lib/utils.ts")).toEqual([]);
    const official = new Set(["card", "button", "badge", "table", "skeleton", "utils"]);
    const deps = registry.items.flatMap((i) => i.registryDependencies ?? []);
    for (const dep of deps.filter((d) => !d.startsWith("@morph/"))) {
      expect(official, dep).toContain(dep);
    }
    // Every primitive the demo installed from shadcn is one the registry points at.
    for (const f of readdirSync(join(dir, "components/ui"))) {
      expect(deps, f).toContain(f.replace(/\.tsx$/, ""));
    }
  });

  it("points only at files that exist and at items it defines", () => {
    const names = new Set(registry.items.map((i) => `@morph/${i.name}`));
    for (const item of registry.items) {
      for (const f of item.files) expect(existsSync(join(dir, f.path)), f.path).toBe(true);
      for (const dep of item.registryDependencies ?? []) {
        if (dep.startsWith("@morph/")) expect(names, dep).toContain(dep);
      }
    }
  });
});
