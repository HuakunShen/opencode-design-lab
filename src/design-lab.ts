import type { Plugin } from "@opencode-ai/plugin";
import { loadPluginConfig } from "./config";
import {
  createGenerateDesignsTool,
  createReviewDesignsTool,
  createAggregateScoresTool,
} from "./tools";

/**
 * OpenCode Design Lab Plugin
 *
 * Generates multiple independent design proposals using different AI models,
 * then systematically evaluates, compares, and ranks those designs.
 */
export const DesignLab: Plugin = async (ctx) => {
  // Load configuration
  const config = loadPluginConfig(ctx.directory);

  // Create tools
  const generateDesigns = createGenerateDesignsTool(ctx, config);
  const reviewDesigns = createReviewDesignsTool(ctx, config);
  const aggregateScores = createAggregateScoresTool(ctx, config);

  return {
    tool: {
      generate_designs: generateDesigns,
      review_designs: reviewDesigns,
      aggregate_scores: aggregateScores,
    },
  };
};
