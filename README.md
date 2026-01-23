# OpenCode Design Lab

An OpenCode plugin that registers a primary design agent and model-specific
subagents to generate and review designs directly to Markdown files.

## Overview

Design Lab uses a file-first, multi-model workflow:

- **Dynamic model mapping**: Subagents are created from your config
- **Correct model usage**: Each subagent is bound to its configured model
- **File-first outputs**: Designs and reviews are written to disk, not chat
- **Cross-review**: The same model set reviews all designs in a single report

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
  "design_models": ["claude-sonnet-4", "gpt-4o", "gemini-3-pro"],
  "review_models": ["claude-opus-4", "gpt-5-2"],
  "base_output_dir": ".design-lab",
  "design_agent_temperature": 0.7,
  "review_agent_temperature": 0.1
}
```

### Configuration Options

| Option                     | Type       | Default            | Description                                                               |
| -------------------------- | ---------- | ------------------ | ------------------------------------------------------------------------- |
| `design_models`            | `string[]` | **Required**       | Models to use for design generation (min 2)                               |
| `review_models`            | `string[]` | `design_models`    | Models to use for reviews. Defaults to all design models if not specified |
| `base_output_dir`          | `string`   | `.design-lab`      | Base directory for design lab outputs                                     |
| `design_agent_temperature` | `number`   | `0.7`              | Reserved for future use                                                   |
| `review_agent_temperature` | `number`   | `0.1`              | Reserved for future use                                                   |
| `topic_generator_model`    | `string`   | First design model | Reserved for future use                                                   |

## Usage

### 1. Ask the primary agent to generate designs

Use the `designer` agent. Example prompt:

```
Ask all designer_model subagents to design a deepwiki clone. Output each design
as a Markdown file with the model name as the filename.
```

The primary agent will:

- Create a run directory under `.design-lab/YYYY-MM-DD-topic/`
- Delegate design generation to each `designer_model_*` subagent
- Save designs to `designs/*.md`

### 2. Ask for cross-reviews

Use the same `designer` agent to trigger reviews:

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
