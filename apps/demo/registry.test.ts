import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = import.meta.dirname;
const registry = JSON.parse(readFileSync(join(dir, "registry.json"), "utf8")) as {
  items: { name: string; files: { path: string }[]; registryDependencies?: string[] }[];
};

describe("shadcn registry.json", () => {
  it("publishes every Morph component and UI primitive", () => {
    const files = new Set(registry.items.flatMap((i) => i.files.map((f) => f.path)));
    const expected = [
      ...readdirSync(join(dir, "components/morph"))
        .filter((f) => f.endsWith(".tsx") && f !== "MorphPayroll.tsx")
        .map((f) => `components/morph/${f}`),
      ...readdirSync(join(dir, "components/ui")).map((f) => `components/ui/${f}`),
    ];
    for (const f of expected) expect(files, f).toContain(f);
  });

  it("points only at files that exist and at items it defines", () => {
    const names = new Set(registry.items.map((i) => `@morph/${i.name}`));
    for (const item of registry.items) {
      for (const f of item.files) expect(existsSync(join(dir, f.path)), f.path).toBe(true);
      for (const dep of item.registryDependencies ?? []) expect(names, dep).toContain(dep);
    }
  });
});
