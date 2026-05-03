# OpenCode Design Lab

An OpenCode plugin that registers a primary design agent and model-specific
subagents to generate and review designs directly to Markdown files.

## Overview

Design Lab uses a file-first, multi-model workflow:

- **Dynamic model mapping**: Subagents are created from your config
- **Correct model usage**: Each subagent is bound to its configured model
- **Per-model variant**: Control reasoning effort per model (`low`/`medium`/`high`/`max`)
- **File-first outputs**: Designs and reviews are written to disk, not chat
- **Cross-review**: The same model set reviews all designs in a single report

## Commands

| Command | Description |
| --- | --- |
| `/design-lab:init` | Initialize config file in `.opencode/design-lab.json` |
| `/design-lab:journal` | Document recent changes, decisions, and tradeoffs in `.journal/` |
| `/design-lab:design <topic>` | Generate design proposals from all configured models |
| `/design-lab:review [dir]` | Run cross-reviews on existing designs |
| `/design-lab:synthesize [dir]` | Synthesize reviews into a final qualitative report |
| `/design-lab:repowiki` | Generate comprehensive repo wiki documentation |

## Installation

### From npm (Future)

```bash
npm install opencode-design-lab
```

### From Source

```bash
git clone https://github.com/HuakunShen/opencode-design-lab.git
cd opencode-design-lab
bun install
bun run build
```

Then add to your OpenCode config (`~/.config/opencode/opencode.json`):

```json
{
  "plugin": ["opencode-design-lab"]
}
```

## Configuration

Create a config file at `~/.config/opencode/design-lab.json` or
`.opencode/design-lab.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/HuakunShen/opencode-design-lab/main/schemas/design-lab-config.schema.json",
  "design_models": [
    "claude-sonnet-4",
    "gpt-4o",
    "gemini-3-pro"
  ],
  "review_models": [
    "claude-opus-4",
    "gpt-5-2"
  ],
  "base_output_dir": ".design-lab"
}
```

Each model can also be configured as an object with a `variant` to control reasoning effort:

```json
{
  "design_models": [
    { "model": "opencode/kimi-k2.6", "variant": "max" },
    { "model": "opencode/kimi-k2.5", "variant": "high" }
  ]
}
```

### Configuration Options

| Option                     | Type                       | Default            | Description                                                               |
| -------------------------- | -------------------------- | ------------------ | ------------------------------------------------------------------------- |
| `design_models`            | `(string \| object)[]`     | **Required**       | Models for design generation (min 2). Strings default variant to `max`    |
| `review_models`            | `(string \| object)[]`     | `design_models`    | Models for reviews. Defaults to design models if not specified            |
| `base_output_dir`          | `string`                   | `.design-lab`      | Base directory for design lab outputs                                     |
| `design_agent_temperature` | `number`                   | `0.7`              | Reserved for future use                                                   |
| `review_agent_temperature` | `number`                   | `0.1`              | Reserved for future use                                                   |
| `topic_generator_model`    | `string`                   | First design model | Reserved for future use                                                   |

### Model Variant

Each model entry supports an optional `variant` field:

| Variant | Description |
|---------|-------------|
| `max`   | Highest reasoning effort (default for plain strings). Models cap at their maximum. |
| `high`  | High effort. Good for reviews. |
| `medium` | Balanced. |
| `low`   | Fastest, lowest cost. |

## Usage

### Slash Commands

All commands are registered as `/design-lab:<command>`:

- `/design-lab:init` — Creates `.opencode/design-lab.json` from template
- `/design-lab:journal` — Documents recent changes in a `.journal/` entry
- `/design-lab:design <topic>` — Delegates designs to all model subagents
- `/design-lab:review [dir]` — Cross-reviews existing designs
- `/design-lab:synthesize [dir]` — Produces final qualitative synthesis report
- `/design-lab:repowiki` — Generates comprehensive repo wiki docs

### Agent Workflow

You can also work interactively with the `designer` agent:

**Generate designs:**

```
Ask all designer_model subagents to design a deepwiki clone. Output each design
as a Markdown file with the model name as the filename.
```

The primary agent will:
- Create a run directory under `.design-lab/YYYY-MM-DD-topic/`
- Delegate design generation to each `designer_model_*` subagent
- Save designs to `designs/*.md`

**Cross-review:**

```
Now ask the same set of models to review all designs. Each reviewer outputs one
Markdown report comparing all designs at once.
```

Review files are saved to `reviews/review-*.md`.

## Output Structure

Each run creates a timestamped directory:

```
.design-lab/YYYY-MM-DD-topic/
├── designs/
│   ├── claude-sonnet-4.md
│   ├── gpt-4o.md
│   └── gemini-3-pro.md
└── reviews/
    ├── review-claude-opus-4.md
    └── review-gpt-5-2.md
```

## Development

```bash
# Build the plugin (outputs to .opencode/plugins/design-lab.js)
bun run build

# Development with watch mode
bun run dev

# Run tests (vitest)
bun run test

# Format code with prettier
bun run format

# Type checking
bun run typecheck
```
