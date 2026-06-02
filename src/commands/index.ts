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
  "models": [
    { "model": "openai/gpt-5.2-codex", "variant": "xhigh" },
    { "model": "opencode/kimi-k2.5-free", "variant": "max" },
    { "model": "zhipuai-coding-plan/glm-4.7", "variant": "max" },
    { "model": "google/antigravity-gemini-3-pro", "variant": "max" },
    { "model": "local/model-without-variant", "variant": null }
  ],
  "default_variant": "max",
  "base_output_dir": ".design-lab"
}

Each model can be a string or an object with a variant. Variants are passed through
as configured, so provider-specific values like "xhigh" are supported. Use
"variant": null for models that should be invoked without a variant.
`,
  };
}

/**
 * Build the `/ask` command configuration.
 *
 * Usage: /design-lab:ask <prompt>
 * Routes the prompt to the unified Design Lab coordinator.
 */
export function buildAskCommand(directory: string): CommandConfig {
  return {
    description:
      "Run a Design Lab single-agent workflow for multi-model asks, plans, revisions, or reviews",
    agent: "design_lab",
    template: `Run the Design Lab single-agent workflow for this prompt:

$input

## Config Loading (MUST DO FIRST)

1. Read the Design Lab config from these paths in order:
   - ${directory}/.opencode/design-lab.json
   - ${directory}/.opencode/design-lab.jsonc
   - user-level ~/.config/opencode/design-lab.json
   - user-level ~/.config/opencode/design-lab.jsonc
2. If no valid config is found, STOP and report:
    "Design Lab config not found or invalid. Run /design-lab:init to create one."
3. Extract \`models\`, \`default_variant\`, and \`base_output_dir\`.

## Instructions

Use your system prompt's single-agent workflow. It supports general asks, plan generation, plan revision, anonymous plan review, and current-code review. Save full model outputs to files and return a concise synthesis in chat.`,
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
    agent: "design_lab",
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
