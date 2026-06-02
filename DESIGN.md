# Design Lab Technical Design

## System Overview

OpenCode Design Lab registers one coordinator agent, `design_lab`, and one
model-specific subagent per configured model. The coordinator agent coordinates
multi-model planning, plan revision, anonymous plan review, general asks, and
current-code review. Subagents are file-first workers: they write only the
assigned artifact file and do not modify project source files during review.

## Core Principles

### Single Coordinator

`design_lab` is the only command workflow coordinator. It uses OpenCode agent
mode `all`, so it can be selected directly and targeted through native
delegation from another primary agent. It does not set a `model` field, allowing
OpenCode to use the active UI/default model for coordination. This avoids
surprising model switches after invoking `/design-lab:ask`.

### Model-Specific Workers

Each configured model becomes a `design_lab_model_*` subagent. Subagents are
bound to their configured model and optional variant. They never call other
agents.

### File-First Output

Full model outputs are written to `.design-lab/` instead of being pasted into
chat. The primary agent reads those files and returns concise synthesis.

### Review-Only Safety

For current-code review, subagents only read the review packet and write review
Markdown files. They must not edit source files. The primary agent may later edit
code only if the user explicitly asks it to apply fixes.

### Default-Agent Activation

The plugin also registers a bundled OpenCode skill named `design-lab`. A
Superpowers-style message transform detects multi-model design/review wording in
the latest user message and prepends a small nudge asking the current agent to
load the skill. The UI can stay on the normal `build` agent; the skill tells that
agent to call native `task` directly for each selected `design_lab_model_*`
subagent. This keeps every model worker visible as a top-level task card in the
current OpenCode session. If the current agent is already `design_lab`, the nudge
instructs it to run directly instead of delegating back to itself. The
`design_lab_run` tool remains a fallback bridge for environments where native
Task fanout is unavailable.

## Architecture

```text
Default-agent user prompt
  -> load design-lab skill
  -> current agent selects workflow/model workers
  -> task to each selected design_lab_model_* subagent at top level
  -> verify output files
  -> synthesize summary.md and chat response

/design-lab:ask or direct design_lab agent usage
  -> design_lab coordinator agent
  -> select workflow and reviewer/model subset
  -> create run directory and manifest
  -> task to design_lab_model_* subagents inside that session
  -> verify output files
  -> synthesize summary.md and chat response
```

## Agent Registration

`src/design-lab.ts` loads `DesignLabConfig`, normalizes `models`, and registers:

- `design_lab`: all-mode coordinator with `task`, `read`, `write`, and `bash`.
- `design_lab_model_*`: subagents with `read` and `write` only.
- `design_lab_run`: fallback tool bridge used by the current/default agent when native delegation is unavailable.

The plugin no longer registers `designer`, `multi_model`, `designer_model_*`, or
`multi_model_*`.

The config hook also appends the package `skills/` directory to
`config.skills.paths`, matching the Superpowers OpenCode plugin pattern. The
`experimental.chat.messages.transform` hook adds a single
`DESIGN_LAB_AUTO_TRIGGER` nudge to the latest matching user message and skips
injection when that message already has the nudge.

## Configuration

```ts
type ModelConfig =
  | string
  | {
      model: string;
      variant?: string | null;
    };

type DesignLabConfig = {
  $schema?: string;
  models: ModelConfig[];
  default_variant: string | null;
  base_output_dir: string;
  design_agent_temperature: number;
  review_agent_temperature: number;
  topic_generator_model?: string;
};
```

Plain string model entries inherit `default_variant`. Object entries can set any
non-empty string variant such as `xhigh`, or `null` to omit variants for that
model. The plugin passes variants through and does not attempt provider
capability detection.

## Workflows

### General Ask

The primary writes `prompt.md`, delegates the prompt to selected or all model
subagents, stores outputs under `responses/`, and writes `summary.md`.

### Plan Generation

The primary writes `prompt.md`, delegates plan generation, stores plans under
`plans/{fileStem}.md`, and writes `manifest.json` mapping models, variants,
agents, file stems, plan files, and blind labels.

### Plan Revision

The primary locates the run directory, reads `manifest.json`, and delegates each
model to revise only its own plan file. If blind copies already exist, they are
rebuilt from the revised plans.

### Blind Plan Review

The primary copies plans into `blinds/plans-blind/plan-a.md`, `plan-b.md`, and so
on. It writes `blinds/mapping.json` for its own use and never shares that mapping
with reviewers. Review subagents receive only anonymous files and write reports
under `reviews/`. The primary de-anonymizes only in `summary.md`.

### Current-Code Review

The primary creates a review packet under `context/` containing the user request,
`git status`, `git diff`, and changed files. Selected review subagents read the
packet and write `reviews/code-review-{fileStem}.md`. The primary reads all
reviews, identifies consensus and questionable suggestions, and writes
`summary.md`.

## Reviewer Selection

By default, review workflows use all configured models. The user can specify a
subset by full model name, short name, file stem, agent name, or ordinal. The
primary must ask for clarification when a selector is ambiguous and must report
unknown selectors with the available model list.

## Output Layout

```text
.design-lab/YYYY-MM-DD-topic/
├── prompt.md
├── manifest.json
├── plans/
├── responses/
├── blinds/
│   ├── mapping.json
│   └── plans-blind/
├── reviews/
├── context/
└── summary.md
```

Not every workflow uses every directory. Plan workflows use `plans/`; general
asks use `responses/`; current-code reviews use `context/` and `reviews/`.

## Error Handling

- Subagents report success as `WROTE: <output_file>`.
- Subagents report failure as `FAILED: <specific reason>`.
- The primary verifies every expected file exists and has non-trivial content.
- Rate limits and timeouts are retried once.
- Payment/auth failures are skipped while other models continue.
- If all subagents fail, the primary stops and reports every failure.

## Compatibility Notes

Legacy direct tools still use the low-level JSON design/review helper agents, but
slash-command workflows are centered on `design_lab` and `/design-lab:ask`.
