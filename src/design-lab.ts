import type { Plugin } from "@opencode-ai/plugin";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import {
  createDesignLabFallbackAgent,
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
import { injectDesignLabSkillNudge } from "./skills/design-lab-bootstrap";
import { createDesignLabRunTool } from "./tools";
import { logger } from "./utils/logger";

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = resolveBundledSkillsDir(PLUGIN_DIR);

type ConfigWithSkills = {
  skills?: {
    paths?: string[];
  };
};

/**
 * OpenCode Design Lab Plugin
 *
 * Generates multiple independent design proposals using different AI models,
 * then systematically evaluates, compares, and ranks those designs.
 */
export const DesignLab: Plugin = async (ctx) => {
  return {
    tool: {
      design_lab_run: createDesignLabRunTool(ctx),
    },

    config: async (config) => {
      // Load configuration fresh in the config callback
      const pluginConfig = loadPluginConfig(ctx.directory);

      registerSkillsPath(config as ConfigWithSkills, SKILLS_DIR);

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
        config.agent = {
          ...(config.agent ?? {}),
          design_lab: createDesignLabFallbackAgent(),
        };

        logger.warn(
          "DesignLab config not found; design commands will prompt to run /design-lab:init",
        );
      }
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      injectDesignLabSkillNudge(output);
    },
  };
};

function resolveBundledSkillsDir(pluginDir: string): string {
  const candidates = [
    path.resolve(pluginDir, "../../skills"),
    path.resolve(pluginDir, "../skills"),
  ];
  return (
    candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
  );
}

function registerSkillsPath(config: ConfigWithSkills, skillsDir: string): void {
  config.skills = config.skills ?? {};
  config.skills.paths = config.skills.paths ?? [];
  if (!config.skills.paths.includes(skillsDir)) {
    config.skills.paths.push(skillsDir);
  }
}

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
