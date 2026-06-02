import { describe, expect, it } from "vitest";

import packageJson from "../package.json";

describe("published package metadata", () => {
  it("exposes the compiled plugin through npm package entrypoints", () => {
    expect(packageJson.type).toBe("module");
    expect(packageJson.main).toBe("./.opencode/plugins/design-lab.js");
    expect(packageJson.exports).toMatchObject({
      ".": "./.opencode/plugins/design-lab.js",
      "./server": "./.opencode/plugins/design-lab.js",
    });
    expect(packageJson.files).toContain(".opencode/plugins");
    expect(packageJson.files).toContain("skills");
  });

  it("does not publish logger-only runtime dependencies", () => {
    expect(packageJson.dependencies).not.toHaveProperty("pino");
    expect(packageJson.dependencies).toHaveProperty("zod");
  });
});
