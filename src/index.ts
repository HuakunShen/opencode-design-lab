import { tool, type Plugin, type PluginInput } from "@opencode-ai/plugin";
import { loadConfig } from "./config";
import { createDesignIsolationHook } from "./hooks";
import {
  generateDesignsInParallel,
  generateQualitativeReviewsInParallel,
  generateQuantitativeScoresInParallel,
  rankDesigns,
  type DesignResult,
  type OrchestratorOptions,
} from "./orchestrator";
import type { DesignArtifact } from "./schemas";
import * as fs from "fs/promises";
import * as path from "path";

export interface GenerateDesignsArgs {
  task: string;
  requirements?: string;
  constraints?: string;
  non_functional_requirements?: string;
  num_designs?: number;
  models?: string[];
}

export interface ReviewDesignsArgs {
  design_ids?: string[];
  review_models?: string[];
  task?: string;
  requirements?: string;
  constraints?: string;
  non_functional_requirements?: string;
}

export interface ScoreDesignsArgs {
  design_ids?: string[];
  scoring_models?: string[];
  criteria?: Array<{
    name: string;
    description: string;
    min: number;
    max: number;
    weight?: number;
  }>;
  task?: string;
  requirements?: string;
  constraints?: string;
  non_functional_requirements?: string;
}

const OpenCodeDesignLabPlugin: Plugin = async (ctx: PluginInput) => {
  const config = loadConfig(ctx.directory);
  const outputDir = path.join(
    ctx.directory,
    config.output?.base_dir || ".design-lab",
  );
  const designsDir = path.join(outputDir, "designs");

  await fs.mkdir(designsDir, { recursive: true });

  const designIsolationHook = createDesignIsolationHook(config, ctx.directory);

  const generateDesignsTool = tool({
    description:
      "Generate multiple independent design proposals using different AI models",
    args: {
      task: tool.schema.string().describe("The design task to accomplish"),
      requirements: tool.schema
        .string()
        .optional()
        .describe("Functional requirements for the design"),
      constraints: tool.schema
        .string()
        .optional()
        .describe("Constraints and limitations"),
      non_functional_requirements: tool.schema
        .string()
        .optional()
        .describe("Non-functional requirements (performance, security, etc.)"),
      num_designs: tool.schema
        .number()
        .optional()
        .describe("Number of designs to generate (default: 3)"),
      models: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe(
          "List of models to use for generation (default: from config)",
        ),
    },
    async execute(args: GenerateDesignsArgs, toolContext) {
      const orchestratorOptions: OrchestratorOptions = {
        baseDir: outputDir,
        designsDir,
        sessionID: toolContext.sessionID,
        directory: ctx.directory,
      };

      let targetModels = args.models;
      if (!targetModels && args.num_designs) {
        targetModels = config.design_models.slice(0, args.num_designs);
      }

      const results = await generateDesignsInParallel(
        ctx,
        config,
        orchestratorOptions,
        args.task,
        args.requirements || "",
        args.constraints || "",
        args.non_functional_requirements || "",
        targetModels,
      );

      return JSON.stringify({
        success: true,
        num_designs: results.length,
        designs: results.map((r) => ({
          id: r.artifact.id,
          model: r.model,
          file: path.join(r.designDir, "designs", `design-${r.model.replace(/\//g, "-")}.json`),
        })),
      });
    },
  });

  const reviewDesignsTool = tool({
    description: "Review and evaluate generated designs",
    args: {
      design_ids: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("List of design IDs to review (default: all)"),
      review_models: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Models to use for review (default: from config)"),
    },
    async execute(args: ReviewDesignsArgs, toolContext) {
      const orchestratorOptions: OrchestratorOptions = {
        baseDir: outputDir,
        designsDir,
        sessionID: toolContext.sessionID,
        directory: ctx.directory,
      };

      const designs: DesignResult[] = [];
      const experimentDirs = await fs.readdir(outputDir).catch(() => [] as string[]);

      for (const expDir of experimentDirs) {
        if (!expDir.includes("-")) continue; // Skip non-experiment folders like "designs" from old runs
        const designsDirPath = path.join(outputDir, expDir, "designs");
        if (!await fs.stat(designsDirPath).catch(() => false)) continue;

        const designFiles = await fs.readdir(designsDirPath);
        for (const file of designFiles) {
          if (!file.endsWith(".json")) continue;
          
          const designPath = path.join(designsDirPath, file);
          try {
            const content = await fs.readFile(designPath, "utf-8");
            const artifact = JSON.parse(content) as DesignArtifact;

            // Filter by ID if specified
            if (args.design_ids && !args.design_ids.includes(artifact.id)) {
              continue;
            }

            // infer model from filename if possible: design-{model}.json
            let model = "unknown";
            const match = file.match(/^design-(.+)\.json$/);
            if (match) {
              model = match[1];
            }

            designs.push({
              model,
              artifact,
              designDir: path.join(outputDir, expDir),
            });
          } catch {
            continue;
          }
        }
      }

      const results = await generateQualitativeReviewsInParallel(
        ctx,
        config,
        orchestratorOptions,
        designs,
        args.task || "",
        args.requirements || "",
        args.constraints || "",
        args.non_functional_requirements || "",
      );

      return JSON.stringify({
        success: true,
        num_reviews: Object.keys(results).length,
        reviews: Object.entries(results).map(([designId, reviewList]) => ({
          design_id: designId,
          num_reviews: reviewList.length,
        })),
      });
    },
  });

  const scoreDesignsTool = tool({
    description: "Score and evaluate designs using quantitative criteria",
    args: {
      design_ids: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("List of design IDs to score (default: all)"),
      scoring_models: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Models to use for scoring (default: from config)"),
      criteria: tool.schema
        .array(
          tool.schema.object({
            name: tool.schema.string(),
            description: tool.schema.string(),
            min: tool.schema.number(),
            max: tool.schema.number(),
            weight: tool.schema.number().optional(),
          }),
        )
        .optional()
        .describe("Scoring criteria (default: from config)"),
    },
    async execute(args: ScoreDesignsArgs, toolContext) {
      const orchestratorOptions: OrchestratorOptions = {
        baseDir: outputDir,
        designsDir,
        sessionID: toolContext.sessionID,
        directory: ctx.directory,
      };

      const designs: DesignResult[] = [];
      const experimentDirs = await fs.readdir(outputDir).catch(() => [] as string[]);

      for (const expDir of experimentDirs) {
        if (!expDir.includes("-")) continue;
        const designsDirPath = path.join(outputDir, expDir, "designs");
        if (!await fs.stat(designsDirPath).catch(() => false)) continue;

        const designFiles = await fs.readdir(designsDirPath);
        for (const file of designFiles) {
          if (!file.endsWith(".json")) continue;
          
          const designPath = path.join(designsDirPath, file);
          try {
            const content = await fs.readFile(designPath, "utf-8");
            const artifact = JSON.parse(content) as DesignArtifact;

            if (args.design_ids && !args.design_ids.includes(artifact.id)) {
              continue;
            }

            let model = "unknown";
            const match = file.match(/^design-(.+)\.json$/);
            if (match) {
              model = match[1];
            }

            designs.push({
              model,
              artifact,
              designDir: path.join(outputDir, expDir),
            });
          } catch {
            continue;
          }
        }
      }

      const results = await generateQuantitativeScoresInParallel(
        ctx,
        config,
        orchestratorOptions,
        designs,
        args.task || "",
        args.requirements || "",
        args.constraints || "",
        args.non_functional_requirements || "",
      );

      return JSON.stringify({
        success: true,
        num_scores: Object.keys(results).length,
        scores: Object.entries(results).map(([designId, scoreList]) => ({
          design_id: designId,
          num_scores: scoreList.length,
        })),
      });
    },
  });

  const rankDesignsTool = tool({
    description: "Rank designs based on scores and reviews",
    args: {},
    async execute(_args: Record<string, never>, _toolContext) {
      const designs: DesignResult[] = [];
      const experimentDirs = await fs.readdir(outputDir).catch(() => [] as string[]);

      for (const expDir of experimentDirs) {
        if (!expDir.includes("-")) continue;
        const designsDirPath = path.join(outputDir, expDir, "designs");
        if (!await fs.stat(designsDirPath).catch(() => false)) continue;

        const designFiles = await fs.readdir(designsDirPath);
        for (const file of designFiles) {
          if (!file.endsWith(".json")) continue;
          
          const designPath = path.join(designsDirPath, file);
          try {
            const content = await fs.readFile(designPath, "utf-8");
            const artifact = JSON.parse(content) as DesignArtifact;
            
            let model = "unknown";
            const match = file.match(/^design-(.+)\.json$/);
            if (match) {
              model = match[1];
            }

            designs.push({
              model,
              artifact,
              designDir: path.join(outputDir, expDir),
            });
          } catch {
            continue;
          }
        }
      }

      const qualitativeReviews: Record<string, any[]> = {};
      const quantitativeScores: Record<string, any[]> = {};
      const criteriaWithDefaults = (
        config.review?.quantitative?.criteria || []
      ).map((c) => ({
        ...c,
        weight: c.weight ?? 1.0,
      }));

      const ranked = rankDesigns(
        designs,
        qualitativeReviews,
        quantitativeScores,
        criteriaWithDefaults,
      );

      const outputPath = path.join(outputDir, "ranked-designs.json");
      await fs.writeFile(outputPath, JSON.stringify(ranked, null, 2));

      return JSON.stringify({
        success: true,
        ranked_designs: ranked.map((r) => ({
          id: r.designId,
          title: r.title,
          overall_score: r.overallScore,
        })),
      });
    },
  });

  const runDesignExperimentTool = tool({
    description: "Run a full design experiment: generate, review, score, and rank designs in one go",
    args: {
      task: tool.schema.string().describe("The design task to accomplish"),
      requirements: tool.schema.string().optional().describe("Functional requirements"),
      constraints: tool.schema.string().optional().describe("Constraints and limitations"),
      non_functional_requirements: tool.schema.string().optional().describe("Non-functional requirements"),
      num_designs: tool.schema.number().optional().describe("Number of designs to generate"),
      models: tool.schema.array(tool.schema.string()).optional().describe("Models to use"),
    },
    async execute(args: GenerateDesignsArgs, toolContext) {
      const orchestratorOptions: OrchestratorOptions = {
        baseDir: outputDir,
        designsDir,
        sessionID: toolContext.sessionID,
        directory: ctx.directory,
      };

      let targetModels = args.models;
      if (!targetModels && args.num_designs) {
        targetModels = config.design_models.slice(0, args.num_designs);
      }

      // 1. Generate Designs
      const designs = await generateDesignsInParallel(
        ctx,
        config,
        orchestratorOptions,
        args.task,
        args.requirements || "",
        args.constraints || "",
        args.non_functional_requirements || "",
        targetModels,
      );

      // 2. Qualitative Reviews
      const reviews = await generateQualitativeReviewsInParallel(
        ctx,
        config,
        orchestratorOptions,
        designs,
        args.task,
        args.requirements || "",
        args.constraints || "",
        args.non_functional_requirements || "",
      );

      // 3. Quantitative Scoring
      const scores = await generateQuantitativeScoresInParallel(
        ctx,
        config,
        orchestratorOptions,
        designs,
        args.task,
        args.requirements || "",
        args.constraints || "",
        args.non_functional_requirements || "",
      );

      // 4. Ranking
      const criteriaWithDefaults = (
        config.review?.quantitative?.criteria || []
      ).map((c) => ({
        ...c,
        weight: c.weight ?? 1.0,
      }));

      const ranked = rankDesigns(
        designs,
        reviews,
        scores,
        criteriaWithDefaults,
      );

      // 5. Save Results (results.json in the experiment directory)
      // We assume all designs flagged in the same experiment directory since they were just generated
      // Use the first design's directory as the base for the experiment results
      if (designs.length > 0) {
         const experimentDir = designs[0].designDir;
         await fs.writeFile(
           path.join(experimentDir, "results.json"),
           JSON.stringify(ranked, null, 2)
         );
      }

      return JSON.stringify({
        success: true,
        experiment_dir: designs.length > 0 ? designs[0].designDir : null,
        num_designs: designs.length,
        ranked_designs: ranked.map((r) => ({
          id: r.designId,
          title: r.title,
          overall_score: r.overallScore,
          generated_by: r.generatedBy,
        })),
      });
    },
  });

  return {
    tool: {
      generate_designs: generateDesignsTool,
      review_designs: reviewDesignsTool,
      score_designs: scoreDesignsTool,
      rank_designs: rankDesignsTool,
      run_design_experiment: runDesignExperimentTool,
    },
    "tool.execute.before": designIsolationHook
      ? async (input: any, output: any) => {
          const handlerInput = input as {
            tool: string;
            sessionID?: string;
            callID?: string;
          };
          if (!handlerInput.sessionID) return;
          designIsolationHook.getHandler()(
            {
              tool: handlerInput.tool,
              sessionID: handlerInput.sessionID,
              callID: handlerInput.callID || "",
            },
            output,
          );
        }
      : undefined,
  };
};

export default OpenCodeDesignLabPlugin;
