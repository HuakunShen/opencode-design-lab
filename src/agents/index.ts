import type { AgentConfig } from "@opencode-ai/sdk";

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
