import { z } from "zod";

export const ScoringCriteriaSchema = z.object({
  name: z.string(),
  description: z.string(),
  min: z.number(),
  max: z.number(),
  weight: z.number().optional().default(1.0),
});

export const DesignSettingsSchema = z.object({
  agent_prompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_tokens: z.number().optional(),
});

export const QualitativeReviewConfigSchema = z.object({
  enabled: z.boolean().default(true),
  models: z.array(z.string()).optional(),
});

export const QuantitativeReviewConfigSchema = z.object({
  enabled: z.boolean().default(true),
  models: z.array(z.string()).optional(),
  criteria: z.array(ScoringCriteriaSchema).optional(),
});

export const ReviewConfigSchema = z.object({
  qualitative: QualitativeReviewConfigSchema.optional(),
  quantitative: QuantitativeReviewConfigSchema.optional(),
});

export const DesignIsolationConfigSchema = z.object({
  enabled: z.boolean().default(true),
  strict_mode: z.boolean().optional(),
});

export const HooksConfigSchema = z.object({
  design_isolation: DesignIsolationConfigSchema.optional(),
});

export const OutputConfigSchema = z.object({
  base_dir: z.string().default(".design-lab"),
  format: z.enum(["json", "jsonc"]).default("jsonc"),
});

export const DesignLabConfigSchema = z
  .object({
    $schema: z.string().optional(),
    plugins: z.array(z.string()).optional(),
    design_models: z.array(z.string()).min(1),
    review_models: z.array(z.string()).optional(),
    topic_generation_model: z.string().optional(),
    design: DesignSettingsSchema.optional(),
    review: ReviewConfigSchema.optional(),
    hooks: HooksConfigSchema.optional(),
    output: OutputConfigSchema.optional(),
  })
  .strict();

export type DesignLabConfig = z.infer<typeof DesignLabConfigSchema>;
export type ScoringCriteria = z.infer<typeof ScoringCriteriaSchema>;
export type DesignSettings = z.infer<typeof DesignSettingsSchema>;
export type QualitativeReviewConfig = z.infer<
  typeof QualitativeReviewConfigSchema
>;
export type QuantitativeReviewConfig = z.infer<
  typeof QuantitativeReviewConfigSchema
>;
export type ReviewConfig = z.infer<typeof ReviewConfigSchema>;
export type DesignIsolationConfig = z.infer<typeof DesignIsolationConfigSchema>;
export type HooksConfig = z.infer<typeof HooksConfigSchema>;
export type OutputConfig = z.infer<typeof OutputConfigSchema>;

export const DEFAULT_SCORING_CRITERIA: ScoringCriteria[] = [
  {
    name: "clarity",
    description: "How clear and understandable is the design?",
    min: 0,
    max: 10,
    weight: 1.0,
  },
  {
    name: "feasibility",
    description: "How technically feasible is the design?",
    min: 0,
    max: 10,
    weight: 1.2,
  },
  {
    name: "scalability",
    description: "How well does the design scale?",
    min: 0,
    max: 10,
    weight: 1.0,
  },
  {
    name: "maintainability",
    description: "How maintainable is the design?",
    min: 0,
    max: 10,
    weight: 1.0,
  },
  {
    name: "innovation",
    description: "How innovative is the approach?",
    min: 0,
    max: 10,
    weight: 0.8,
  },
];

export const DEFAULT_DESIGN_SETTINGS: DesignSettings = {
  temperature: 0.7,
  top_p: 0.9,
  max_tokens: 4000,
};

export const DEFAULT_CONFIG: Partial<DesignLabConfig> = {
  design: DEFAULT_DESIGN_SETTINGS,
  review: {
    qualitative: { enabled: true },
    quantitative: {
      enabled: true,
      criteria: DEFAULT_SCORING_CRITERIA,
    },
  },
  hooks: {
    design_isolation: { enabled: true },
  },
  output: {
    base_dir: ".design-lab",
    format: "jsonc",
  },
};
