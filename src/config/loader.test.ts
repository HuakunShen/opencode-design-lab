import { describe, it, expect, vi, beforeEach } from "vitest";
import * as path from "path";
import * as os from "os";

// Mock fs module at the vitest level (intercepts all imports of 'fs')
vi.mock("fs");

vi.mock("../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import * as fs from "fs";
import { logger } from "../utils/logger";
import { getConfigPaths, loadPluginConfig } from "./loader";

const mockedExistsSync = vi.mocked(fs.existsSync);
const mockedReadFileSync = vi.mocked(fs.readFileSync);
const mockedLoggerError = vi.mocked(logger.error);

const homedir = os.homedir();
const userConfigJsonPath = path.join(
  homedir,
  ".config",
  "opencode",
  "design-lab.json",
);
const userConfigJsoncPath = path.join(
  homedir,
  ".config",
  "opencode",
  "design-lab.jsonc",
);

function projectConfigJsonPath(dir: string): string {
  return path.join(dir, ".opencode", "design-lab.json");
}

function projectConfigJsoncPath(dir: string): string {
  return path.join(dir, ".opencode", "design-lab.jsonc");
}

describe("getConfigPaths", () => {
  it("returns correct paths in priority order", () => {
    const directory = "/tmp/test-project";
    const paths = getConfigPaths(directory);

    expect(paths).toHaveLength(4);
    expect(paths[0]).toBe(projectConfigJsonPath(directory));
    expect(paths[1]).toBe(projectConfigJsoncPath(directory));
    expect(paths[2]).toBe(userConfigJsonPath);
    expect(paths[3]).toBe(userConfigJsoncPath);

    expect(paths[0]).toContain(".opencode/design-lab.json");
    expect(paths[3]).toContain(".config/opencode/design-lab.jsonc");
  });
});

describe("loadPluginConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no config files exist", () => {
    const result = loadPluginConfig("/tmp/no-config");

    expect(result).toBeNull();
    expect(mockedExistsSync).toHaveBeenCalled();
    expect(mockedReadFileSync).not.toHaveBeenCalled();
  });

  it("loads and parses valid project-level config", () => {
    const projJson = projectConfigJsonPath("/tmp/test-proj");
    mockedExistsSync.mockImplementation((p) => p === projJson);
    mockedReadFileSync.mockImplementation((p) => {
      if (p === projJson) {
        return JSON.stringify({ models: ["model-a", "model-b"] });
      }
      return "";
    });

    const result = loadPluginConfig("/tmp/test-proj");

    expect(result).not.toBeNull();
    expect(result!.models).toEqual(["model-a", "model-b"]);
    expect(result!.default_variant).toBe("max");
    expect(result!.base_output_dir).toBe(".design-lab");
  });

  it("merges user-level and project-level configs (project overrides user)", () => {
    const projJson = projectConfigJsonPath("/tmp/test-proj");
    const userJson = userConfigJsonPath;

    mockedExistsSync.mockImplementation(
      (p) => p === projJson || p === userJson,
    );
    mockedReadFileSync.mockImplementation((p) => {
      // user provides topic_generator_model (no default in schema)
      if (p === userJson) {
        return JSON.stringify({ topic_generator_model: "gpt-4" });
      }
      // project provides models (no default in schema)
      if (p === projJson) {
        return JSON.stringify({ models: ["a", "b"] });
      }
      return "";
    });

    const result = loadPluginConfig("/tmp/test-proj");

    expect(result).not.toBeNull();
    // From project config
    expect(result!.models).toEqual(["a", "b"]);
    // From user config — project didn't set it, so user's value survives
    expect(result!.topic_generator_model).toBe("gpt-4");
  });

  it("project-level overrides user-level on conflicting fields", () => {
    const projJson = projectConfigJsonPath("/tmp/test-proj");
    const userJson = userConfigJsonPath;

    mockedExistsSync.mockImplementation(
      (p) => p === projJson || p === userJson,
    );
    mockedReadFileSync.mockImplementation((p) => {
      if (p === userJson) {
        return JSON.stringify({
          models: ["user-a", "user-b"],
          topic_generator_model: "user-model",
        });
      }
      if (p === projJson) {
        return JSON.stringify({ models: ["proj-a", "proj-b"] });
      }
      return "";
    });

    const result = loadPluginConfig("/tmp/test-proj");

    expect(result).not.toBeNull();
    // Project overrides user on models
    expect(result!.models).toEqual(["proj-a", "proj-b"]);
    // User's topic_generator_model survives since project didn't set it
    expect(result!.topic_generator_model).toBe("user-model");
  });

  it("returns null and logs error for invalid config (too few models)", () => {
    const projJson = projectConfigJsonPath("/tmp/test-proj");
    mockedExistsSync.mockImplementation((p) => p === projJson);
    mockedReadFileSync.mockImplementation((p) => {
      if (p === projJson) {
        return JSON.stringify({ models: ["only-one"] });
      }
      return "";
    });

    const result = loadPluginConfig("/tmp/test-proj");

    expect(result).toBeNull();
    expect(mockedLoggerError).toHaveBeenCalled();
    // Error originates from loadConfigFromPath partial validation failing.
    // loadPluginConfig logs it with projectConfigError field.
    const firstArg = mockedLoggerError.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(firstArg.projectConfigError).toContain("At least 2 models required");
  });

  it("handles JSONC comments correctly", () => {
    const projJson = projectConfigJsonPath("/tmp/test-proj");
    const jsoncContent = [
      "{",
      "  // This is a line comment",
      '  "models": ["model-a", "model-b"],',
      "  /* Block comment",
      "     across multiple lines */",
      '  "base_output_dir": ".design-lab-custom"',
      "}",
    ].join("\n");

    mockedExistsSync.mockImplementation((p) => p === projJson);
    mockedReadFileSync.mockImplementation((p) => {
      if (p === projJson) return jsoncContent;
      return "";
    });

    const result = loadPluginConfig("/tmp/test-proj");

    expect(result).not.toBeNull();
    expect(result!.models).toEqual(["model-a", "model-b"]);
    expect(result!.base_output_dir).toBe(".design-lab-custom");
  });

  it("loads arbitrary model variants and explicit null variants", () => {
    const projJson = projectConfigJsonPath("/tmp/test-proj");
    mockedExistsSync.mockImplementation((p) => p === projJson);
    mockedReadFileSync.mockImplementation((p) => {
      if (p === projJson) {
        return JSON.stringify({
          models: [
            "openai/gpt-5.2-codex",
            { model: "openai/gpt-5.2-codex", variant: "xhigh" },
            { model: "local/model-without-variant", variant: null },
          ],
          default_variant: "max",
        });
      }
      return "";
    });

    const result = loadPluginConfig("/tmp/test-proj");

    expect(result).not.toBeNull();
    expect(result!.models).toEqual([
      "openai/gpt-5.2-codex",
      { model: "openai/gpt-5.2-codex", variant: "xhigh" },
      { model: "local/model-without-variant", variant: null },
    ]);
    expect(result!.default_variant).toBe("max");
  });

  it("allows a null default variant", () => {
    const projJson = projectConfigJsonPath("/tmp/test-proj");
    mockedExistsSync.mockImplementation((p) => p === projJson);
    mockedReadFileSync.mockImplementation((p) => {
      if (p === projJson) {
        return JSON.stringify({
          models: ["model-a", "model-b"],
          default_variant: null,
        });
      }
      return "";
    });

    const result = loadPluginConfig("/tmp/test-proj");

    expect(result).not.toBeNull();
    expect(result!.default_variant).toBeNull();
  });

  it("rejects legacy design_models without models", () => {
    const projJson = projectConfigJsonPath("/tmp/test-proj");
    mockedExistsSync.mockImplementation((p) => p === projJson);
    mockedReadFileSync.mockImplementation((p) => {
      if (p === projJson) {
        return JSON.stringify({ design_models: ["model-a", "model-b"] });
      }
      return "";
    });

    const result = loadPluginConfig("/tmp/test-proj");

    expect(result).toBeNull();
    expect(mockedLoggerError).toHaveBeenCalled();
  });
});
