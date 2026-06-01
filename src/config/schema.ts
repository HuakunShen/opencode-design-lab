import { z } from "zod";

/**
 * Per-model configuration.
 * Accepts a plain model string or an object with model + variant.
 * Use variant null when a model should be invoked without a variant.
 */
const VariantSchema = z.union([z.string().min(1), z.null()]);

const ModelConfigSchema = z.union([
  z.string().describe("Model identifier (e.g. 'opencode/kimi-k2.6')"),
  z.object({
    model: z.string().describe("Model identifier (e.g. 'opencode/kimi-k2.6')"),
    variant: VariantSchema.optional().describe(
      "Optional model variant. Use null to omit variant for this model.",
    ),
  }),
]);

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

/**
 * Configuration schema for OpenCode Design Lab plugin
 */
export const DesignLabConfigSchema = z.object({
  $schema: z.string().optional(),
  /**
   * List of models to use for all Design Lab workflows.
   * Each entry can be a plain model string ("opencode/kimi-k2.6") or an object
   * with model + variant ({"model": "opencode/kimi-k2.6", "variant": "xhigh"}).
   * Plain strings use default_variant during agent registration.
   * Minimum 2 models required.
   */
  models: z.array(ModelConfigSchema).min(2, "At least 2 models required"),

  /**
   * Default variant for plain model strings and object entries that omit variant.
   * Use null to invoke models without a variant by default.
   * @default "max"
   */
  default_variant: VariantSchema.default("max"),

  /**
   * Base output directory for design labs
   * @default ".design-lab"
   */
  base_output_dir: z.string().default(".design-lab"),

  /**
   * Temperature for design generation agents
   * Higher values (0.7-1.0) encourage creativity
   * @default 0.7
   */
  design_agent_temperature: z.number().min(0).max(2).default(0.7),

  /**
   * Temperature for review agents
   * Lower values (0.0-0.3) encourage consistency
   * @default 0.1
   */
  review_agent_temperature: z.number().min(0).max(2).default(0.1),

  /**
   * Model to use for topic generation
   * If not specified, uses the first design model
   */
  topic_generator_model: z.string().optional(),
});

export type DesignLabConfig = z.infer<typeof DesignLabConfigSchema>;

/**
 * Design artifact schema - what each design agent must produce
 */
export const DesignArtifactSchema = z.object({
  title: z.string(),
  summary: z.string(),
  assumptions: z.array(z.string()),
  architecture_overview: z.string(),
  components: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      responsibilities: z.array(z.string()),
    }),
  ),
  data_flow: z.string(),
  tradeoffs: z.array(
    z.object({
      aspect: z.string(),
      options: z.array(z.string()),
      chosen: z.string(),
      rationale: z.string(),
    }),
  ),
  risks: z.array(
    z.object({
      risk: z.string(),
      impact: z.enum(["low", "medium", "high"]),
      mitigation: z.string(),
    }),
  ),
  open_questions: z.array(z.string()),
});

export type DesignArtifact = z.infer<typeof DesignArtifactSchema>;

/**
 * Score schema - what review agents must produce
 */
export const ScoreSchema = z.object({
  design_id: z.string(),
  reviewer_model: z.string(),
  scores: z.object({
    clarity: z.number().min(0).max(10),
    feasibility: z.number().min(0).max(10),
    scalability: z.number().min(0).max(10),
    maintainability: z.number().min(0).max(10),
    completeness: z.number().min(0).max(10),
    overall: z.number().min(0).max(10),
  }),
  justification: z.string(),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  missing_considerations: z.array(z.string()),
});

export type Score = z.infer<typeof ScoreSchema>;

/**
 * Aggregated ranking schema
 */
export const RankingSchema = z.object({
  design_id: z.string(),
  rank: z.number().int().positive(),
  average_score: z.number(),
  score_breakdown: z.record(z.string(), z.number()),
  variance: z.number(),
  reviewer_count: z.number().int(),
});

export type Ranking = z.infer<typeof RankingSchema>;
