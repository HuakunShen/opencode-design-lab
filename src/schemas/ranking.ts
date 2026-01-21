import { z } from "zod";
import { ScoreBreakdownSchema } from "./score";
import { QualitativeReviewSchema } from "./review";

export const ScoreSchema = z.object({
  name: z.string(),
  value: z.number(),
  weight: z.number().optional().default(1.0),
  variance: z.number().optional().default(0),
  comment: z.string().optional(),
  model: z.string().optional(),
});

export const ScoredDesignSchema = z.object({
  designId: z.string(),
  title: z.string(),
  summary: z.string(),
  architecture: z.string(),
  scores: z.array(ScoreSchema).default([]),
  overallScore: z.number(),
  qualitativeReviews: z.array(z.any()).default([]),
  generatedBy: z.string(),
});

export const QualitativeSummarySchema = z.object({
  total_strengths: z.number(),
  total_weaknesses: z.number(),
  common_strengths: z.array(z.string()).default([]),
  common_weaknesses: z.array(z.string()).default([]),
});

export type DesignReview = z.infer<typeof QualitativeReviewSchema>;
export type Score = z.infer<typeof ScoreSchema>;
export type ScoredDesign = z.infer<typeof ScoredDesignSchema>;

export const RankedDesignSchema = z.object({
  design_id: z.string(),
  generating_model: z.string(),
  rank: z.number(),
  average_score: z.number(),
  score_breakdown: ScoreBreakdownSchema,
  qualitative_summary: QualitativeSummarySchema,
});

export const SummaryStatsSchema = z.object({
  total_designs: z.number(),
  total_reviewers: z.number(),
  average_variance: z.number(),
  consensus: z.enum(["high", "medium", "low"]),
});

export const RankingResultSchema = z
  .object({
    experiment_id: z.string(),
    topic: z.string(),
    timestamp: z.string(),
    designs: z.array(RankedDesignSchema),
    summary: SummaryStatsSchema,
  })
  .strict();

export type QualitativeSummary = z.infer<typeof QualitativeSummarySchema>;
export type RankedDesign = z.infer<typeof RankedDesignSchema>;
export type SummaryStats = z.infer<typeof SummaryStatsSchema>;
export type RankingResult = z.infer<typeof RankingResultSchema>;
