import type { PluginInput } from "@opencode-ai/plugin";
import * as path from "path";
import * as fs from "fs";
import type { DesignLabConfig } from "../config/schema";
import type { DesignArtifact, DesignReview, Score } from "../schemas";
import {
  invokeQualitativeReviewAgent,
  invokeQuantitativeScoringAgent,
} from "../agents";

export interface ReviewOptions {
  baseDir: string;
  sessionID: string;
  directory: string;
}

export interface QualitativeReviewResult {
  designId: string;
  reviews: Array<{
    model: string;
    review: DesignReview;
    reviewPath: string;
  }>;
}

export interface QuantitativeReviewResult {
  designId: string;
  scores: Array<{
    model: string;
    scores: Score[];
    scoresPath: string;
  }>;
}

export interface AggregatedReview {
  designId: string;
  qualitative: {
    totalStrengths: number;
    totalWeaknesses: number;
    commonStrengths: string[];
    commonWeaknesses: string[];
    riskLevels: Record<string, number>;
  };
  quantitative: {
    scores: Score[];
    overallScore: number;
    variance: number;
    consensus: "high" | "medium" | "low";
  };
}

export async function generateQualitativeReview(
  ctx: PluginInput,
  config: DesignLabConfig,
  options: ReviewOptions,
  model: string,
  design: DesignArtifact,
  task: string,
  requirements: string,
  constraints: string,
  nonFunctionalRequirements: string,
): Promise<DesignReview> {
  return invokeQualitativeReviewAgent(
    ctx,
    options.sessionID,
    options.directory,
    model,
    config,
    design,
    task,
    requirements,
    constraints,
    nonFunctionalRequirements,
  );
}

export async function generateQuantitativeScores(
  ctx: PluginInput,
  config: DesignLabConfig,
  options: ReviewOptions,
  model: string,
  criteria: import("../config/schema").ScoringCriteria[],
  design: DesignArtifact,
  task: string,
  requirements: string,
  constraints: string,
  nonFunctionalRequirements: string,
): Promise<Score[]> {
  const scoreList = await invokeQuantitativeScoringAgent(
    ctx,
    options.sessionID,
    options.directory,
    model,
    config,
    criteria,
    design,
    task,
    requirements,
    constraints,
    nonFunctionalRequirements,
  );

  return scoreList.map((s) => ({ ...s, model }));
}

export function aggregateQualitativeReviews(
  reviews: DesignReview[],
): AggregatedReview["qualitative"] {
  const allStrengths = reviews.flatMap((r) => r.strengths);
  const allWeaknesses = reviews.flatMap((r) => r.weaknesses);

  const strengthCounts = new Map<string, number>();
  const weaknessCounts = new Map<string, number>();
  const riskCounts = new Map<string, number>();

  for (const review of reviews) {
    for (const strength of review.strengths) {
      strengthCounts.set(strength, (strengthCounts.get(strength) || 0) + 1);
    }

    for (const weakness of review.weaknesses) {
      weaknessCounts.set(weakness, (weaknessCounts.get(weakness) || 0) + 1);
    }

    riskCounts.set(
      review.risk_assessment,
      (riskCounts.get(review.risk_assessment) || 0) + 1,
    );
  }

  const commonStrengths = Array.from(strengthCounts.entries())
    .filter(([_, count]) => count >= reviews.length * 0.5)
    .map(([strength]) => strength);

  const commonWeaknesses = Array.from(weaknessCounts.entries())
    .filter(([_, count]) => count >= reviews.length * 0.5)
    .map(([weakness]) => weakness);

  return {
    totalStrengths: allStrengths.length,
    totalWeaknesses: allWeaknesses.length,
    commonStrengths,
    commonWeaknesses,
    riskLevels: Object.fromEntries(riskCounts),
  };
}

export function aggregateQuantitativeScores(
  scores: Score[][],
  criteria: import("../config/schema").ScoringCriteria[],
): AggregatedReview["quantitative"] {
  const aggregated: Score[] = [];

  for (const criterion of criteria) {
    const criterionScores = scores
      .flat()
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

  let totalWeight = 0;
  let weightedSum = 0;
  let totalVariance = 0;

  for (const score of aggregated) {
    const weight = score.weight || 1.0;
    weightedSum += score.value * weight;
    totalWeight += weight;
    totalVariance += score.variance;
  }

  const overallScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const avgVariance =
    aggregated.length > 0 ? totalVariance / aggregated.length : 0;

  let consensus: "high" | "medium" | "low";
  if (avgVariance < 0.5) {
    consensus = "high";
  } else if (avgVariance < 1.5) {
    consensus = "medium";
  } else {
    consensus = "low";
  }

  return {
    scores: aggregated,
    overallScore: Math.round(overallScore * 100) / 100,
    variance: Math.round(avgVariance * 100) / 100,
    consensus,
  };
}

export async function saveQualitativeReview(
  designDir: string,
  model: string,
  review: DesignReview,
): Promise<string> {
  const reviewPath = path.join(designDir, `review-${model}.json`);
  await fs.promises.writeFile(reviewPath, JSON.stringify(review, null, 2));
  return reviewPath;
}

export async function saveQuantitativeScores(
  designDir: string,
  model: string,
  scores: Score[],
): Promise<string> {
  const scoresPath = path.join(designDir, `scores-${model}.json`);
  await fs.promises.writeFile(scoresPath, JSON.stringify(scores, null, 2));
  return scoresPath;
}

export async function loadQualitativeReviews(
  designDir: string,
): Promise<DesignReview[]> {
  const files = await fs.promises.readdir(designDir);
  const reviewFiles = files.filter(
    (f) => f.startsWith("review-") && f.endsWith(".json"),
  );

  const reviews: DesignReview[] = [];
  for (const file of reviewFiles) {
    const filePath = path.join(designDir, file);
    const content = await fs.promises.readFile(filePath, "utf-8");
    reviews.push(JSON.parse(content));
  }

  return reviews;
}

export async function loadQuantitativeScores(
  designDir: string,
): Promise<Score[][]> {
  const files = await fs.promises.readdir(designDir);
  const scoreFiles = files.filter(
    (f) => f.startsWith("scores-") && f.endsWith(".json"),
  );

  const allScores: Score[][] = [];
  for (const file of scoreFiles) {
    const filePath = path.join(designDir, file);
    const content = await fs.promises.readFile(filePath, "utf-8");
    allScores.push(JSON.parse(content));
  }

  return allScores;
}
