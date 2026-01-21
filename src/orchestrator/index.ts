import type { PluginInput } from "@opencode-ai/plugin";
import * as path from "path";
import * as fs from "fs";
import type { DesignLabConfig } from "../config/schema";
import type {
  DesignArtifact,
  DesignReview,
  Score,
  ScoredDesign,
} from "../schemas";
import {
  invokeDesignAgent,
  invokeQualitativeReviewAgent,
  invokeQuantitativeScoringAgent,
} from "../agents";
import { resolveReviewModels } from "../config";
import { log } from "../utils/logger";

export interface OrchestratorOptions {
  baseDir: string;
  designsDir: string;
  sessionID: string;
  directory: string;
}

export interface DesignResult {
  model: string;
  artifact: DesignArtifact;
  designDir: string;
}

export interface ReviewResult {
  model: string;
  review: DesignReview;
}

export interface ScoreResult {
  model: string;
  scores: Score[];
}

export async function generateDesignsInParallel(
  ctx: PluginInput,
  config: DesignLabConfig,
  options: OrchestratorOptions,
  task: string,
  requirements: string,
  constraints: string,
  nonFunctionalRequirements: string,
  models?: string[],
): Promise<DesignResult[]> {
  const { baseDir, sessionID, directory } = options;
  const modelsToUse = models && models.length > 0 ? models : config.design_models;

  const designPromises = modelsToUse.map(async (model) => {
    try {
      log(`Create session with title: ${model}`)
      const sessionResult = await ctx.client.session.create({
        body: {
          parentID: sessionID,
          title: `Design Generation (${model})`,
        },
        query: { directory },
      });

      if (sessionResult.error) {
        throw new Error(`Failed to create session: ${sessionResult.error}`);
      }
      const childSessionID = sessionResult.data.id;

      const artifact = await invokeDesignAgent(
        ctx,
        childSessionID,
        directory,
        model,
        config,
        task,
        requirements,
        constraints,
        nonFunctionalRequirements,
      );

      const timestamp = new Date().toISOString().split("T")[0];
      const sanitizedTask = task
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 50);
      const experimentDir = path.join(
        baseDir,
        `${timestamp}-${sanitizedTask}`,
      );
      const designsDir = path.join(experimentDir, "designs");
      await fs.promises.mkdir(designsDir, { recursive: true });

      // Save task info
      await fs.promises.writeFile(
        path.join(experimentDir, "task.json"),
        JSON.stringify({
          task, requirements, constraints, nonFunctionalRequirements, timestamp: new Date().toISOString()
        }, null, 2)
      );

      const artifactPath = path.join(designsDir, `design-${model.replace(/\//g, "-")}.json`);
      await fs.promises.writeFile(
        artifactPath,
        JSON.stringify(artifact, null, 2),
      );

      return { model, artifact, designDir: experimentDir };
    } catch (error) {
      throw new Error(
        `Design generation failed for model ${model}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  return Promise.all(designPromises);
}

export async function generateQualitativeReviewsInParallel(
  ctx: PluginInput,
  config: DesignLabConfig,
  options: OrchestratorOptions,
  designs: DesignResult[],
  task: string,
  requirements: string,
  constraints: string,
  nonFunctionalRequirements: string,
): Promise<Record<string, ReviewResult[]>> {
  const { sessionID, directory } = options;

  if (!config.review?.qualitative?.enabled) {
    return {};
  }

  const reviewModels = resolveReviewModels(config);

  const results: Record<string, ReviewResult[]> = {};

  for (const design of designs) {
    const reviews: ReviewResult[] = [];

    for (const model of reviewModels) {
      try {
        const sessionResult = await ctx.client.session.create({
          body: {
            parentID: sessionID,
            title: `Qualitative Review (${model}) - ${design.artifact.id}`,
          },
          query: { directory },
        });

        if (sessionResult.error) {
          throw new Error(`Failed to create session: ${sessionResult.error}`);
        }
        const childSessionID = sessionResult.data.id;

        const review = await invokeQualitativeReviewAgent(
          ctx,
          childSessionID,
          directory,
          model,
          config,
          design.artifact,
          task,
          requirements,
          constraints,
          nonFunctionalRequirements,
        );

        const reviewsDir = path.join(design.designDir, "reviews");
        await fs.promises.mkdir(reviewsDir, { recursive: true });
        
        const reviewPath = path.join(reviewsDir, `review-${design.artifact.id}-${model.replace(/\//g, "-")}.json`);
        await fs.promises.writeFile(
          reviewPath,
          JSON.stringify(review, null, 2),
        );

        reviews.push({ model, review });
      } catch (error) {
        throw new Error(
          `Qualitative review failed for model ${model} on design ${design.artifact.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    results[design.artifact.id] = reviews;
  }

  return results;
}

export async function generateQuantitativeScoresInParallel(
  ctx: PluginInput,
  config: DesignLabConfig,
  options: OrchestratorOptions,
  designs: DesignResult[],
  task: string,
  requirements: string,
  constraints: string,
  nonFunctionalRequirements: string,
): Promise<Record<string, ScoreResult[]>> {
  const { sessionID, directory } = options;

  if (!config.review?.quantitative?.enabled) {
    return {};
  }

  const scoringModels = resolveReviewModels(config);
  const criteria = config.review?.quantitative?.criteria || [];

  const results: Record<string, ScoreResult[]> = {};

  for (const design of designs) {
    const scores: ScoreResult[] = [];

    for (const model of scoringModels) {
      try {
        const sessionResult = await ctx.client.session.create({
          body: {
            parentID: sessionID,
            title: `Quantitative Scoring (${model}) - ${design.artifact.id}`,
          },
          query: { directory },
        });

        if (sessionResult.error) {
          throw new Error(`Failed to create session: ${sessionResult.error}`);
        }
        const childSessionID = sessionResult.data.id;

        const scoreList = await invokeQuantitativeScoringAgent(
          ctx,
          childSessionID,
          directory,
          model,
          config,
          criteria,
          design.artifact,
          task,
          requirements,
          constraints,
          nonFunctionalRequirements,
        );

        const scoresWithModel = scoreList.map((s) => ({ ...s, model }));

        const scoresDir = path.join(design.designDir, "scores");
        await fs.promises.mkdir(scoresDir, { recursive: true });

        const scoresPath = path.join(scoresDir, `score-${design.artifact.id}-${model.replace(/\//g, "-")}.json`);
        await fs.promises.writeFile(
          scoresPath,
          JSON.stringify(scoreList, null, 2),
        );

        scores.push({ model, scores: scoresWithModel });
      } catch (error) {
        throw new Error(
          `Quantitative scoring failed for model ${model} on design ${design.artifact.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    results[design.artifact.id] = scores;
  }

  return results;
}

export function aggregateScores(
  scoreResults: ScoreResult[],
  criteria: import("../config/schema").ScoringCriteria[],
): Score[] {
  const aggregated: Score[] = [];

  for (const criterion of criteria) {
    const criterionScores = scoreResults
      .flatMap((sr) => sr.scores)
      .filter((s) => s.name === criterion.name);

    if (criterionScores.length === 0) {
      aggregated.push({
        name: criterion.name,
        value: criterion.min,
        weight: 1.0,
        variance: 0,
        comment: "No scores provided",
      });
      continue;
    }

    const weight = criterion.weight || 1.0;
    const weightedValues = criterionScores.map((s) => s.value * weight);
    const average =
      weightedValues.reduce((sum, val) => sum + val, 0) / weightedValues.length;
    const weightedAverage = average / weight;

    const variance =
      criterionScores.reduce(
        (sum, s) => sum + Math.pow(s.value - weightedAverage, 2),
        0,
      ) / criterionScores.length;

    const comments = criterionScores
      .map((s) => `[${s.model || "unknown"}] ${s.comment || ""}`)
      .filter((c) => c)
      .join("; ");

    aggregated.push({
      name: criterion.name,
      value: Math.round(weightedAverage * 100) / 100,
      weight,
      variance: Math.round(variance * 100) / 100,
      comment: comments || "No comments",
    });
  }

  return aggregated;
}

export function calculateOverallScore(scores: Score[]): number {
  if (scores.length === 0) return 0;

  let totalWeight = 0;
  let weightedSum = 0;

  for (const score of scores) {
    const weight = score.weight || 1.0;
    weightedSum += score.value * weight;
    totalWeight += weight;
  }

  return totalWeight > 0
    ? Math.round((weightedSum / totalWeight) * 100) / 100
    : 0;
}

export function rankDesigns(
  designs: DesignResult[],
  qualitativeReviews: Record<string, ReviewResult[]>,
  quantitativeScores: Record<string, ScoreResult[]>,
  criteria: import("../config/schema").ScoringCriteria[],
): ScoredDesign[] {
  const scoredDesigns: ScoredDesign[] = [];

  for (const design of designs) {
    const aggregatedScores = aggregateScores(
      quantitativeScores[design.artifact.id] || [],
      criteria,
    );
    const overallScore = calculateOverallScore(aggregatedScores);

    scoredDesigns.push({
      designId: design.artifact.id,
      title: design.artifact.title,
      summary: design.artifact.summary,
      architecture: design.artifact.architecture,
      scores: aggregatedScores,
      overallScore,
      qualitativeReviews: qualitativeReviews[design.artifact.id] || [],
      generatedBy: design.model,
    });
  }

  scoredDesigns.sort((a, b) => b.overallScore - a.overallScore);

  return scoredDesigns;
}

export async function saveAggregatedResults(
  baseDir: string,
  rankedDesigns: ScoredDesign[],
): Promise<void> {
  const resultsPath = path.join(baseDir, "results.json");
  await fs.promises.writeFile(
    resultsPath,
    JSON.stringify(rankedDesigns, null, 2),
  );
}
