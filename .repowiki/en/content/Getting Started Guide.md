# Getting Started Guide

<cite>
**Referenced Files in This Document**
- [README.md](file://README.md)
- [DESIGN.md](file://DESIGN.md)
- [package.json](file://package.json)
- [tsdown.config.ts](file://tsdown.config.ts)
- [vitest.config.ts](file://vitest.config.ts)
- [src/design-lab.ts](file://src/design-lab.ts)
- [src/agents/index.ts](file://src/agents/index.ts)
- [src/commands/index.ts](file://src/commands/index.ts)
- [src/config/schema.ts](file://src/config/schema.ts)
- [src/config/loader.ts](file://src/config/loader.ts)
- [src/utils/schema-export.ts](file://src/utils/schema-export.ts)
- [schemas/design-lab-config.schema.json](file://schemas/design-lab-config.schema.json)
</cite>

## Table of Contents

1. [Install From Source](#install-from-source)
2. [Configure Models](#configure-models)
3. [Run Commands](#run-commands)
4. [Output Layout](#output-layout)
5. [Development Commands](#development-commands)

## Install From Source

The repository is a Bun-based TypeScript package. The source workflow is to clone
the repository, install dependencies, and build the plugin bundle. The package
declares `.opencode/plugins/design-lab.js` as its main output, and `tsdown` writes
that file from `src/design-lab.ts`.

```bash
bun install
bun run build
```

The README currently describes adding the plugin by name to the user's OpenCode
config after building from source.

**Section sources**

- [README.md](file://README.md#L28-L51)
- [package.json](file://package.json#L16-L28)
- [tsdown.config.ts](file://tsdown.config.ts#L3-L10)

## Configure Models

Design Lab reads configuration from project and user locations. The schema
requires at least two `design_models`. `review_models` and `ask_models` are
optional; both fall back to `design_models` in the runtime behavior documented by
the command templates and plugin entrypoint. Model entries can be plain strings or
objects with a `model` and `variant`.

```json
{
  "$schema": "https://raw.githubusercontent.com/HuakunShen/opencode-design-lab/main/schemas/design-lab-config.schema.json",
  "design_models": ["opencode/kimi-k2.5-free", "openai/gpt-5.2-codex"],
  "review_models": ["openai/gpt-5.2-codex"],
  "ask_models": ["opencode/kimi-k2.5-free", "openai/gpt-5.2-codex"],
  "base_output_dir": ".design-lab"
}
```

The command `/design-lab:init` creates `.opencode/design-lab.json` from a template
with current example model lists and `ask_models` included.

**Section sources**

- [README.md](file://README.md#L53-L100)
- [src/config/schema.ts](file://src/config/schema.ts#L23-L75)
- [src/config/loader.ts](file://src/config/loader.ts#L115-L222)
- [src/commands/index.ts](file://src/commands/index.ts#L16-L69)
- [schemas/design-lab-config.schema.json](file://schemas/design-lab-config.schema.json#L1-L120)

## Run Commands

All user-facing commands are registered under the `/design-lab:` namespace.
Commands are registered even when no config exists, so the init command and
helpful config-not-found paths remain available.

| Command                        | Primary agent | Purpose                                                   |
| ------------------------------ | ------------- | --------------------------------------------------------- |
| `/design-lab:init`             | default       | Create `.opencode/design-lab.json`.                       |
| `/design-lab:ask <prompt>`     | `multi_model` | Send one prompt to all ask models and synthesize.         |
| `/design-lab:journal`          | default       | Write a dated development journal entry.                  |
| `/design-lab:repowiki`         | `designer`    | Generate or update `.repowiki/` documentation.            |
| `/design-lab:design <topic>`   | `designer`    | Generate independent design proposals and blind copies.   |
| `/design-lab:review [dir]`     | `designer`    | Review existing designs with anonymous copies.            |
| `/design-lab:synthesize [dir]` | `designer`    | Produce a final qualitative report with real model names. |

**Section sources**

- [README.md](file://README.md#L16-L27)
- [README.md](file://README.md#L102-L140)
- [src/design-lab.ts](file://src/design-lab.ts#L37-L48)
- [src/commands/index.ts](file://src/commands/index.ts#L71-L365)

## Output Layout

Design and review workflows write run directories under `base_output_dir`, which
defaults to `.design-lab`. Design runs use `designs/`, `reviews/`, and
`blinds/designs-blind/` plus `blinds/mapping.json`. General ask runs write the
original prompt, one response file per ask model, and `summary.md`.

```text
.design-lab/YYYY-MM-DD-topic/
├── designs/
├── blinds/
│   ├── designs-blind/
│   └── mapping.json
├── reviews/
└── final-report.md
```

```text
.design-lab/YYYY-MM-DD-topic/
├── prompt.md
├── responses/
└── summary.md
```

**Section sources**

- [README.md](file://README.md#L142-L167)
- [DESIGN.md](file://DESIGN.md#L117-L131)
- [src/agents/index.ts](file://src/agents/index.ts#L236-L255)
- [src/agents/index.ts](file://src/agents/index.ts#L392-L461)

## Development Commands

The package scripts provide build, watch, test, formatting, type checking, and
schema export tasks. Vitest is scoped to `src/**/*.test.ts`, so checked-in or
local reference projects under `references/` are not collected as this package's
tests.

```bash
bun run build
bun run dev
bun run test
bun run format
bun run typecheck
bun run export-schemas
```

**Section sources**

- [README.md](file://README.md#L169-L186)
- [package.json](file://package.json#L20-L28)
- [vitest.config.ts](file://vitest.config.ts#L1-L7)
- [src/utils/schema-export.ts](file://src/utils/schema-export.ts#L16-L44)
