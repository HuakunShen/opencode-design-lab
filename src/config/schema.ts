import { z } from "zod";

/**
 * Configuration schema for OpenCode Design Lab plugin
 */
export const DesignLabConfigSchema = z.object({
  "$schema": z.string().optional(),
  /**
   * List of models to use for design generation
   * Each model will generate one independent design
   */
  design_models: z.array(z.string()).min(2, "At least 2 design models required"),

  /**
   * List of models to use for design review and scoring
   * If not specified, defaults to using all design_models
   */
  review_models: z.array(z.string()).optional(),

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
    })
  ),
  data_flow: z.string(),
  tradeoffs: z.array(
    z.object({
      aspect: z.string(),
      options: z.array(z.string()),
      chosen: z.string(),
      rationale: z.string(),
    })
  ),
  risks: z.array(
    z.object({
      risk: z.string(),
      impact: z.enum(["low", "medium", "high"]),
      mitigation: z.string(),
    })
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
