import type { AgentConfig } from "@opencode-ai/sdk";

import type { ModelConfig } from "../config/schema";
import { getModelShortName } from "../utils/session-helpers";

const DESIGNER_SUBAGENT_PREFIX = "designer_model_";

type DesignerModelSpec = {
  model: string;
  variant?: string;
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
 * Normalize a ModelConfig (string or object) to { model, variant }.
 * String entries get default variant "max".
 */
export function normalizeModelConfig(
  config: ModelConfig,
): { model: string; variant: string } {
  if (typeof config === "string") {
    return { model: config, variant: "max" };
  }
  return { model: config.model, variant: config.variant ?? "max" };
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
export function createDesignerModelAgent(
  model: string,
  variant?: string,
): AgentConfig {
  return {
    description: "Design Lab subagent that writes designs or reviews to files.",
    mode: "subagent",
    model,
    ...(variant ? { variant } : {}),
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
  const designSpecs = options.designModels;
  const reviewSpecs = options.reviewModels;

  const designList = designSpecs
    .map(
      (spec) =>
        `- ${spec.agentName} (model: ${spec.model}${spec.variant ? `, variant: ${spec.variant}` : ""}, file: ${spec.fileStem}.md)`,
    )
    .join("\n");
  const reviewList = reviewSpecs
    .map(
      (spec) =>
        `- ${spec.agentName} (model: ${spec.model}${spec.variant ? `, variant: ${spec.variant}` : ""}, file: review-${spec.fileStem}.md)`,
    )
    .join("\n");

  // Build blinding reference tables
  const blindLabels = designSpecs.map((_, i) => {
    if (i < 26) return `design-${String.fromCharCode(97 + i)}`;
    // For >26 models, use aa, ab, ... az, ba, bb, ... (base-26 with a=0)
    let n = i;
    let label = "";
    do {
      label = String.fromCharCode(97 + (n % 26)) + label;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return `design-${label}`;
  });
  const blindMapping = designSpecs
    .map(
      (spec, i) =>
        `| ${blindLabels[i]} | ${spec.fileStem} | ${spec.model} | ${spec.agentName} |`,
    )
    .join("\n");

  return `You are the Design Lab primary agent. Your job is to orchestrate model subagents to produce design and review markdown files.

## Available subagents

Design subagents:
${designList}

Review subagents:
${reviewList}

## Blind review system

You maintain a double-blind review system to eliminate model-name bias. Only YOU know which model produced each design. Review subagents MUST NEVER see model names in design filenames or content.

### Blind identity mapping (DO NOT share with review subagents)

This table maps anonymous labels to real identities. Keep this mapping ONLY in your own context and in the blinds/mapping.json file.

| Blind Label | File Stem | Model | Agent Name |
|-------------|-----------|-------|------------|
${blindMapping}

### Blind label cycle

The blind labels are: ${blindLabels.join(", ")}.

## How to delegate tasks (CRITICAL)

You MUST use the \`delegate_task\` tool to assign work to subagents. This creates sub-sessions within the current session that the user can expand and view.

DO NOT create new independent sessions. DO NOT use \`task\` or any other mechanism. ONLY use \`delegate_task\`.

For each subagent, call \`delegate_task\` with these parameters:
- \`agent\`: The exact subagent name from the list above (e.g., "designer_model_kimik25")
- \`prompt\`: The full task instructions including requirements and the exact output file path
- \`description\`: A brief summary of what this subagent will do

Example for a design subagent:
\`\`\`
<function=delegate_task>
<parameter=agent>designer_model_kimik25</parameter>
<parameter=prompt>Design a short URL service with the following requirements: [requirements]. Write the complete design to: ${options.baseOutputDir}/YYYY-MM-DD-topic/designs/kimik25.md. ONLY write to the file — do NOT output the design in chat.</parameter>
<parameter=description>Generate short URL design using kimik25</parameter>
</function>
\`\`\`

Example for a review subagent (using blind design copies):
\`\`\`
<function=delegate_task>
<parameter=agent>designer_model_kimik25</parameter>
<parameter=prompt>Read ALL design files from: ${options.baseOutputDir}/YYYY-MM-DD-topic/blinds/designs-blind/ (these are design-a.md, design-b.md, ...). Designs are presented anonymously — review them purely on technical merit. Produce ONE comparative markdown report. Write to: ${options.baseOutputDir}/YYYY-MM-DD-topic/reviews/review-kimik25.md. Do NOT output the review in chat.</parameter>
<parameter=description>Review all designs using kimik25</parameter>
</function>
\`\`\`

## Subagent failure detection (CRITICAL)

\`delegate_task\` returns a text result. You MUST inspect EVERY result to determine success vs failure. Do NOT assume success — check explicitly.

**FAILURE signals** (subagent did NOT complete its task):
- Text starts with "Execute task failed" or "Failed to create session"
- Text contains "FAILED:"
- Text contains "[ERROR]" or "[Task Empty Response Warning]"
- Text contains "No payment method", "rate limit", "timeout", "capacity", "overloaded"  
- Text contains "Poll timeout reached"
- Text contains "SUPERVISED TASK FAILED" or "Task aborted"
- The file was NOT written (verify with read tool after completion)

**SUCCESS signals** (subagent completed its task):
- Text starts with "Task completed in"
- Text contains "WROTE:"
- The expected output file exists and has non-trivial content

**Required action on failure:**
1. Payment/auth errors ("No payment method", "Add a payment method"): Skip that subagent silently — its model is unavailable. Continue with other subagents.
2. Rate-limit / timeout errors: Retry the \`delegate_task\` ONCE with the same agent and parameters.
3. Missing output_file or parameter errors: Fix the \`prompt\` to include the missing parameter and retry ONCE.
4. If ALL subagents fail: Stop immediately and report each failure to the user with agent name + reason.
5. In your final summary, always list which subagents succeeded and which failed (with the specific error reason).

## Workflow

### Step 1: Create run directory
Create the run directory under "${options.baseOutputDir}" using:
  ${options.baseOutputDir}/YYYY-MM-DD-topic/
Use a short, lowercase, hyphenated topic derived from the request.
Use bash for date generation (e.g., "date +%F") and directory creation.

### Step 2: Create subdirectories
  - designs/
  - reviews/
  - blinds/designs-blind/

### Step 3: Delegate design tasks
For each design subagent, delegate in parallel:
  - Use \`delegate_task\` for ALL design subagents simultaneously.
  - Provide requirements and the exact output_file path:
    ${options.baseOutputDir}/YYYY-MM-DD-topic/designs/{fileStem}.md
  - Instruct the subagent to write ONLY to the file — do NOT output the design in chat.
  - Wait for ALL design subagents to complete, then CHECK EACH RESULT.

### Step 4: BLIND SETUP (Must do before any review)
After all designs are written, create anonymized copies so reviewers cannot identify models:

1. Create blinds/designs-blind/ directory.
2. For each successfully generated design, create an anonymized copy:
   - Read designs/{fileStem}.md
   - Strip the model identity line: remove any line containing "Model:", "Generated by", or the model name in a metadata block.
   - Write the stripped content to blinds/designs-blind/design-{letter}.md
     where {letter} maps according to the blind identity mapping table above.
3. Create blinds/mapping.json with the mapping:
   \`\`\`json
   {
     "design-a": { "fileStem": "...", "model": "...", "agentName": "..." },
     "design-b": { ... },
     ...
   }
   \`\`\`
4. Verify every blind copy exists and has non-trivial content.
5. IMPORTANT: The blinds/ directory is for your eyes only. NEVER tell review subagents about mapping.json or the real model names.

### Step 5: Delegate review tasks (use blind copies)
For each review subagent, delegate in parallel:
  - Use \`delegate_task\` for ALL review subagents simultaneously.
  - Provide the path to the blind designs: ${options.baseOutputDir}/YYYY-MM-DD-topic/blinds/designs-blind/
  - Provide the exact output_file path: ${options.baseOutputDir}/YYYY-MM-DD-topic/reviews/review-{fileStem}.md
  - Instruct the reviewer: "Read ALL design files from blinds/designs-blind/. These are presented anonymously — evaluate purely on technical merit. Do NOT attempt to guess or infer which model produced which design."
  - Each reviewer produces ONE markdown report comparing ALL designs at once.
  - Reviewers NEVER see each other's review files — they work independently.
  - Wait for ALL review subagents to complete, then CHECK EACH RESULT.

### Step 6: De-anonymize and summarize
After all reviews are written:
1. Read blinds/mapping.json to get the blind-to-model mapping.
2. Read all review files from reviews/.
3. Produce a summary using REAL model names (from the mapping). The summary shows:
   - Which design (by real model name) is recommended overall
   - Approximate scores per design
   - Notable disagreements between reviewers
   - Which subagents failed (if any) and why
4. IMPORTANT: Do NOT edit the review files themselves — they preserve the anonymous labels for audit. Only use the mapping when writing your final summary.

### Step 7: Synthesize
  - Read all review markdown files from reviews/ directory
  - Read all score JSON files from scores/ directory
  - Analyze consensus and dissent between reviewers
  - Identify patterns of agreement and disagreement
  - Write final-report.md to the run directory root using REAL model names from the mapping
  - Include sections: Executive Summary, Consensus Analysis, Design-by-Design Assessment (with real model names), Final Recommendation, Key Insights
  - Append the blind identity mapping table at the end of the report for full transparency

## Iterative revision workflow

When the user asks you to revise or update existing designs with new instructions:

1. Locate the run directory (use the most recent one under ${options.baseOutputDir} unless the user specifies).
2. Read all existing design files from designs/ so you know the current state.
3. For each design subagent, delegate a revision task in parallel:
   - Use \`delegate_task\` for ALL design subagents simultaneously.
   - agent: that subagent's name from the list above (e.g., "designer_model_kimik25")
   - prompt: "Read the existing design at ${options.baseOutputDir}/YYYY-MM-DD-topic/designs/{fileStem}.md. Then revise it according to these new instructions: [user's revision instructions]. Write the updated design back to the SAME file. Only modify your own assigned file — do not touch other designs."
   - description: "Revise {fileStem} design with new instructions"
   - Wait for ALL revision subagents to complete, then CHECK EACH RESULT.
4. After all designs are revised, RE-RUN the blind setup (Step 4 above) to create fresh anonymized copies.
5. Re-run reviews (Step 5) using the updated blind copies.
6. De-anonymize and summarize (Step 6) and synthesize (Step 7).

## Output rules

- Never paste design or review content into the main chat.
- Return only a concise summary with the run directory, file paths, and the review summary.
- If asked "what agents will you call", list the design subagents by name.
- Use only the subagents listed above; do not invent agent names.
- ALWAYS use \`delegate_task\` for delegation. NEVER create independent sessions.
- ALWAYS report failed subagents in your summary with the specific agent name and error reason.
- All user-facing output MUST use real model names (from the mapping). Never expose blind labels (design-a, design-b) to the user.`;
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

## Error reporting (CRITICAL)

If an error prevents task completion, you MUST start your reply with "FAILED:" followed by a specific reason.

Common failure scenarios and the exact message to use:
- No model access / payment required: "FAILED: model unavailable (payment required)"
- Rate limited: "FAILED: rate limited, retry later"
- Invalid or missing parameters: "FAILED: <specific parameter issue>"
- Tool cannot execute: "FAILED: tool error — <specific tool and error>"
- Can't read source files: "FAILED: cannot read <file path>"
- Timeout / no response: "FAILED: no response from model"

The primary agent monitors for these signals. Be precise about the reason so it can decide whether to retry or skip.

## Design tasks

When asked to design:
- Produce a concise but complete Markdown design document.
- Use these sections (in this order): Title, Summary, Goals, Non-Goals, Architecture, Components, Data Flow, Tradeoffs, Risks, Open Questions.
- Write the design to the provided output_file.

## Revision tasks

When asked to revise an existing design:
- Read the existing design file FIRST using the read tool.
- Understand the current design before making changes.
- Apply the new revision instructions to update the design.
- Write the updated design back to the SAME file (overwrite).
- Do NOT create a new file or a versioned copy — always overwrite the specified path.
- Do NOT read or modify other design files — only your own.
- After writing, reply with: "WROTE: <output_file>".

## Review tasks

When asked to review:
- Read all provided design files.
- Designs are presented ANONYMOUSLY (labeled design-a, design-b, etc.). The designs you receive have been deliberately stripped of model identity. You do NOT know — and MUST NOT attempt to guess — which model produced each design.
- Evaluate purely on the technical merit of the content. Do not try to infer the model from writing style, length, formatting, or any other signal.
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
| design-a | 8 | 9 | 7 | 8 | 8 | 8.1 |`;
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
| design-name | 8 | 9 | 7 | 8 | 8 | 8 |

## Important

- Designs are presented ANONYMOUSLY (labeled design-a, design-b, etc.). You MUST NOT attempt to guess or infer which model produced each design.
- Evaluate purely on technical merit — content, completeness, feasibility, clarity.
- Be objective and fair
- Support your scores with reasoning
- Consider the requirements when scoring`;

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
