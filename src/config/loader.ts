import { logger } from "../utils/logger";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DesignLabConfigSchema, type DesignLabConfig } from "./schema";

/**
 * Deep merge two objects, with override taking precedence
 */
function deepMerge<T extends Record<string, unknown>>(base: T, override: T): T {
  const result = { ...base };

  for (const key in override) {
    const overrideValue = override[key];
    const baseValue = base[key];

    if (
      typeof overrideValue === "object" &&
      overrideValue !== null &&
      !Array.isArray(overrideValue) &&
      typeof baseValue === "object" &&
      baseValue !== null &&
      !Array.isArray(baseValue)
    ) {
      result[key] = deepMerge(
        baseValue as Record<string, unknown>,
        overrideValue as Record<string, unknown>,
      ) as T[Extract<keyof T, string>];
    } else {
      result[key] = overrideValue;
    }
  }

  return result;
}

/**
 * Parse JSONC (JSON with comments)
 */
function parseJsonc<T>(content: string): T {
  // Remove comments
  const withoutComments = content
    .replace(/\/\*[\s\S]*?\*\//g, "") // Remove block comments
    .replace(/^\s*\/\/.*/gm, ""); // Remove line comments only at line start

  return JSON.parse(withoutComments) as T;
}

/**
 * Load config from a specific path if it exists
 */
type ConfigLoadResult = {
  config: Partial<DesignLabConfig> | null;
  loadedPath?: string;
  error?: string;
};

function loadConfigFromPath(configPath: string): ConfigLoadResult {
  // Support both .json and .jsonc extensions
  const possiblePaths = [
    configPath,
    `${configPath}.json`,
    `${configPath}.jsonc`,
  ];

  for (const fullPath of possiblePaths) {
    if (!fs.existsSync(fullPath)) {
      continue;
    }

    try {
      const content = fs.readFileSync(fullPath, "utf-8");
      const rawConfig = parseJsonc<Record<string, unknown>>(content);

      // Parse with Zod but allow partial configs
      const result = DesignLabConfigSchema.partial().safeParse(rawConfig);

      if (!result.success) {
        const issues = result.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join(", ");
        return {
          config: null,
          loadedPath: fullPath,
          error: `Config validation error: ${issues}`,
        };
      }

      return { config: result.data, loadedPath: fullPath };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        config: null,
        loadedPath: fullPath,
        error: `Error loading config: ${errorMsg}`,
      };
    }
  }

  return { config: null };
}

/**
 * Get the user config directory (cross-platform)
 * OpenCode uses ~/.config/opencode on all Unix-like platforms
 */
function getUserConfigDir(): string {
  if (process.platform === "win32") {
    return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  }
  // macOS and Linux both use ~/.config for OpenCode
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
}

/**
 * Load and merge plugin configuration from multiple sources
 *
 * Priority (highest to lowest):
 * 1. Project-level config: .opencode/design-lab.json(c)
 * 2. User-level config: ~/.config/opencode/design-lab.json(c)
 *
 * @param directory - Project directory
 * @returns Merged and validated configuration
 */
export function loadPluginConfig(directory: string): DesignLabConfig | null {
  // User-level config path
  const userConfigPath = path.join(
    getUserConfigDir(),
    "opencode",
    "design-lab",
  );

  // Project-level config path
  const projectConfigPath = path.join(directory, ".opencode", "design-lab");

  // Load configs
  const userConfigResult = loadConfigFromPath(userConfigPath);
  const projectConfigResult = loadConfigFromPath(projectConfigPath);

  if (userConfigResult.error || projectConfigResult.error) {
    logger.error(
      {
        userConfigPath: userConfigResult.loadedPath,
        userConfigError: userConfigResult.error,
        projectConfigPath: projectConfigResult.loadedPath,
        projectConfigError: projectConfigResult.error,
      },
      "DesignLab config invalid; plugin disabled",
    );
    return null;
  }

  if (userConfigResult.loadedPath) {
    logger.info(
      { configPath: userConfigResult.loadedPath },
      "Loaded DesignLab user config",
    );
  }
  if (projectConfigResult.loadedPath) {
    logger.info(
      { configPath: projectConfigResult.loadedPath },
      "Loaded DesignLab project config",
    );
  }

  if (!userConfigResult.config && !projectConfigResult.config) {
    logger.warn(
      { userConfigPath, projectConfigPath },
      "DesignLab config not found; plugin disabled",
    );
    return null;
  }

  // Merge configs (project overrides user)
  let mergedConfig: Partial<DesignLabConfig> = {};

  if (userConfigResult.config) {
    mergedConfig = deepMerge(mergedConfig, userConfigResult.config);
  }

  if (projectConfigResult.config) {
    mergedConfig = deepMerge(mergedConfig, projectConfigResult.config);
  }

  // Parse and validate final config with defaults
  const result = DesignLabConfigSchema.safeParse(mergedConfig);

  if (!result.success) {
    logger.error(
      {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      "Invalid design-lab configuration; plugin disabled",
    );
    return null;
  }

  return result.data;
}
