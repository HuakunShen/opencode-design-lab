import {
  tool,
  type PluginInput,
  type ToolDefinition,
} from "@opencode-ai/plugin";
import * as fs from "fs";
import * as path from "path";
import {
  type DesignLabConfig,
  DesignArtifactSchema,
  type DesignArtifact,
} from "../config";
import { createDesignAgent } from "../agents";
import {
  createAgentSession,
  sendPrompt,
  pollForCompletion,
  extractSessionOutput,
  extractJSON,
  sanitizeForFilename,
  getModelShortName,
} from "../utils/session-helpers";
import { logger } from "../utils/logger";

interface GenerateDesignsArgs {
  requirements: string;
  topic?: string;
}

/**
 * Create the generate_designs tool
 */
export function createGenerateDesignsTool(
  ctx: PluginInput,
  config: DesignLabConfig,
): ToolDefinition {
  return tool({
    description: `Generate multiple independent design proposals for a technical system.

This tool creates design proposals using ${config.design_models.length} different AI models:
${config.design_models.map((m) => `- ${m}`).join("\n")}

Each model generates a design completely independently, without seeing other models' outputs.

Use this when you want to explore multiple approaches to a design problem and compare them.`,
    args: {
      requirements: tool.schema
        .string()
        .describe(
          "Detailed requirements for the design. Include problem statement, constraints, and non-functional requirements.",
        ),
      topic: tool.schema
        .string()
        .describe(
          "Optional short topic name (2-4 words) for the design session. If not provided, one will be generated.",
        )
        .optional(),
    },
    async execute(args: GenerateDesignsArgs, toolContext) {
      const { requirements, topic: userTopic } = args;
      const sessionID = toolContext.sessionID;

      // Generate topic if not provided
      const topic = userTopic
        ? sanitizeForFilename(userTopic)
        : await generateTopic(ctx, config, requirements, sessionID);

      // Create output directory
      const date = new Date().toISOString().split("T")[0];
      const labDir = path.join(
        ctx.directory,
        config.base_output_dir,
        `${date}-${topic}`,
      );

      // Check if directory already exists (prevent duplicates from retries)
      if (fs.existsSync(labDir)) {
        logger.warn({ labDir }, "Lab directory already exists, using existing");
        return `Error: Lab directory already exists at ${labDir}. This may be from a previous attempt. Please check the existing designs or delete the directory to retry.`;
      }

      const designsDir = path.join(labDir, "designs");
      const reviewsDir = path.join(labDir, "reviews");
      const scoresDir = path.join(labDir, "scores");

      fs.mkdirSync(designsDir, { recursive: true });
      fs.mkdirSync(reviewsDir, { recursive: true });
      fs.mkdirSync(scoresDir, { recursive: true });

      // Save task requirements
      const taskData = {
        requirements,
        topic,
        created: new Date().toISOString(),
        design_models: config.design_models,
        review_models: config.review_models ?? config.design_models,
      };
      fs.writeFileSync(
        path.join(labDir, "task.json"),
        JSON.stringify(taskData, null, 2),
      );

      // Generate designs from each model
      const results: Array<{
        model: string;
        success: boolean;
        error?: string;
      }> = [];

      for (const model of config.design_models) {
        try {
          logger.info(
            { model },
            `Starting design generation for model: ${model}`,
          );

          const design = await generateDesign(
            ctx,
            config,
            model,
            requirements,
            sessionID,
          );

          // Validate design schema
          const validationResult = DesignArtifactSchema.safeParse(design);
          if (!validationResult.success) {
            logger.error(
              { model, errors: validationResult.error.issues },
              "Design schema validation failed",
            );
            results.push({
              model,
              success: false,
              error: `Schema validation failed: ${validationResult.error.issues
                .map((i) => `${i.path.join(".")}: ${i.message}`)
                .join(", ")}`,
            });
            continue;
          }

          // Save design as JSON
          const modelShortName = getModelShortName(model);
          const designFile = path.join(
            designsDir,
            `${sanitizeForFilename(modelShortName)}.json`,
          );
          fs.writeFileSync(designFile, JSON.stringify(design, null, 2));
          logger.info({ model, designFile }, "Design saved as JSON");

          // Also save as markdown for human readability
          const markdownFile = path.join(
            designsDir,
            `${sanitizeForFilename(modelShortName)}.md`,
          );
          const markdown = formatDesignAsMarkdown(
            design as DesignArtifact,
            model,
          );
          fs.writeFileSync(markdownFile, markdown);
          logger.info({ model, markdownFile }, "Design saved as Markdown");

          results.push({ model, success: true });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          logger.error({ model, error: errorMsg }, "Design generation failed");
          results.push({ model, success: false, error: errorMsg });
        }
      }

      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;

      return `Design generation complete.

**Lab Directory**: ${labDir}

**Results**: ${successCount} successful, ${failCount} failed

${results
  .map((r) =>
    r.success
      ? `✅ ${r.model}: Generated successfully`
      : `❌ ${r.model}: ${r.error}`,
  )
  .join("\n")}

${
  successCount >= 2
    ? `\nNext step: Run the review_designs tool to evaluate and compare the designs.`
    : `\nWarning: At least 2 successful designs are needed for meaningful comparison.`
}`;
    },
  });
}

/**
 * Format a design artifact as markdown for human readability
 */
function formatDesignAsMarkdown(design: DesignArtifact, model: string): string {
  let md = `# ${design.title}\n\n`;
  md += `**Model**: ${model}\n\n`;
  md += `## Summary\n\n${design.summary}\n\n`;

  md += `## Assumptions\n\n`;
  design.assumptions.forEach((a: string) => (md += `- ${a}\n`));
  md += `\n`;

  md += `## Architecture Overview\n\n${design.architecture_overview}\n\n`;

  md += `## Components\n\n`;
  design.components.forEach((c: DesignArtifact["components"][0]) => {
    md += `### ${c.name}\n\n${c.description}\n\n**Responsibilities**:\n`;
    c.responsibilities.forEach((r: string) => (md += `- ${r}\n`));
    md += `\n`;
  });

  md += `## Data Flow\n\n${design.data_flow}\n\n`;

  md += `## Tradeoffs\n\n`;
  design.tradeoffs.forEach((t: DesignArtifact["tradeoffs"][0]) => {
    md += `### ${t.aspect}\n\n`;
    md += `**Options**: ${t.options.join(", ")}\n\n`;
    md += `**Chosen**: ${t.chosen}\n\n`;
    md += `**Rationale**: ${t.rationale}\n\n`;
  });

  md += `## Risks\n\n`;
  design.risks.forEach((r: DesignArtifact["risks"][0]) => {
    md += `### ${r.risk} (Impact: ${r.impact})\n\n`;
    md += `**Mitigation**: ${r.mitigation}\n\n`;
  });

  md += `## Open Questions\n\n`;
  design.open_questions.forEach((q: string) => (md += `- ${q}\n`));

  return md;
}

/**
 * Generate a topic name from requirements
 */
async function generateTopic(
  ctx: PluginInput,
  _config: DesignLabConfig,
  requirements: string,
  parentSessionID?: string,
): Promise<string> {
  // Note: topic_generator_model is available in config for future use
  // when OpenCode SDK supports explicit model selection in sessions

  const sessionID = await createAgentSession(
    ctx,
    parentSessionID,
    "Topic Generation",
    ctx.directory,
  );

  const prompt = `Generate a concise 2-4 word topic name for this design task. Output ONLY the topic name, nothing else.

Requirements:
${requirements.substring(0, 500)}`;

  await sendPrompt(ctx, sessionID, prompt, {
    write: false,
    edit: false,
    bash: false,
  });

  await pollForCompletion(ctx, sessionID);
  const output = await extractSessionOutput(ctx, sessionID);

  return sanitizeForFilename(output.trim());
}

/**
 * Generate a single design using a specific model
 */
async function generateDesign(
  ctx: PluginInput,
  config: DesignLabConfig,
  model: string,
  requirements: string,
  parentSessionID?: string,
): Promise<unknown> {
  const agentConfig = createDesignAgent(model, config.design_agent_temperature);

  const sessionID = await createAgentSession(
    ctx,
    parentSessionID,
    `Design Generation - ${model}`,
    ctx.directory,
  );

  const prompt = `Generate a comprehensive design proposal for the following requirements.

## Requirements

${requirements}

## Instructions

1. Analyze the requirements thoroughly
2. Consider multiple approaches before deciding
3. Output your design as valid JSON following the required schema
4. Be specific and actionable in your design

Remember: Your entire response must be valid JSON with no other text.`;

  // Prepend system prompt to ensure JSON output
  const fullPrompt = `${agentConfig.prompt}\n\n${prompt}`;

  logger.info({ model, sessionID }, "Sending design prompt to agent");
  await sendPrompt(ctx, sessionID, fullPrompt, agentConfig.tools);

  logger.info({ model, sessionID }, "Polling for completion");
  await pollForCompletion(ctx, sessionID);

  logger.info({ model, sessionID }, "Extracting session output");
  const output = await extractSessionOutput(ctx, sessionID);

  logger.info(
    { model, outputLength: output.length },
    "Extracting JSON from output",
  );
  return extractJSON(output);
}
