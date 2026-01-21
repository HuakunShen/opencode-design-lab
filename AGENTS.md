## Development Commands

### Build & Development

- `bun run build` - Build the project with tsdown
- `bun run dev` - Development mode with watch
- `bun run typecheck` - Run TypeScript compiler for type checking

### Testing

- `bun run test` - Run all tests with vitest
- `bun run test <test-file>` - Run specific test file
- `bun run test -t <test-name>` - Run tests matching pattern
- `vitest run` - Run tests once (no watch mode)
- Use vitest's `test()` and `expect()` for assertions
- Example:

  ```typescript
  import { expect, test } from "vitest";
  import { fn } from "../src";

  test("fn", () => {
    expect(fn()).toBe("expected result");
  });
  ```

### Code Quality

- `bun run format` - Format code with prettier
- `bun run typecheck` - Verify type safety

### Package Management

- `bun install` - Install dependencies
- `bun run prepublishOnly` - Build before publishing

## Code Style Guidelines

### TypeScript Configuration

- Strict mode enabled: `strict: true`
- ES modules with verbatim module syntax
- Target: esnext, lib: es2023
- Use `import type` for type-only imports
- Explicit return types encouraged for public APIs

### Naming Conventions

- **Types/Interfaces**: PascalCase (e.g., `DesignArtifact`, `AgentConfig`)
- **Functions/Variables**: camelCase (e.g., `loadConfig`, `designModels`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `DEFAULT_CONFIG`, `SCORING_CRITERIA`)
- **Files**: kebab-case or PascalCase for types (e.g., `schema.ts`, `design.ts`)
- **Schemas**: PascalCase ending with `Schema` (e.g., `DesignArtifactSchema`)

### File System Operations

- Use `import * as fs from "fs"` and `import * as path from "path"`
- Prefer `fs.promises` for async file operations
- Use `path.join()` for cross-platform path construction
- Always use `{ recursive: true }` when creating directories
- Example:
  ```typescript
  await fs.promises.mkdir(outputDir, { recursive: true });
  await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));
  ```

### Import Patterns

```typescript
import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import type { PluginInput } from "@opencode-ai/plugin";
import type { DesignLabConfig, DesignSettings } from "../config/schema";
```

### Schema Validation with Zod

- Use `.strict()` for object schemas to prevent extra fields
- Use `.optional()` for optional fields
- Use `.default()` to provide default values
- Export types using `z.infer`:
  ```typescript
  export const ConfigSchema = z.object({...}).strict();
  export type Config = z.infer<typeof ConfigSchema>;
  ```

### Error Handling

- Throw descriptive Error objects: `throw new Error("Clear message")`
- Wrap errors with context: `throw new Error(`Failed: ${error.message}`)`
- Validate responses before use (null checks, array bounds)
- Use try-catch for async operations with external dependencies
- Include error context in error messages (model names, file paths, etc.)
- Example:
  ```typescript
  try {
    const result = await invokeAgent(...);
    if (!result) throw new Error("No result returned");
  } catch (error) {
    throw new Error(
      `Agent invocation failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  ```

### Async Patterns

- Use async/await consistently
- Return typed Promises for async functions
- Handle errors at appropriate abstraction level
- Use `??` for null coalescing, `||` for falsy fallbacks
- Use `Promise.all()` for parallel operations where appropriate
- Example:
  ```typescript
  const promises = models.map(model => invokeAgent(model, ...));
  const results = await Promise.all(promises);
  ```

### Code Organization

- Barrel exports (`index.ts`) for modules
- Separate files for schemas, config, agents, orchestrator
- Constants defined near usage or at module top
- Keep functions focused and single-purpose

### Plugin API Patterns

- Use `PluginInput` type for context parameter
- Access OpenCode SDK via `ctx.client`
- Session management: `ctx.client.session.prompt()`, `ctx.client.session.messages()`
- Directory parameter from `ctx.directory` for file operations
- Tool handlers receive `(input, output)` parameters
- Hook handlers use lifecycle events (e.g., `"tool.execute.before"`)
- Example:
  ```typescript
  export const Plugin: Plugin = async (ctx) => {
    const config = loadConfig(ctx.directory);
    return {
      tool: {
        tool_name: {
          description: "...",
          parameters: { ... },
          handler: async (input, output) => { ... }
        }
      }
    };
  };
  ```

### Constants & Defaults

- Define defaults as constant objects
- Use default values in schema definitions
- Export configuration constants for reuse
- Example:
  ```typescript
  export const DEFAULT_CONFIG: Partial<Config> = { ... };
  ```

### Formatting

- Run `bun run format` before committing
- 2 space indentation (from tsdown/prettier config)
- Use prettier for consistent formatting
- No trailing whitespace

## Hints

- Use context 7 or zread MCP server to get docs or context info for GitHub repos or other projects.

## OpenCode Docs

- https://opencode.ai/docs/plugins/
- https://opencode.ai/docs/agents/
- https://opencode.ai/docs/sdk/

## References

- `references/oh-my-opencode` contains a sample OpenCode Plugin with similar features to the OpenCode Design Lab.
