import type { ScoringCriteria } from "../config/schema";

export const DESIGN_GENERATION_PROMPT = `You are an expert system architect. Generate a comprehensive design proposal for the following task.

TASK:
{{task_description}}

REQUIREMENTS:
{{requirements}}

CONSTRAINTS:
{{constraints}}

NON-FUNCTIONAL REQUIREMENTS:
{{non_functional_requirements}}

Generate a design following this JSON schema:
{
  "id": "string - unique identifier for this design (use kebab-case)",
  "title": "string - concise title for the design",
  "summary": "string - brief summary of the design approach",
  "assumptions": ["string - assumptions made about the system"],
  "architecture_overview": "string - high-level architecture description",
  "architecture": "string - detailed architecture description",
  "components": [
    {
      "name": "string - component name",
      "description": "string - what the component does",
      "responsibilities": ["string - key responsibilities"],
      "interfaces": ["string - interfaces/protocols (optional)"]
    }
  ],
  "data_flow": "string - description of how data flows through the system",
  "tradeoffs": [
    {
      "aspect": "string - what aspect was considered",
      "choice": "string - what choice was made",
      "rationale": "string - why this choice was made",
      "alternatives": ["string - alternatives considered"]
    }
  ],
  "risks": [
    {
      "description": "string - risk description",
      "severity": "low|medium|high",
      "mitigation": "string - how to mitigate (optional)"
    }
  ],
  "open_questions": ["string - questions that need further investigation"],
  "additional_notes": "string - any additional context (optional)"
}

Your response must be valid JSON only, with no additional text or explanation outside the JSON object.`;

export const QUALITATIVE_REVIEW_PROMPT = `You are an expert system architecture reviewer. Review the following design proposal objectively and thoroughly.

TASK:
{{task_description}}

REQUIREMENTS:
{{requirements}}

CONSTRAINTS:
{{constraints}}

NON-FUNCTIONAL REQUIREMENTS:
{{non_functional_requirements}}

DESIGN:
{{design_json}}

Provide a qualitative assessment following this JSON schema:
{
  "design_id": "string - the design ID being reviewed",
  "reviewer_model": "string - your model identifier",
  "strengths": ["string - specific strengths of this design"],
  "weaknesses": ["string - specific weaknesses or concerns"],
  "missing_considerations": ["string - important aspects not addressed"],
  "risk_assessment": "low|medium|high - overall risk level",
  "overall_impression": "string - your overall assessment",
  "suggested_improvements": ["string - actionable suggestions"]
}

Be objective and thorough. Identify both strengths and weaknesses. Consider the design from multiple perspectives including technical feasibility, maintainability, scalability, and operational concerns.

Your response must be valid JSON only, with no additional text or explanation outside the JSON object.`;

export function buildQuantitativeScoringPrompt(
  criteria: ScoringCriteria[],
): string {
  const criteriaList = criteria
    .map(
      (c) =>
        `- ${c.name} (${c.min}-${c.max}): ${c.description}${c.weight ? ` (weight: ${c.weight})` : ""}`,
    )
    .join("\n");

  return `You are an expert system architecture evaluator. Score the following design proposal objectively and consistently.

TASK:
{{task_description}}

REQUIREMENTS:
{{requirements}}

CONSTRAINTS:
{{constraints}}

NON-FUNCTIONAL REQUIREMENTS:
{{non_functional_requirements}}

DESIGN:
{{design_json}}

SCORING CRITERIA:
${criteriaList}

SCORING GUIDELINES:
- Assign a numeric score for each criterion based on the specified range
- Be fair and consistent in your scoring
- Consider both technical merit and practical considerations
- Higher scores indicate better designs
- Provide clear justification for your scores

Generate scores following this JSON schema:
[
  {
    "name": "string - criterion name",
    "value": number - score for this criterion",
    "weight": number - weight used (optional)",
    "comment": "string - explanation for this score",
    "model": "string - your model identifier (optional)"
  }
]

Your response must be valid JSON only, with no additional text or explanation outside the JSON object.`;
}

export const TOPIC_GENERATION_PROMPT = `You are an expert at creating concise, descriptive topics for design tasks.

TASK DESCRIPTION:
{{task_description}}

Generate a short, descriptive topic (2-5 words) that captures the essence of this design task. The topic should be:
- Concise (2-5 words)
- Descriptive and clear
- Suitable for use as a directory name (no special characters, use hyphens for spaces)
- Technology-agnostic where possible
- Focus on the core concept

Your response must be a single line containing only the topic text, with no additional explanation or formatting.`;
