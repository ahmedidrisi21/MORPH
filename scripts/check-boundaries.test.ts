import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const probe = fileURLToPath(new URL("../packages/core/src/__boundary_probe__.ts", import.meta.url));

function runCheck() {
  return spawnSync("node", ["scripts/check-boundaries.mjs"], { cwd: root, encoding: "utf8" });
}

describe("check-boundaries", () => {
  afterEach(() => rmSync(probe, { force: true }));

  it("passes on the repository as committed", () => {
    expect(runCheck().status).toBe(0);
  });

  it("fails when core imports React", () => {
    writeFileSync(probe, 'import React from "react";\nexport const x = React;\n');
    const res = runCheck();
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("framework import");
  });

  it("fails on forbidden APIs", () => {
    writeFileSync(probe, "export const f = () => eval" + '("1");\n');
    const res = runCheck();
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("eval");
  });
});
