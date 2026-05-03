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

Here is a template (with $schema for IDE validation):
{
  "$schema": "https://raw.githubusercontent.com/HuakunShen/opencode-design-lab/main/schemas/design-lab-config.schema.json",
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

Each model can also be an object to set a variant:
{ "model": "opencode/kimi-k2.6", "variant": "max" }
Valid variants: "low", "medium", "high", "max" (default: "max").
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
export function buildDesignCommand(directory: string): CommandConfig {
  return {
    description:
      "Generate design proposals from all configured models for a given topic",
    agent: "designer",
    template: `Generate designs for the following topic:

$input

## Config Loading (MUST DO FIRST)

1. Read the Design Lab config from these paths in order:
   - ${directory}/.opencode/design-lab.json
   - ${directory}/.opencode/design-lab.jsonc
   - ~/.config/opencode/design-lab.json
   - ~/.config/opencode/design-lab.jsonc
2. If no valid config is found at any of these paths, STOP and report:
   "Design Lab config not found or invalid. Run /design-lab:init to create one."
3. Extract \`base_output_dir\` and \`design_models\` from the config.

## Instructions

1. Create a run directory: <base_output_dir>/YYYY-MM-DD-<topic-slug>/
   Use today's date and a short hyphenated slug derived from the topic.
2. Create subdirectory: designs/
3. For each model in \`design_models\`, derive:
   - agentName: "designer_model_" + model name (replace non-alphanumeric characters with underscores)
   - fileStem: model name (replace non-alphanumeric characters with hyphens)
   - outputFile: <runDir>/designs/<fileStem>.md
4. Use delegate_task to delegate to ALL design subagents simultaneously.
   Do NOT wait for each to complete before starting the next — fire all at once.
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
 *
 * @param directory - Project directory for config resolution at execution time
 */
export function buildReviewCommand(directory: string): CommandConfig {
  return {
    description:
      "Run cross-reviews on existing designs using all configured review models",
    agent: "designer",
    template: `Run cross-reviews on existing designs.

$input

## Config Loading (MUST DO FIRST)

1. Read the Design Lab config from these paths in order:
   - ${directory}/.opencode/design-lab.json
   - ${directory}/.opencode/design-lab.jsonc
   - ~/.config/opencode/design-lab.json
   - ~/.config/opencode/design-lab.jsonc
2. If no valid config is found, STOP and report: "Design Lab config not found or invalid. Run /design-lab:init to create one."
3. Extract \`base_output_dir\` from the config.
4. Use \`review_models\` if specified, otherwise fallback to \`design_models\`.

## Instructions

1. If a run directory is specified above, use it. Otherwise, find the most
   recent run directory under <base_output_dir from config>/ (sort by date prefix).
2. Read all design files from the designs/ subdirectory.
3. Create subdirectory: reviews/ (if it doesn't exist).
4. For each model in review_models (or design_models), derive:
   - agentName: "designer_model_" + model name (replace non-alphanumeric with underscores)
   - fileStem: model name (replace non-alphanumeric with hyphens)
   - outputFile: <runDir>/reviews/review-<fileStem>.md
5. Use delegate_task to delegate to ALL review subagents simultaneously.
   Do NOT wait for each to complete before starting the next.
6. Each reviewer must read ALL designs and produce ONE comparative markdown report.
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
export function buildSynthesizeCommand(directory: string): CommandConfig {
  return {
    description: "Synthesize reviews into final qualitative report",
    agent: "designer",
    template: `Synthesize reviews and scores into a final qualitative report.

$input

## Config Loading (MUST DO FIRST)

1. Read the Design Lab config from these paths in order:
   - ${directory}/.opencode/design-lab.json
   - ${directory}/.opencode/design-lab.jsonc
   - ~/.config/opencode/design-lab.json
   - ~/.config/opencode/design-lab.jsonc
2. If no valid config is found, STOP and report: "Design Lab config not found or invalid. Run /design-lab:init to create one."
3. Extract \`base_output_dir\` from the config.

## Instructions

1. If a run directory is specified above, use it. Otherwise, find the most
   recent run directory under <base_output_dir from config>/ (sort by date prefix).
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

/**
 * Build the `/journal` command configuration.
 *
 * Usage: /design-lab:journal
 * Reviews recent git changes and conversation context, then documents
 * decisions, tradeoffs, and rationale in a dated journal file.
 */
export function buildJournalCommand(): CommandConfig {
  return {
    description:
      "Document recent changes, decisions, and tradeoffs in a dated journal file",
    template: `Review recent changes and decisions, and document them in a dated journal file.

## Instructions

1. Get the current datetime in YYYY-MM-DD-HHMM format.
2. Run git diff HEAD~1 (or appropriate range) to understand recent changes.
3. Review the recent conversation history for context on "why" decisions were made.
4. Ensure the .journal directory exists in the project root.
5. Write a dated journal entry at .journal/YYYY-MM-DD-HHMM.md with this structure:
   - **Timestamp**: The time of the entry.
   - **Core Decision/Topic**: The primary focus.
   - **Options Considered**: Alternatives that were discussed.
   - **Final Decision & Rationale**: Why the specific path was chosen.
   - **Key Changes Made**: Summary of modified files/logic.
   - **Future Considerations**: Any remaining debt or follow-up items.
6. Return a confirmation message with the file path.`,
  };
}
