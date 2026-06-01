import type { Plugin } from "@opencode-ai/plugin";

import {
  createDesignLabModelAgent,
  createDesignLabPrimaryAgent,
  getDesignerModelFileStem,
  getDesignLabSubagentName,
  normalizeModelConfig,
} from "./agents";
import {
  buildAskCommand,
  buildInitCommand,
  buildJournalCommand,
  buildRepowikiCommand,
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
        "design-lab:ask": buildAskCommand(ctx.directory),
        "design-lab:journal": buildJournalCommand(),
        "design-lab:repowiki": buildRepowikiCommand(ctx.directory),
      };

      if (pluginConfig) {
        logger.info("Design Lab Plugin Loaded");

        const modelConfigs = pluginConfig.models.map((cfg) =>
          normalizeModelConfig(cfg, pluginConfig.default_variant),
        );
        const modelConfigsUnique = uniqueNormalizedConfigs(modelConfigs);

        const modelSpecs = modelConfigsUnique.map((cfg) => ({
          model: cfg.model,
          variant: cfg.variant,
          agentName: getDesignLabSubagentName(cfg.model),
          fileStem: getDesignerModelFileStem(cfg.model),
        }));

        const subagentEntries = modelSpecs.map((spec) => [
          spec.agentName,
          createDesignLabModelAgent(spec.model, spec.variant),
        ]);

        config.agent = {
          ...(config.agent ?? {}),
          design_lab: createDesignLabPrimaryAgent({
            baseOutputDir: pluginConfig.base_output_dir,
            models: modelSpecs,
          }),
          ...Object.fromEntries(subagentEntries),
        };

        const agentKeys = Object.keys(config.agent ?? {});
        const commandKeys = Object.keys(config.command ?? {});
        logger.info(
          {
            models: modelConfigsUnique.map((c) => c.model),
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
  configs: { model: string; variant: string | null }[],
): { model: string; variant: string | null }[] {
  const seen = new Set<string>();
  return configs.filter((cfg) => {
    if (seen.has(cfg.model)) {
      return false;
    }
    seen.add(cfg.model);
    return true;
  });
}
