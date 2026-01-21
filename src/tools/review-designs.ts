import {
  tool,
  type PluginInput,
  type ToolDefinition,
} from "@opencode-ai/plugin";
import * as fs from "fs";
import * as path from "path";
import { type DesignLabConfig, ScoreSchema, type Score } from "../config";
import { createReviewAgent } from "../agents";
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

interface ReviewDesignsArgs {
  lab_path?: string;
}

/**
 * Create the review_designs tool
 */
export function createReviewDesignsTool(
  ctx: PluginInput,
  config: DesignLabConfig,
): ToolDefinition {
  const reviewModels = config.review_models ?? config.design_models;

  return tool({
    description: `Review and score design proposals using ${reviewModels.length} reviewer models.

Each reviewer analyzes all designs and provides:
1. A markdown review comparing the designs
2. Numeric scores (0-10) across dimensions: clarity, feasibility, scalability, maintainability, completeness, overall

Use this after generate_designs to evaluate and compare the generated designs.`,
    args: {
      lab_path: tool.schema
        .string()
        .describe(
          `Path to the design lab directory (e.g., .design-lab/2024-01-15-api-gateway). If not provided, uses the most recent lab.`,
        )
        .optional(),
    },
    async execute(args: ReviewDesignsArgs, toolContext) {
      const sessionID = toolContext.sessionID;

      // Find lab directory
      const labDir = args.lab_path
        ? path.resolve(ctx.directory, args.lab_path)
        : findMostRecentLab(ctx.directory, config.base_output_dir);

      if (!labDir) {
        return "Error: No design lab found. Run generate_designs first.";
      }

      const designsDir = path.join(labDir, "designs");
      const reviewsDir = path.join(labDir, "reviews");
      const scoresDir = path.join(labDir, "scores");

      // Load all design files (only JSON, not markdown)
      const designFiles = fs
        .readdirSync(designsDir)
        .filter((f) => f.endsWith(".json"));
      if (designFiles.length === 0) {
        return "Error: No designs found in the lab directory.";
      }

      const designs: Record<string, unknown> = {};
      for (const file of designFiles) {
        const designId = file.replace(".json", "");
        const content = fs.readFileSync(path.join(designsDir, file), "utf-8");
        designs[designId] = JSON.parse(content);
      }

      // Load task requirements
      const taskPath = path.join(labDir, "task.json");
      const taskData = JSON.parse(fs.readFileSync(taskPath, "utf-8"));
      const requirements = taskData.requirements;

      // Run reviews
      const results: Array<{
        model: string;
        success: boolean;
        error?: string;
      }> = [];

      for (const model of reviewModels) {
        try {
          const { review, scores } = await generateReview(
            ctx,
            config,
            model,
            requirements,
            designs,
            sessionID,
          );

          // Save review markdown
          const reviewFile = path.join(
            reviewsDir,
            `review-${sanitizeForFilename(getModelShortName(model))}.md`,
          );
          fs.writeFileSync(reviewFile, review);
          logger.info({ model, reviewFile }, "Review saved");

          // Save scores as JSON
          for (const score of scores) {
            const validationResult = ScoreSchema.safeParse(score);
            if (!validationResult.success) {
              console.warn(
                `Score validation warning for ${score.design_id}:`,
                validationResult.error,
              );
            }

            const designShortName = getModelShortName(score.design_id);
            const reviewerShortName = getModelShortName(model);
            const scoreFile = path.join(
              scoresDir,
              `${sanitizeForFilename(designShortName)}-reviewed-by-${sanitizeForFilename(reviewerShortName)}.json`,
            );
            fs.writeFileSync(scoreFile, JSON.stringify(score, null, 2));
          }

          results.push({ model, success: true });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          results.push({ model, success: false, error: errorMsg });
        }
      }

      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;

      return `Review complete.

**Lab Directory**: ${labDir}

**Results**: ${successCount} successful, ${failCount} failed

${results
  .map((r) =>
    r.success ? `✅ ${r.model}: Review generated` : `❌ ${r.model}: ${r.error}`,
  )
  .join("\n")}

**Reviews saved to**: ${reviewsDir}
**Scores saved to**: ${scoresDir}

${successCount > 0 ? `\nNext step: Run the aggregate_scores tool to generate final rankings.` : ""}`;
    },
  });
}

/**
 * Find the most recent design lab directory
 */
function findMostRecentLab(projectDir: string, baseDir: string): string | null {
  const labBaseDir = path.join(projectDir, baseDir);
  if (!fs.existsSync(labBaseDir)) {
    return null;
  }

  const labs = fs
    .readdirSync(labBaseDir)
    .filter((d) => fs.statSync(path.join(labBaseDir, d)).isDirectory())
    .sort()
    .reverse();

  if (labs.length === 0) {
    return null;
  }

  return path.join(labBaseDir, labs[0]);
}

/**
 * Generate a review using a specific model
 */
async function generateReview(
  ctx: PluginInput,
  config: DesignLabConfig,
  model: string,
  requirements: string,
  designs: Record<string, unknown>,
  parentSessionID?: string,
): Promise<{ review: string; scores: Score[] }> {
  const agentConfig = createReviewAgent(model, config.review_agent_temperature);

  const sessionID = await createAgentSession(
    ctx,
    parentSessionID,
    `Design Review - ${model}`,
    ctx.directory,
  );

  // Format designs for review
  const designsText = Object.entries(designs)
    .map(
      ([id, design]) =>
        `## Design: ${id}\n\n\`\`\`json\n${JSON.stringify(design, null, 2)}\n\`\`\``,
    )
    .join("\n\n---\n\n");

  const prompt = `Review and compare the following design proposals.

## Original Requirements

${requirements}

## Designs to Review

${designsText}

## Your Task

1. Analyze each design thoroughly
2. Compare them across dimensions: clarity, feasibility, scalability, maintainability, completeness
3. Provide a detailed markdown review with your analysis
4. At the end, include a score table in markdown format
5. Identify strengths and weaknesses of each design

Be objective and support your assessments with specific observations.`;

  // Prepend system prompt
  const fullPrompt = `${agentConfig.prompt}\n\n${prompt}`;

  await sendPrompt(ctx, sessionID, fullPrompt, agentConfig.tools);
  await pollForCompletion(ctx, sessionID);
  const review = await extractSessionOutput(ctx, sessionID);

  // Now get structured scores in a follow-up
  const designIds = Object.keys(designs);
  const scoresPrompt = `Now output the scores for each design as a JSON array. Each element should have this structure:

{
  "design_id": "EXACT_DESIGN_ID_FROM_LIST_BELOW",
  "reviewer_model": "${model}",
  "scores": {
    "clarity": 0-10,
    "feasibility": 0-10,
    "scalability": 0-10,
    "maintainability": 0-10,
    "completeness": 0-10,
    "overall": 0-10
  },
  "justification": "Brief overall justification",
  "strengths": ["list", "of", "strengths"],
  "weaknesses": ["list", "of", "weaknesses"],
  "missing_considerations": ["list", "of", "things", "missing"]
}

**IMPORTANT**: The "design_id" field MUST be one of these exact values:
${designIds.map((id) => `- "${id}"`).join("\n")}

Output ONLY the JSON array with one score object per design. No other text.`;

  await sendPrompt(ctx, sessionID, scoresPrompt, agentConfig.tools);
  await pollForCompletion(ctx, sessionID);
  const scoresOutput = await extractSessionOutput(ctx, sessionID);

  const scores = extractJSON<Score[]>(scoresOutput);

  return { review, scores };
}
