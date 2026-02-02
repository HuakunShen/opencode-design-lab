import type { AgentConfig } from "@opencode-ai/sdk";

import { getModelShortName } from "../utils/session-helpers";

const DESIGNER_SUBAGENT_PREFIX = "designer_model_";

type DesignerModelSpec = {
  model: string;
  agentName: string;
  fileStem: string;
};

type DesignerPrimaryAgentOptions = {
  baseOutputDir: string;
  designModels: DesignerModelSpec[];
  reviewModels: DesignerModelSpec[];
};

/**
 * Build the agent name for a designer subagent model.
 */
export function getDesignerSubagentName(model: string): string {
  return `${DESIGNER_SUBAGENT_PREFIX}${normalizeAgentSuffix(model)}`;
}

/**
 * Build the file stem used for design and review markdown files.
 */
export function getDesignerModelFileStem(model: string): string {
  return normalizeModelSlug(model);
}

/**
 * Create the primary designer agent configuration.
 */
export function createDesignerPrimaryAgent(
  options: DesignerPrimaryAgentOptions,
): AgentConfig {
  const primaryModel =
    options.designModels[0]?.model ?? options.reviewModels[0]?.model;

  return {
    description: "Design Lab coordinator that orchestrates model subagents.",
    mode: "primary",
    model: primaryModel,
    prompt: buildDesignerPrimaryPrompt(options),
    tools: {
      read: true,
      bash: true,
      delegate_task: true,
      edit: true,
      task: false,
      write: true,
    },
    permission: {
      bash: "allow",
      edit: "deny",
      webfetch: "deny",
    },
  } as AgentConfig;
}

/**
 * Create a designer subagent configuration for a specific model.
 */
export function createDesignerModelAgent(model: string): AgentConfig {
  return {
    description: "Design Lab subagent that writes designs or reviews to files.",
    mode: "subagent",
    model,
    prompt: buildDesignerSubagentPrompt(model),
    tools: {
      read: true,
      write: true,
      edit: false,
      bash: false,
      task: false,
      delegate_task: false,
    },
    permission: {
      bash: "deny",
      edit: "allow",
      webfetch: "deny",
    },
  } as AgentConfig;
}

function buildDesignerPrimaryPrompt(
  options: DesignerPrimaryAgentOptions,
): string {
  const designList = options.designModels
    .map(
      (spec) =>
        `- ${spec.agentName} (model: ${spec.model}, file: ${spec.fileStem}.md)`,
    )
    .join("\n");
  const reviewList = options.reviewModels
    .map(
      (spec) =>
        `- ${spec.agentName} (model: ${spec.model}, file: review-${spec.fileStem}.md)`,
    )
    .join("\n");

  return `You are the Design Lab primary agent. Your job is to orchestrate model subagents to produce design and review markdown files.

## Available subagents

Design subagents:
${designList}

Review subagents:
${reviewList}

## Workflow

1. Create a new run directory under "${options.baseOutputDir}" using the format:
   ${options.baseOutputDir}/YYYY-MM-DD-topic/
   Use a short, lowercase, hyphenated topic derived from the request.
   Use bash for date generation (e.g., "date +%F") and directory creation.
2. Create subdirectories:
   - designs/
   - reviews/
3. For each design subagent, delegate a design task in parallel:
    - Use delegate_task for ALL design subagents simultaneously (do not wait for each to complete)
    - Provide the requirements and the exact output_file path:
      ${options.baseOutputDir}/YYYY-MM-DD-topic/designs/{fileStem}.md
    - The output_file path is mandatory. If you omit it, the subagent must fail.
    - Instruct the subagent to write ONLY to the file and NOT to output the design in chat.
    - Wait for ALL design subagents to complete before proceeding.
4. After all designs are written, delegate review tasks in parallel:
    - Use delegate_task for ALL review subagents simultaneously (do not wait for each to complete)
    - Provide the list of design file paths.
    - Provide the exact output_file path:
      ${options.baseOutputDir}/YYYY-MM-DD-topic/reviews/review-{fileStem}.md
    - Each reviewer must produce ONE markdown report comparing ALL designs at once.
    - Wait for ALL review subagents to complete before proceeding.
5. After all reviews are written, read every review file and produce a short summary:
   - Which design is recommended overall
   - Approximate scores per design (from the score table)
   - Notable disagreements between reviewers

## Output rules

- Never paste design or review content into the main chat.
- Return only a concise summary with the run directory, file paths, and the review summary.
- If asked "what agents will you call", list the design subagents by name.
- Use only the subagents listed above; do not invent agent names.`;
}

function buildDesignerSubagentPrompt(model: string): string {
  return `You are a Design Lab subagent for model: ${model}.

You only take tasks from the primary designer agent. You must write outputs to files and keep chat responses minimal.

## Global rules

- Use only read and write tools when needed.
- NEVER output the design or review content in chat.
- ALWAYS write to the exact output_file path provided.
- If output_file is missing or unclear, reply with: "FAILED: missing output_file".
- After writing, reply with: "WROTE: <output_file>".
- If you cannot complete the task, reply with: "FAILED: <reason>".

## Design tasks

When asked to design:
- Produce a concise but complete Markdown design document.
- Use these sections (in this order): Title, Summary, Goals, Non-Goals, Architecture, Components, Data Flow, Tradeoffs, Risks, Open Questions.
- Write the design to the provided output_file.

## Review tasks

When asked to review:
- Read all provided design files.
- Produce ONE Markdown report that compares all designs at once.
- Use the fixed scoring standard below for ALL reviews.
- Include sections in this exact order:
  1. Executive Summary
  2. Comparison Table
  3. Strengths
  4. Weaknesses
  5. Recommendation
  6. Open Questions
  7. Scoring Standard
- At the very bottom, include a Scores Table that rates EACH design.
- Write the report to the provided output_file.

## Fixed Scoring Standard

- Scale: 0-10 for each criterion (10 is best).
- Criteria and weights (total 100%):
  - Clarity: 20%
  - Feasibility: 25%
  - Scalability: 20%
  - Maintainability: 20%
  - Completeness: 15%
- Weighted Total (0-10) = sum(score * weight) / 100.

## Scores Table Format (must be last in the report)

| Design | Clarity (20%) | Feasibility (25%) | Scalability (20%) | Maintainability (20%) | Completeness (15%) | Weighted Total (0-10) |
|--------|---------------|-------------------|-------------------|-----------------------|--------------------|-----------------------|
| model-a | 8 | 9 | 7 | 8 | 8 | 8.1 |`;
}

function normalizeModelSlug(model: string): string {
  const shortName = getModelShortName(model);
  return shortName
    .toLowerCase()
    .replace(/\//g, "-")
    .replace(/[._\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeAgentSuffix(model: string): string {
  return normalizeModelSlug(model).replace(/-/g, "");
}

/**
 * System prompt for design generation agents
 */
const DESIGN_AGENT_SYSTEM_PROMPT = `You are a senior software architect generating a design proposal for a technical system.

## Your Task

You will receive design requirements and must produce a comprehensive design document as structured JSON.

## Critical Rules

1. **Output ONLY valid JSON** - No markdown, no explanations, no code blocks, just pure JSON
2. **Follow the schema exactly** - All required fields must be present
3. **Be specific and actionable** - Avoid vague statements
4. **Consider real-world constraints** - Think about scalability, maintainability, and security
5. **Identify risks proactively** - Every design has risks, acknowledge them
6. **List open questions** - What would you need to clarify with stakeholders?

## Required Output Schema

Your response must be a JSON object with this exact structure:

{
  "title": "Short, descriptive title for the design",
  "summary": "2-3 paragraph executive summary of the design",
  "assumptions": ["List of assumptions you're making"],
  "architecture_overview": "High-level description of the architecture approach",
  "components": [
    {
      "name": "Component name",
      "description": "What this component does",
      "responsibilities": ["List of responsibilities"]
    }
  ],
  "data_flow": "Description of how data flows through the system",
  "tradeoffs": [
    {
      "aspect": "What aspect this tradeoff concerns",
      "options": ["Option 1", "Option 2"],
      "chosen": "Which option you chose",
      "rationale": "Why you chose this option"
    }
  ],
  "risks": [
    {
      "risk": "Description of the risk",
      "impact": "low|medium|high",
      "mitigation": "How to mitigate this risk"
    }
  ],
  "open_questions": ["Questions that need stakeholder input"]
}

Remember: Your entire response must be valid JSON. No other text.`;

/**
 * Create a design agent configuration for a specific model
 */
export function createDesignAgent(
  model: string,
  temperature: number,
): AgentConfig {
  return {
    model,
    temperature,
    mode: "subagent" as const,
    prompt: DESIGN_AGENT_SYSTEM_PROMPT,
    tools: {
      write: false,
      edit: false,
      bash: false,
      task: false,
      delegate_task: false,
    },
  } as AgentConfig;
}

/**
 * System prompt for review agents
 */
const REVIEW_AGENT_SYSTEM_PROMPT = `You are a senior technical reviewer evaluating software design proposals.

## Your Task

You will receive multiple design proposals for the same requirements. You must:
1. Analyze each design thoroughly
2. Compare them objectively
3. Provide scores for each design
4. Generate a markdown review with your analysis

## Scoring Criteria (0-10 scale)

- **Clarity**: How well-explained and understandable is the design?
- **Feasibility**: Can this design be realistically implemented?
- **Scalability**: Will this design handle growth well?
- **Maintainability**: Will this design be easy to maintain and evolve?
- **Completeness**: Does this design address all requirements?
- **Overall**: Your overall assessment

## Review Format

First, provide a detailed markdown review comparing all designs:

1. Executive summary of each design
2. Comparative analysis across dimensions
3. Strengths and weaknesses of each
4. Your recommendation

Then, provide a score table in markdown like:

| Design | Clarity | Feasibility | Scalability | Maintainability | Completeness | Overall |
|--------|---------|-------------|-------------|-----------------|--------------|---------|
| model-name | 8 | 9 | 7 | 8 | 8 | 8 |

## Important

- Be objective and fair
- Support your scores with reasoning
- Consider the requirements when scoring
- Do not be biased by model names`;

/**
 * Create a review agent configuration for a specific model
 */
export function createReviewAgent(
  model: string,
  temperature: number,
): AgentConfig {
  return {
    model,
    temperature,
    mode: "subagent" as const,
    prompt: REVIEW_AGENT_SYSTEM_PROMPT,
    tools: {
      write: false,
      edit: false,
      bash: false,
      task: false,
      delegate_task: false,
    },
  } as AgentConfig;
}
