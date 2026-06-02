import {
  tool,
  type PluginInput,
  type ToolDefinition,
} from "@opencode-ai/plugin";

import { loadPluginConfig } from "../config";
import { logger } from "../utils/logger";
import {
  createAgentSession,
  extractSessionOutput,
  pollForCompletion,
} from "../utils/session-helpers";

const DESIGN_LAB_AGENT_NAME = "design_lab";
const WORKFLOW_VALUES = [
  "auto",
  "ask",
  "plan",
  "revise",
  "blind_review",
  "code_review",
] as const;

type DesignLabWorkflow = (typeof WORKFLOW_VALUES)[number];

type DesignLabRunArgs = {
  prompt: string;
  workflow?: DesignLabWorkflow;
};

/**
 * Create a default-agent bridge into the Design Lab coordinator.
 */
export function createDesignLabRunTool(ctx: PluginInput): ToolDefinition {
  return tool({
    description: `Run OpenCode Design Lab from the current agent without switching agents.

Use this after loading the design-lab skill for multi-model asks, plans, revisions, blind reviews, or current-code reviews. The tool starts a child session using the design_lab coordinator and returns its summary.`,
    args: {
      prompt: tool.schema
        .string()
        .min(1)
        .describe("The user's full Design Lab request."),
      workflow: tool.schema
        .enum(WORKFLOW_VALUES)
        .default("auto")
        .describe("The Design Lab workflow to run."),
    },
    async execute(args: DesignLabRunArgs, toolContext) {
      const pluginConfig = loadPluginConfig(ctx.directory);
      if (!pluginConfig) {
        return "Design Lab config not found or invalid. Run `/design-lab:init`, then restart OpenCode if you just installed or rebuilt the plugin.";
      }

      const workflow = args.workflow ?? "auto";
      const sessionID = await createAgentSession(
        ctx,
        toolContext.sessionID,
        `Design Lab - ${workflow}`,
        ctx.directory,
      );
      const prompt = buildDesignLabRunPrompt({
        baseOutputDir: pluginConfig.base_output_dir,
        prompt: args.prompt,
        workflow,
      });

      logger.info(
        { workflow, sessionID, parentSessionID: toolContext.sessionID },
        "Starting Design Lab child session from tool",
      );

      const sendResult = await ctx.client.session.promptAsync({
        path: { id: sessionID },
        body: {
          agent: DESIGN_LAB_AGENT_NAME,
          parts: [{ type: "text", text: prompt }],
        },
      });

      if (sendResult.error) {
        logger.error(
          { sessionID, error: sendResult.error },
          "Failed to send Design Lab tool prompt",
        );
        throw new Error(`Failed to start Design Lab run: ${sendResult.error}`);
      }

      await pollForCompletion(ctx, sessionID, toolContext.abort);
      const output = await extractSessionOutput(ctx, sessionID);

      return `Design Lab run complete.

Child session: ${sessionID}
Workflow: ${workflow}

${output}`;
    },
  });
}

function buildDesignLabRunPrompt(options: {
  baseOutputDir: string;
  prompt: string;
  workflow: DesignLabWorkflow;
}): string {
  return `Run the Design Lab workflow from the current agent bridge.

Workflow: ${options.workflow}
Base output directory: ${options.baseOutputDir}

User request:
${options.prompt}

Use your design_lab system prompt. Save full model outputs to files and return a concise synthesis with paths and failures.`;
}
