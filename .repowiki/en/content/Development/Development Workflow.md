# Development Workflow

<cite>
**Referenced Files in This Document**
- [AGENTS.md](file://AGENTS.md)
- [README.md](file://README.md)
- [package.json](file://package.json)
- [tsdown.config.ts](file://tsdown.config.ts)
- [vitest.config.ts](file://vitest.config.ts)
- [src/config/loader.test.ts](file://src/config/loader.test.ts)
- [src/agents/index.test.ts](file://src/agents/index.test.ts)
- [src/commands/index.test.ts](file://src/commands/index.test.ts)
- [src/design-lab.test.ts](file://src/design-lab.test.ts)
- [src/config/schema.ts](file://src/config/schema.ts)
- [src/utils/schema-export.ts](file://src/utils/schema-export.ts)
- [src/utils/logger.ts](file://src/utils/logger.ts)
- [.journal/2026-05-02-2238.md](file://.journal/2026-05-02-2238.md)
- [.journal/2026-05-02-2242.md](file://.journal/2026-05-02-2242.md)
</cite>

## Table of Contents

1. [Build and Package](#build-and-package)
2. [Testing](#testing)
3. [Schema Export](#schema-export)
4. [Logging](#logging)
5. [Recent Maintenance Context](#recent-maintenance-context)

## Build and Package

The package is a TypeScript ESM package built with Bun and tsdown. `bun run build`
invokes `tsdown`, which bundles `src/design-lab.ts` into `.opencode/plugins` with
no declaration output. The package's `main` field points at the generated plugin
bundle.

```bash
bun run build
bun run dev
bun run typecheck
```

**Section sources**

- [package.json](file://package.json#L2-L28)
- [README.md](file://README.md#L169-L186)
- [tsdown.config.ts](file://tsdown.config.ts#L3-L10)
- [AGENTS.md](file://AGENTS.md#L7-L33)

## Testing

Tests use Vitest and are now scoped to `src/**/*.test.ts`. The current test suite
covers config path resolution, config loading and merging, JSONC parsing, generic
multi-model agent factories, command templates, and plugin registration for the
ask workflow.

```bash
bun run test
bun run test src/config/loader.test.ts
bun run test -- -g "test name pattern"
```

**Section sources**

- [package.json](file://package.json#L20-L28)
- [vitest.config.ts](file://vitest.config.ts#L1-L7)
- [src/config/loader.test.ts](file://src/config/loader.test.ts#L46-L221)
- [src/agents/index.test.ts](file://src/agents/index.test.ts#L9-L55)
- [src/commands/index.test.ts](file://src/commands/index.test.ts#L10-L41)
- [src/design-lab.test.ts](file://src/design-lab.test.ts#L23-L40)

## Schema Export

Schema export is a code generation step. The script uses Zod v4's
`z.toJSONSchema()` to write config, design artifact, and score schemas under
`schemas/`. Run it after changing `src/config/schema.ts` and review generated
schema diffs before publishing.

```bash
bun run export-schemas
```

**Section sources**

- [package.json](file://package.json#L20-L28)
- [src/utils/schema-export.ts](file://src/utils/schema-export.ts#L1-L44)
- [src/config/schema.ts](file://src/config/schema.ts#L23-L149)

## Logging

The logger uses pino and writes formatted log lines to the OpenCode global config
directory, not the project root. On macOS and Linux this defaults to
`~/.config/opencode/design-lab.log`; on Windows it resolves through `APPDATA`.
`LOG_LEVEL` controls pino's log level.

**Section sources**

- [src/utils/logger.ts](file://src/utils/logger.ts#L1-L82)
- [AGENTS.md](file://AGENTS.md#L94-L106)

## Recent Maintenance Context

Recent journals document dependency updates, type compatibility cleanup after the
OpenCode package bump, and removal of an obsolete reference submodule. The
dependency bump moved the project to `@opencode-ai/plugin` and `@opencode-ai/sdk`
`1.14.31`, TypeScript `6.0.3`, tsdown `0.21.10`, and Zod `4.4.2`. The submodule
cleanup removed `.gitmodules` and gitignored `references/` so local reference
projects do not appear as untracked project files.

**Section sources**

- [.journal/2026-05-02-2238.md](file://.journal/2026-05-02-2238.md#L3-L58)
- [.journal/2026-05-02-2242.md](file://.journal/2026-05-02-2242.md#L3-L23)
- [package.json](file://package.json#L29-L40)
