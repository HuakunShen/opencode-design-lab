import * as fs from "fs";
import * as path from "path";
import {
  DesignLabConfigSchema,
  type DesignLabConfig,
  DEFAULT_CONFIG,
  DEFAULT_SCORING_CRITERIA,
} from "./schema";
import { log, logger } from "../utils/logger";

export interface ConfigLoadError {
  path: string;
  error: string;
}

const configLoadErrors: ConfigLoadError[] = [];

export function addConfigLoadError(error: ConfigLoadError) {
  configLoadErrors.push(error);
}

export function getConfigLoadErrors(): ConfigLoadError[] {
  return [...configLoadErrors];
}

export function clearConfigLoadErrors() {
  configLoadErrors.length = 0;
}

function parseJsonc<T>(content: string): T {
  const stripped = content
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  return JSON.parse(stripped) as T;
}

export function loadConfigFromPath(configPath: string): DesignLabConfig | null {
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, "utf-8");
      const rawConfig = parseJsonc<Record<string, unknown>>(content);

      const result = DesignLabConfigSchema.safeParse(rawConfig);

      if (!result.success) {
        const errorMsg = result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(", ");
        addConfigLoadError({
          path: configPath,
          error: `Validation error: ${errorMsg}`,
        });
        return null;
      }

      return result.data;
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    addConfigLoadError({
      path: configPath,
      error: errorMsg,
    });
  }
  return null;
}

export function mergeConfigs(
  base: Partial<DesignLabConfig>,
  override: Partial<DesignLabConfig>,
): Partial<DesignLabConfig> {
  return {
    ...base,
    ...override,
    design: { ...base.design, ...override.design },
    review: {
      ...base.review,
      ...override.review,
      qualitative:
        override.review?.qualitative?.enabled !== undefined
          ? {
              ...base.review?.qualitative,
              ...override.review?.qualitative,
              models:
                override.review?.qualitative?.models ??
                base.review?.qualitative?.models,
            }
          : base.review?.qualitative,
      quantitative:
        override.review?.quantitative?.enabled !== undefined
          ? {
              ...base.review?.quantitative,
              ...override.review?.quantitative,
              criteria:
                override.review?.quantitative?.criteria ??
                base.review?.quantitative?.criteria,
              models:
                override.review?.quantitative?.models ??
                base.review?.quantitative?.models,
            }
          : base.review?.quantitative,
    },
    hooks:
      override.hooks?.design_isolation?.enabled !== undefined
        ? {
            ...base.hooks,
            ...override.hooks,
            design_isolation: {
              ...base.hooks?.design_isolation,
              ...override.hooks?.design_isolation,
            },
          }
        : base.hooks,
    output:
      override.output?.base_dir !== undefined ||
      override.output?.format !== undefined
        ? { ...base.output, ...override.output }
        : base.output,
  };
}

function detectConfigFile(basePath: string): {
  format: "json" | "jsonc" | "none";
  path: string;
} {
  const jsoncPath = basePath + ".jsonc";
  const jsonPath = basePath + ".json";

  if (fs.existsSync(jsoncPath)) {
    return { format: "jsonc", path: jsoncPath };
  }
  if (fs.existsSync(jsonPath)) {
    return { format: "json", path: jsonPath };
  }
  return { format: "none", path: basePath + ".json" };
}

function getUserConfigDir(): string {
  const os = process.platform;
  const home = process.env.HOME || process.env.USERPROFILE || "";

  if (os === "darwin") {
    return path.join(home, "Library", "Application Support");
  }
  if (os === "win32") {
    return path.join(home, "AppData", "Roaming");
  }
  return path.join(home, ".config");
}

export function loadConfig(directory: string): DesignLabConfig {
  clearConfigLoadErrors();

  const userBasePath = path.join(getUserConfigDir(), "opencode", "design-lab");
  const userDetected = detectConfigFile(userBasePath);
  const userConfigPath =
    userDetected.format !== "none" ? userDetected.path : userBasePath + ".json";

  const projectBasePath = path.join(directory, ".opencode", "design-lab");
  const projectDetected = detectConfigFile(projectBasePath);
  const projectConfigPath =
    projectDetected.format !== "none"
      ? projectDetected.path
      : projectBasePath + ".json";

  let config: Partial<DesignLabConfig> = DEFAULT_CONFIG;
  log(`default design_models length: ${config.design_models?.length}`);
  const userConfig = loadConfigFromPath(userConfigPath);
  if (userConfig) {
    config = mergeConfigs(config, userConfig);
  }

  const projectConfig = loadConfigFromPath(projectConfigPath);
  if (projectConfig) {
    config = mergeConfigs(config, projectConfig);
  }
  logger.info(`project design_models: ${config.design_models}`);
  if (!config.design_models || config.design_models.length === 0) {
    addConfigLoadError({
      path: "config",
      error: "design_models must be specified and contain at least one model",
    });
    throw new Error(
      "Configuration error: design_models must be specified and contain at least one model",
    );
  }

  return config as DesignLabConfig;
}

export function resolveTopicGenerationModel(config: DesignLabConfig): string {
  return config.topic_generation_model || config.design_models[0];
}

export function resolveReviewModels(config: DesignLabConfig): string[] {
  if (config.review_models && config.review_models.length > 0) {
    return config.review_models;
  }

  if (config.review?.qualitative?.models) {
    return config.review.qualitative.models;
  }

  if (config.review?.quantitative?.models) {
    return config.review.quantitative.models;
  }

  return config.design_models;
}

export function resolveScoringCriteria(
  config: DesignLabConfig,
): import("./schema").ScoringCriteria[] {
  return (
    config.review?.quantitative?.criteria ||
    (config.review?.quantitative?.enabled === false
      ? []
      : DEFAULT_SCORING_CRITERIA)
  );
}
