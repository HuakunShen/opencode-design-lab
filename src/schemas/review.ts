import { z } from "zod";

export const QualitativeReviewSchema = z
  .object({
    design_id: z.string(),
    reviewer_model: z.string(),
    strengths: z.array(z.string()).default([]),
    weaknesses: z.array(z.string()).default([]),
    missing_considerations: z.array(z.string()).default([]),
    risk_assessment: z.enum(["low", "medium", "high"]),
    overall_impression: z.string(),
    suggested_improvements: z.array(z.string()).default([]),
  })
  .strict();

export type QualitativeReview = z.infer<typeof QualitativeReviewSchema>;
