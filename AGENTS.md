## Hints

- Use context 7 or zread MCP server to get docs or context info for GitHub repos or other projects.
- The project exports to `.opencode/plugins/design-lab.js` via tsdown.config.ts
- This is a TypeScript/Bun project using OpenCode's plugin architecture

## Build/Lint/Test Commands

```bash
# Build the plugin (outputs to .opencode/plugins/design-lab.js)
bun run build

# Development with watch mode
bun run dev

# Run tests (vitest)
bun run test

# Run a single test file
bun run test path/to/test.test.ts

# Run tests matching a pattern
bun run test -- -g "test name pattern"

# Format code with prettier
bun run format

# Type checking
bun run typecheck

# Export Zod schemas to JSON
bun run export-schemas
```

## Code Style Guidelines

### Imports

- Group imports: external dependencies first, then internal modules, then stdlib
- Use named imports where possible (avoid `import * as` unless necessary)
- Keep imports sorted alphabetically within groups

Example:
```typescript
import type { Plugin } from "@opencode-ai/plugin";
import { loadPluginConfig } from "./config";
import { createAgentSession, sendPrompt } from "../utils/session-helpers";
import * as fs from "fs";
import * as path from "path";
```

### Formatting

- Use 2-space indentation
- No trailing whitespace
- Max line length: 100 characters (soft limit)
- Run `bun run format` before committing

### Types

- Always use TypeScript - no `any` types unless absolutely necessary
- Use `type` for type aliases, `interface` for object shapes with potential extension
- Import types with `import type { ... }` for better tree-shaking
- Use Zod schemas for runtime validation alongside TypeScript types

### Naming Conventions

- **Functions/Variables**: camelCase (`generateDesign`, `designAgent`)
- **Constants**: UPPER_SNAKE_CASE (`DESIGN_AGENT_SYSTEM_PROMPT`, `POLL_INTERVAL_MS`)
- **Types/Interfaces**: PascalCase (`DesignLabConfig`, `DesignArtifact`)
- **Files**: kebab-case (`generate-designs.ts`, `session-helpers.ts`)
- **Private functions**: Prefix with underscore if needed to indicate internal use

### Error Handling

- Always catch errors and provide context
- Use descriptive error messages that include the what, where, and why
- Log errors with structured data using the pino logger
- Throw `Error` objects (not strings) with clear messages

Example:
```typescript
try {
  const design = await generateDesign(...);
} catch (err) {
  const errorMsg = err instanceof Error ? err.message : String(err);
  logger.error({ model, error: errorMsg }, "Design generation failed");
  throw new Error(`Failed to generate design for ${model}: ${errorMsg}`);
}
```

### Logging

- Use the pino logger from `src/utils/logger.ts`
- Use appropriate log levels: `trace`, `debug`, `info`, `warn`, `error`
- Include structured context data in log calls
- Logs are written to `design-lab.log` in the current working directory

Example:
```typescript
logger.info({ model, sessionID }, "Starting design generation");
logger.error({ error: createResult.error }, "Failed to create session");
```

### File Structure

```
src/
├── design-lab.ts           # Plugin entry point
├── agents/                 # Agent configuration and prompts
│   └── index.ts
├── config/                 # Configuration loading and schemas
│   ├── schema.ts           # Zod schemas
│   ├── loader.ts           # Config loading logic
│   └── index.ts            # Re-exports
├── tools/                  # Tool implementations
│   ├── generate-designs.ts
│   ├── review-designs.ts
│   ├── aggregate-scores.ts
│   └── index.ts
└── utils/                  # Shared utilities
    ├── session-helpers.ts  # OpenCode session utilities
    ├── logger.ts           # Logging configuration
    └── schema-export.ts    # Schema generator
```

### Testing

- Tests use vitest framework
- Test files should be named `*.test.ts` alongside the source file
- Use descriptive test names that explain what is being tested
- Mock external dependencies (file system, network, OpenCode client)
- Currently no tests exist in the main project - add them for new features

### Architecture Patterns

- **Tools**: Use `tool()` factory from `@opencode-ai/plugin` with schema validation
- **Agents**: Create agents via `createAgentSession()` + `sendPrompt()` + `pollForCompletion()`
- **Config**: Load using `loadPluginConfig()`, merge user and project configs
- **Schemas**: Define in Zod in `config/schema.ts`, export with `z.toJSONSchema()` (Zod v4)
- **Session Management**: Use helpers in `utils/session-helpers.ts` for OpenCode session lifecycle
- **Sequential Execution**: Run agents sequentially (one after another), not in parallel

### Comments and Documentation

- Use JSDoc comments for all exported functions, interfaces, and types
- Keep comments concise and focused on "why" not "what"
- Document configuration options with @default annotations
- Include usage examples in README.md for new features

### Zod Schema Guidelines

- Define all schemas in `src/config/schema.ts`
- Use `z.object()` for complex types
- Provide default values with `.default()`
- Add constraints like `.min()`, `.max()` for validation
- Export both schema and inferred type (`export const Schema = z.object(...)` and `export type Type = z.infer<typeof Schema>`)

### OpenCode Integration

- Plugin exports must be in `.opencode/plugins/` directory
- Build output filename: `design-lab.js`
- Session creation requires a parent session ID, title, and directory
- Always disable write/edit/bash tools for subagents (except when explicitly needed)
- Use timeout patterns to prevent hanging sessions (180s for send, 10min for poll)

### Constants

- Define magic numbers as constants at module top
- Group related constants together
- Use descriptive names that explain the value's purpose

Example:
```typescript
const POLL_INTERVAL_MS = 500;
const MAX_POLL_TIME_MS = 10 * 60 * 1000; // 10 minutes
const STABILITY_REQUIRED = 3;
```
