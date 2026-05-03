import type { Plugin } from "@opencode-ai/plugin";

import {
  createDesignerModelAgent,
  createDesignerPrimaryAgent,
  getDesignerModelFileStem,
  getDesignerSubagentName,
  normalizeModelConfig,
} from "./agents";
import {
  buildDesignCommand,
  buildInitCommand,
  buildJournalCommand,
  buildRepowikiCommand,
  buildReviewCommand,
  buildSynthesizeCommand,
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
  return {
    config: async (config) => {
      // Load configuration fresh in the config callback
      const pluginConfig = loadPluginConfig(ctx.directory);

      // Always register ALL commands unconditionally
      // The design/review/synthesize commands read config dynamically at runtime
      config.command = {
        ...(config.command ?? {}),
        "design-lab:init": buildInitCommand(ctx.directory),
        "design-lab:journal": buildJournalCommand(),
        "design-lab:repowiki": buildRepowikiCommand(ctx.directory),
        "design-lab:design": buildDesignCommand(ctx.directory),
        "design-lab:review": buildReviewCommand(ctx.directory),
        "design-lab:synthesize": buildSynthesizeCommand(ctx.directory),
      };

      if (pluginConfig) {
        logger.info("Design Lab Plugin Loaded");

        const designConfigs = pluginConfig.design_models.map(normalizeModelConfig);
        const reviewConfigs = (
          pluginConfig.review_models ?? pluginConfig.design_models
        ).map(normalizeModelConfig);

        const designConfigsUnique = uniqueNormalizedConfigs(designConfigs);
        const reviewConfigsUnique = uniqueNormalizedConfigs(reviewConfigs);
        const allConfigs = uniqueNormalizedConfigs([
          ...designConfigsUnique,
          ...reviewConfigsUnique,
        ]);

        const modelSpecs = new Map(
          allConfigs.map((cfg) => [
            cfg.model,
            {
              model: cfg.model,
              variant: cfg.variant,
              agentName: getDesignerSubagentName(cfg.model),
              fileStem: getDesignerModelFileStem(cfg.model),
            },
          ]),
        );

        const designSpecs = designConfigsUnique
          .map((cfg) => modelSpecs.get(cfg.model))
          .filter(isModelSpec);
        const reviewSpecs = reviewConfigsUnique
          .map((cfg) => modelSpecs.get(cfg.model))
          .filter(isModelSpec);

        const subagentEntries = Array.from(modelSpecs.values()).map((spec) => [
          spec.agentName,
          createDesignerModelAgent(spec.model, spec.variant),
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

        const agentKeys = Object.keys(config.agent ?? {});
        const commandKeys = Object.keys(config.command ?? {});
        logger.info(
          {
            designModels: designConfigsUnique.map((c) => c.model),
            reviewModels: reviewConfigsUnique.map((c) => c.model),
            agentsRegistered: agentKeys,
            commandsRegistered: commandKeys,
          },
          "DesignLab agents and commands registered",
        );
      } else {
        logger.warn(
          "DesignLab config not found; design commands will prompt to run /design-lab:init",
        );
      }
    },
  };
};

function uniqueNormalizedConfigs(
  configs: { model: string; variant: string }[],
): { model: string; variant: string }[] {
  const seen = new Set<string>();
  return configs.filter((cfg) => {
    if (seen.has(cfg.model)) {
      return false;
    }
    seen.add(cfg.model);
    return true;
  });
}

type ModelSpec = {
  model: string;
  variant: string;
  agentName: string;
  fileStem: string;
};

function isModelSpec(spec: ModelSpec | undefined): spec is ModelSpec {
  return Boolean(spec);
}
