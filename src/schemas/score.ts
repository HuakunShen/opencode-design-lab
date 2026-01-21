import { z } from "zod";

export const ScoreBreakdownSchema = z.record(
  z.string(),
  z.object({
    average: z.number(),
    min: z.number(),
    max: z.number(),
    variance: z.number(),
  }),
);

export const QuantitativeScoreSchema = z
  .object({
    design_id: z.string(),
    scorer_model: z.string(),
    scores: z.record(z.string(), z.number()),
    overall_score: z.number(),
    justification: z.string(),
  })
  .strict();

export type QuantitativeScore = z.infer<typeof QuantitativeScoreSchema>;
export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>;
