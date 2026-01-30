import type { Plugin } from "@opencode-ai/plugin";
import type { Config } from "@opencode-ai/sdk";

import {
  createDesignerModelAgent,
  createDesignerPrimaryAgent,
  getDesignerModelFileStem,
  getDesignerSubagentName,
} from "./agents";
import {
  buildDesignCommand,
  buildInitCommand,
  buildReviewCommand,
} from "./commands";
import { loadPluginConfig } from "./config";
import { logger } from "./utils/logger";

/**
 * OpenCode Design Lab Plugin
 *
 * Generates multiple independent design proposals using different AI models,
 * then systematically evaluates, compares, and ranks those designs.
 */
export const DesignLab: Plugin = async (ctx) => {
  // Load configuration
  const pluginConfig = loadPluginConfig(ctx.directory);

  if (!pluginConfig) {
    logger.warn(
      "DesignLab config not found; only init command will be available",
    );
  } else {
    logger.info("Design Lab Plugin Loaded");
  }

  return {
    config: async (config: Config) => {
      // Always register the init command (cannot be skipped)
      config.command = {
        ...(config.command ?? {}),
        "design-lab:init": buildInitCommand(ctx.directory),
      };

      // Only register agents and other commands if config exists
      if (pluginConfig) {
        const designModels = uniqueModels(pluginConfig.design_models);
        const reviewModels = uniqueModels(
          pluginConfig.review_models ?? pluginConfig.design_models,
        );
        const allModels = uniqueModels([...designModels, ...reviewModels]);

        const modelSpecs = new Map(
          allModels.map((model) => [
            model,
            {
              model,
              agentName: getDesignerSubagentName(model),
              fileStem: getDesignerModelFileStem(model),
            },
          ]),
        );

        const designSpecs = designModels
          .map((model) => modelSpecs.get(model))
          .filter(isModelSpec);
        const reviewSpecs = reviewModels
          .map((model) => modelSpecs.get(model))
          .filter(isModelSpec);

        const subagentEntries = Array.from(modelSpecs.values()).map((spec) => [
          spec.agentName,
          createDesignerModelAgent(spec.model),
        ]);

        config.agent = {
          ...(config.agent ?? {}),
          designer: createDesignerPrimaryAgent({
            baseOutputDir: pluginConfig.base_output_dir,
            designModels: designSpecs,
            reviewModels: reviewSpecs,
          }),
          ...Object.fromEntries(subagentEntries),
        };

        config.command = {
          ...(config.command ?? {}),
          "design-lab:design": buildDesignCommand({
            baseOutputDir: pluginConfig.base_output_dir,
            designModels: designSpecs,
            reviewModels: reviewSpecs,
          }),
          "design-lab:review": buildReviewCommand({
            baseOutputDir: pluginConfig.base_output_dir,
            designModels: designSpecs,
            reviewModels: reviewSpecs,
          }),
        };

        const agentKeys = Object.keys(config.agent ?? {});
        const commandKeys = Object.keys(config.command ?? {});
        logger.info(
          {
            designModels,
            reviewModels,
            agentsRegistered: agentKeys,
            commandsRegistered: commandKeys,
          },
          "DesignLab agents and commands registered",
        );
      } else {
        logger.info(
          { command: "design-lab:init" },
          "DesignLab init command registered (config missing)",
        );
      }
    },
  };
};

function uniqueModels(models: string[]): string[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model)) {
      return false;
    }
    seen.add(model);
    return true;
  });
}

type ModelSpec = {
  model: string;
  agentName: string;
  fileStem: string;
};

function isModelSpec(spec: ModelSpec | undefined): spec is ModelSpec {
  return Boolean(spec);
}
