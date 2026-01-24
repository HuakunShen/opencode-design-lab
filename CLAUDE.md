# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenCode Design Lab is an OpenCode plugin that orchestrates multiple AI models to generate independent design proposals and cross-review them. It uses a **file-first, agent-orchestrated workflow** where a primary agent delegates tasks to model-specific subagents that write outputs directly to Markdown files.

## Build and Development Commands

```bash
# Build plugin (outputs to .opencode/plugins/design-lab.js)
bun run build

# Development with watch mode
bun run dev

# Run all tests
bun run test

# Run specific test file
bun run test path/to/test.test.ts

# Run tests matching pattern
bun run test -- -g "pattern"

# Type checking
bun run typecheck

# Format code
bun run format

# Export Zod schemas to JSON
bun run export-schemas
```

## Architecture

### Agent Orchestration Model

The plugin uses a **hierarchical agent system**:

1. **Primary Agent (`designer`)**: Orchestrates the entire workflow, creates run directories, and delegates tasks sequentially to subagents
2. **Designer Subagents (`designer_model_*`)**: One per configured model. Each writes design proposals to `designs/{model}.md`
3. **Review Subagents**: Same set of models. Each writes cross-reviews to `reviews/review-{model}.md`

**Critical constraint**: Subagents run **sequentially** (one at a time), never in parallel. This ensures stability and deterministic results.

### Dynamic Model Registration

All agents are created dynamically from `design_models` and `review_models` in the config. Agent names follow the pattern:
- Primary: `designer`
- Subagents: `designer_model_{normalized_model_name}`

Model names are normalized to file stems by:
1. Getting short name via `getModelShortName()`
2. Lowercasing and replacing separators with hyphens
3. Removing invalid characters
4. Example: `zhipuai-coding-plan/glm-4.6` → `glm-4-6`

### File-First Output Pattern

**Key principle**: Designs and reviews are written to disk, NOT to chat. This prevents context bloat and enables large-scale cross-model comparisons.

The primary agent:
- Creates timestamped run directories: `.design-lab/YYYY-MM-DD-topic/`
- Provides exact `output_file` paths to each subagent
- Reads completed files and summarizes results
- Never pastes full content into chat

Subagents:
- Write to the exact `output_file` path provided
- Return only `"WROTE: <path>"` or `"FAILED: <reason>"`
- Never output design/review content in chat

### Directory Structure

```
.design-lab/
└── YYYY-MM-DD-topic/
    ├── designs/
    │   ├── model-a.md
    │   └── model-b.md
    └── reviews/
        ├── review-model-a.md
        └── review-model-b.md
```

## Configuration System

Config loading follows a **user → project override** pattern:

1. Load `~/.config/opencode/design-lab.json` (user-level)
2. Load `.opencode/design-lab.json` (project-level)
3. Project config overrides user config
4. Validation via Zod schema in `src/config/schema.ts`

All schemas use **Zod v4** with `.toJSONSchema()` for export.

## Code Organization

```
src/
├── design-lab.ts          # Plugin entry: loads config, registers agents
├── agents/
│   └── index.ts           # Agent factory: prompts, naming, tool permissions
├── config/
│   ├── schema.ts          # Zod schemas for config + artifacts
│   └── loader.ts          # Config loading with JSONC support
├── tools/                 # Tool implementations (currently unused)
└── utils/
    ├── session-helpers.ts # OpenCode session lifecycle helpers
    ├── logger.ts          # Pino logger (logs to design-lab.log)
    └── lab-helpers.ts     # Run directory management
```

## Key Implementation Patterns

### Session Management

Use utilities from `src/utils/session-helpers.ts`:

```typescript
// Create session
const session = await createAgentSession(client, parentID, title, cwd, agentKey);

// Send prompt
const sendResult = await sendPrompt(client, sessionID, userPrompt);

// Poll for completion (with timeout)
const response = await pollForCompletion(client, sessionID, maxPollTimeMs);
```

Sessions are managed by OpenCode. The plugin delegates via `delegate_task` tool, which handles session lifecycle automatically.

### Agent Tool Permissions

Primary agent (`designer`):
- `read: true` (can read completed files)
- `bash: true` (can create directories, run `date +%F`)
- `delegate_task: true` (delegates to subagents)
- `write/edit/task: false`

Subagents (`designer_model_*`):
- `read: true` (can read design files for review)
- `write: true` (writes to output files)
- `bash/edit/task/delegate_task: false`

### Error Handling

Subagents use a contract-based error protocol:
- Success: `"WROTE: /path/to/file.md"`
- Failure: `"FAILED: missing output_file"` or `"FAILED: <reason>"`

The primary agent surfaces failures in its final summary.

### Logging

All logging uses Pino logger from `src/utils/logger.ts`:
- Logs written to global config directory: `~/.config/opencode/design-lab.log` (macOS/Linux) or `%APPDATA%\opencode\design-lab.log` (Windows)
- Use structured logging: `logger.info({ model, sessionID }, "message")`
- Log levels: `trace`, `debug`, `info`, `warn`, `error`
- Set `LOG_LEVEL` environment variable to change log level (default: `info`)

## Scoring Standard

Reviews use a **fixed weighted scoring rubric** (0-10 scale):

| Criterion      | Weight |
|----------------|--------|
| Clarity        | 20%    |
| Feasibility    | 25%    |
| Scalability    | 20%    |
| Maintainability| 20%    |
| Completeness   | 15%    |

Weighted Total = Σ(score × weight) / 100

All reviewers must include a score table at the bottom of their review markdown.

## Build System

- **Bundler**: `tsdown` (config in `tsdown.config.ts`)
- **Output**: `.opencode/plugins/design-lab.js` (single bundled file)
- **No externals**: Bundles `pino` and `zod` (via `noExternal` config)
- **No dts**: Type definitions not generated (plugin loaded at runtime)

## Important Constraints

1. **Sequential execution only**: Never run subagents in parallel. The primary agent prompt explicitly enforces this.
2. **Mandatory output_file**: Subagents must receive exact file paths. If missing, they must fail.
3. **Model name normalization**: Always use `getModelShortName()` + normalization for consistency.
4. **No chat bloat**: Never paste full designs/reviews into chat context.
5. **Config validation**: All config must pass Zod schema validation or plugin disables itself.

## Testing

Currently minimal test coverage. When adding tests:
- Use vitest framework
- Test files: `*.test.ts` alongside source
- Mock external dependencies (OpenCode client, file system)
- Focus on: config loading, model name normalization, agent prompt generation

## Common Gotchas

1. **Agent naming**: Subagent names use normalized model slugs without hyphens (e.g., `designer_model_glm46`)
2. **File stems**: File names use hyphenated slugs (e.g., `glm-4-6.md`)
3. **JSONC support**: Config files can use comments via `jsonc` parser
4. **Plugin reload**: After rebuilding, restart OpenCode to pick up changes
5. **Session timeouts**: Default 180s for send, 10min for poll
