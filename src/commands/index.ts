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
3. Delegate design generation to each subagent sequentially:
${designList}
4. Each subagent must write its design to the specified output_file path.
5. After all designs are written, report the run directory and list of generated files.

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
    .map(
      (spec) => `- ${spec.agentName} → reviews/review-${spec.fileStem}.md`,
    )
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
4. Delegate review tasks to each review subagent sequentially:
${reviewList}
5. Each reviewer must read ALL designs and produce ONE comparative markdown
   report written to its output_file path.
6. After all reviews are written, read them and produce a summary:
   - Which design is recommended overall
   - Approximate scores per design
   - Notable disagreements between reviewers`,
  };
}
