import { describe, expect, it } from "vitest";
import { MORPH_VERSION } from "./index";

describe("@morph/core", () => {
  it("exports a version", () => {
    expect(MORPH_VERSION).toBe("0.0.0");
  });
});
