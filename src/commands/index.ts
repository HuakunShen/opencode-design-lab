type ModelSpec = {
  model: string;
  agentName: string;
  fileStem: string;
};

type CommandOptions = {
  baseOutputDir: string;
  designModels: ModelSpec[];
  reviewModels: ModelSpec[];
};

type CommandConfig = {
  template: string;
  description?: string;
  agent?: string;
  model?: string;
  subtask?: boolean;
};

/**
 * Build the `/init` command configuration.
 *
 * Usage: /design-lab:init
 * Initializes a new design-lab.json config file in the project's .opencode directory
 * using the bundled template as a starting point.
 */
export function buildInitCommand(baseDir: string): CommandConfig {
  return {
    description:
      "Initialize design-lab.json config in .opencode/ (creates from template)",
    template: `Initialize the Design Lab configuration file.

Create a new design-lab.json file at: ${baseDir}/.opencode/design-lab.json

## Instructions

1. Check if ${baseDir}/.opencode/design-lab.json already exists
2. If it exists, report that the config already exists and show its path
3. If it doesn't exist:
   - Create the .opencode/ directory if it doesn't exist
   - Copy the bundled template to ${baseDir}/.opencode/design-lab.json
   - Report success and show the path to the created file

Here is a template
{
  "design_models": [
    "opencode/kimi-k2.5-free",
    "zhipuai-coding-plan/glm-4.7",
    "openai/gpt-5.2-codex",
    "google/antigravity-gemini-3-pro",
    "anthropic/claude-opus-4-5"
  ],
  "review_models": [
    "opencode/kimi-k2.5-free",
    "zhipuai-coding-plan/glm-4.7",
    "openai/gpt-5.2-codex",
    "google/antigravity-gemini-3-pro",
    "anthropic/claude-opus-4-5"
  ],
  "base_output_dir": ".design-lab",
  "design_agent_temperature": 0.7,
  "review_agent_temperature": 0.1
}
`,
  };
}

/**
 * Build the `/design` command configuration.
 *
 * Usage: /design <topic>
 * Triggers the full design generation workflow — creates a run directory,
 * delegates to all model subagents, and produces design files.
 */
export function buildDesignCommand(options: CommandOptions): CommandConfig {
  const designList = options.designModels
    .map((spec) => `- ${spec.agentName} → designs/${spec.fileStem}.md`)
    .join("\n");

  return {
    description:
      "Generate design proposals from all configured models for a given topic",
    agent: "designer",
    template: `Generate designs for the following topic:

$input

## Instructions

1. Create a run directory: ${options.baseOutputDir}/YYYY-MM-DD-<topic-slug>/
   Use today's date and a short hyphenated slug derived from the topic.
2. Create subdirectory: designs/
3. Delegate design generation to each subagent in parallel:
${designList}
4. Fire all delegate_task calls simultaneously - do NOT wait for each to complete before starting the next.
5. Each subagent must write its design to the specified output_file path.
6. Wait for ALL subagents to complete, then report the run directory and list of generated files.

Do NOT run reviews. Only generate designs.`,
  };
}

/**
 * Build the `/review` command configuration.
 *
 * Usage: /review [run-directory]
 * Triggers cross-review of existing designs. If no directory is given,
 * finds the most recent run under the base output directory.
 */
export function buildReviewCommand(options: CommandOptions): CommandConfig {
   const reviewList = options.reviewModels
     .map((spec) => `- ${spec.agentName} → reviews/review-${spec.fileStem}.md`)
     .join("\n");
 
   return {
     description:
       "Run cross-reviews on existing designs using all configured review models",
     agent: "designer",
     template: `Run cross-reviews on existing designs.
 
 $input
 
 ## Instructions
 
 1. If a run directory is specified above, use it. Otherwise, find the most
    recent run directory under ${options.baseOutputDir}/ (sort by date prefix).
 2. Read all design files from the designs/ subdirectory.
 3. Create subdirectory: reviews/ (if it doesn't exist).
 4. Delegate review tasks to each review subagent in parallel:
 ${reviewList}
 5. Fire all delegate_task calls simultaneously - do NOT wait for each to complete before starting the next.
 6. Each reviewer must read ALL designs and produce ONE comparative markdown
    report written to its output_file path.
 7. Wait for ALL review subagents to complete, then read the reviews and produce a summary:
    - Which design is recommended overall
    - Approximate scores per design
    - Notable disagreements between reviewers`,
   };
}

/**
 * Build the `/synthesize` command configuration.
 *
 * Usage: /synthesize [run-directory]
 * Synthesizes reviews and scores into a final qualitative report.
 * If no directory is given, finds the most recent run under the base output directory.
 */
export function buildSynthesizeCommand(options: CommandOptions): CommandConfig {
  return {
    description: "Synthesize reviews into final qualitative report",
    agent: "designer",
    template: `Synthesize reviews and scores into a final qualitative report.

$input

## Instructions

1. If a run directory is specified above, use it. Otherwise, find the most
   recent run directory under ${options.baseOutputDir}/ (sort by date prefix).
2. Read all review files from the reviews/ subdirectory.
3. Read all score files from the scores/ subdirectory.
4. Perform qualitative synthesis:
   - Analyze patterns across all reviews
   - Identify consensus and disagreements
   - Synthesize scores with qualitative insights
   - Determine overall recommendations
5. Write the final synthesis report to final-report.md with the following sections:
   - Executive Summary
   - Design Comparison Matrix
   - Qualitative Analysis
   - Consensus Findings
   - Recommendations
   - Appendix (detailed scores and review excerpts)`,
  };
}
