import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const tempDirs: string[] = [];

afterEach(() => {
  delete process.env.XDG_CONFIG_HOME;
  vi.resetModules();

  for (const tempDir of tempDirs) {
    rmSync(tempDir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe("logger implementation", () => {
  it("does not import pino at runtime", () => {
    const source = readFileSync("src/utils/logger.ts", "utf-8");

    expect(source).not.toContain('from "pino"');
    expect(source).not.toContain("pino(");
    expect(source).not.toContain("pino.multistream");
  });

  it("does not ask tsdown to bundle pino", () => {
    const source = readFileSync("tsdown.config.ts", "utf-8");

    expect(source).not.toContain("pino");
  });

  it("limits dependency bundling to zod", () => {
    const source = readFileSync("tsdown.config.ts", "utf-8");

    expect(source).toContain('alwaysBundle: ["zod"]');
    expect(source).toContain('onlyBundle: ["zod"]');
  });

  it("does not throw when log context cannot be serialized", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "design-lab-logger-"));
    tempDirs.push(tempDir);
    process.env.XDG_CONFIG_HOME = tempDir;

    const { logger } = await import("./logger");
    const context: Record<string, unknown> = {};
    context.self = context;

    expect(() => logger.info(context, "Circular context")).not.toThrow();
    expect(
      readFileSync(join(tempDir, "opencode", "design-lab.log"), "utf-8"),
    ).toContain("Circular context");
  });
});
