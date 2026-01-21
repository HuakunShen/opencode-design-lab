import { z } from "zod";

export const ComponentSchema = z.object({
  name: z.string(),
  description: z.string(),
  responsibilities: z.array(z.string()),
  interfaces: z.array(z.string()).optional(),
});

export const TradeoffSchema = z.object({
  aspect: z.string(),
  choice: z.string(),
  rationale: z.string(),
  alternatives: z.array(z.string()).default([]),
});

export const RiskSchema = z.object({
  description: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  mitigation: z.string().optional(),
});

export const DesignArtifactSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    summary: z.string(),
    assumptions: z.array(z.string()).default([]),
    architecture_overview: z.string(),
    architecture: z.string(),
    components: z.array(ComponentSchema).default([]),
    data_flow: z.string(),
    tradeoffs: z.array(TradeoffSchema).default([]),
    risks: z.array(RiskSchema).default([]),
    open_questions: z.array(z.string()).default([]),
    additional_notes: z.string().optional(),
  })
  .strict();

export type DesignArtifact = z.infer<typeof DesignArtifactSchema>;
export type Component = z.infer<typeof ComponentSchema>;
export type Tradeoff = z.infer<typeof TradeoffSchema>;
export type Risk = z.infer<typeof RiskSchema>;
