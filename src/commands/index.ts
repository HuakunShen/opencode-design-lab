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

/**
 * Build the `/repowiki` command configuration.
 *
 * Usage: /design-lab:repowiki [language]
 * Generates comprehensive repository documentation in a structured wiki format.
 * Creates hierarchical markdown documentation with architecture diagrams,
 * source citations, and relationship metadata in .repowiki/ directory.
 */
export function buildRepowikiCommand(_baseDir: string): CommandConfig {
  return {
    description:
      "Generate comprehensive repository wiki documentation with architecture diagrams and source citations",
    agent: "designer",
    template: `Generate comprehensive repository documentation (repowiki) for this codebase.

## User Input
$input

## Instructions

1. Check for existing repowiki at .repowiki/en/meta/repowiki-metadata.json
   - If exists, read it to get the last_commit and perform an INCREMENTAL UPDATE
   - If not exists, perform a FULL GENERATION

2. **For FULL GENERATION**:
   - Create .repowiki/en/content/ directory structure
   - Generate the following standard topic categories:
     - System Overview (root page)
     - Getting Started Guide
     - Development Guidelines
     - Architecture/Architecture Overview
     - Technology Stack & Architecture
     - Backend Services overview
     - Frontend Application
     - Infrastructure overview
     - API Reference
   - Each page must include:
     - Cite block with referenced files
     - Table of Contents
     - Source citations after each section
     - Mermaid diagrams where appropriate
   - Create .repowiki/en/meta/repowiki-metadata.json with:
     - version: current date (YYYY-MM-DD)
     - last_commit: current HEAD SHA
     - wiki_items: all pages with IDs and paths
     - knowledge_relations: parent-child relationships

3. **For INCREMENTAL UPDATE**:
   - Get current HEAD commit: git rev-parse HEAD
   - Compare with last_commit from metadata
   - List new commits: git log --oneline <last_commit>..HEAD
   - Analyze changes: git diff --stat <last_commit>..HEAD
   - Identify affected wiki pages based on changed file paths
   - Update only affected pages with new content
   - Update metadata with new last_commit and version

4. **Output Structure**:
   \`\`\`
   .repowiki/
   └── en/
       ├── content/
       │   ├── System Overview.md
       │   ├── Getting Started Guide.md
       │   ├── Architecture/
       │   │   ├── Architecture.md
       │   │   └── [subtopics]/
       │   ├── Backend Services/
       │   │   └── Backend Services.md
       │   └── ...
       └── meta/
           └── repowiki-metadata.json
   \`\`\`

5. **Content Standards**:
   - Use <cite> blocks at top of each file listing referenced files
   - Include Table of Contents on every page
   - Add **Section sources** after each major section
   - Add **Diagram sources** after each Mermaid diagram
   - File citations use format: [filename](file://path#L10-L50)
   - Tone: Technical, professional, comprehensive
   - Audience: Developers new to the codebase

6. Report the status:
   - Whether it was a full generation or incremental update
   - List of created/updated files
   - Summary of what was documented`,
  };
}
