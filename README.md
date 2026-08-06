# OpenCode Design Lab

OpenCode Design Lab is an OpenCode plugin for running the same planning or
review task across multiple configured models in one session. A single primary
agent coordinates model-specific subagents, writes artifacts to disk, and
summarizes results back into chat.

## Overview

- **Single coordinator agent**: `design_lab` coordinates every workflow and can run directly or through delegation.
- **Model-specific subagents**: `design_lab_model_*` agents are generated from config.
- **Current model inheritance**: `design_lab` does not set a fixed model, so OpenCode can use the active UI/default model for coordination.
- **Default-agent activation**: the bundled `design-lab` skill can be loaded from the normal `build` agent when your prompt mentions multi-model design or review.
- **Arbitrary variants**: model variants are passed through as configured, including values like `xhigh`.
- **Review-only subagents**: model subagents write review files and never modify source code during review.
- **File-first outputs**: full model responses, plans, reviews, manifests, and summaries are saved under `.design-lab/`.

## Commands

| Command                    | Description                                     |
| -------------------------- | ----------------------------------------------- |
| `/design-lab:init`         | Initialize `.opencode/design-lab.json`          |
| `/design-lab:ask <prompt>` | Run the unified multi-model Design Lab workflow |
| `/design-lab:journal`      | Document recent decisions in `.journal/`        |
| `/design-lab:repowiki`     | Generate comprehensive repository documentation |

You can also switch to the `design_lab` agent and ask directly without using
`/design-lab:ask`. Direct agent usage follows the same workflow rules.

You do not have to switch agents for common prompts. The plugin registers a
bundled `design-lab` skill and nudges the current agent to load it when prompts
mention multi-model design, multi-model review, blind review, or current-code
review. The nudge is applied to the latest matching user turn, so it also works
in an existing chat. After loading the skill, the current agent should call the
native Task tool directly for each selected `design_lab_model_*` agent; this
keeps every model worker visible as a top-level task card in the OpenCode UI. If
the current agent is already `design_lab`, it runs the coordinator workflow
directly instead of delegating back to itself. If native Task fanout is
unavailable, the current agent can fall back to the `design_lab_run` tool, which
starts a child `design_lab` session and returns the summary. Restart OpenCode after
rebuilding or installing the plugin so the bundled skill and tool are available.

## Configuration

Create `.opencode/design-lab.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/HuakunShen/opencode-design-lab/main/schemas/design-lab-config.schema.json",
  "models": [
    { "model": "openai/gpt-5.2-codex", "variant": "xhigh" },
    { "model": "opencode/kimi-k2.5-free", "variant": "max" },
    { "model": "local/model-without-variant", "variant": null }
  ],
  "default_variant": "max",
  "base_output_dir": ".design-lab"
}
```

### Options

| Option            | Type                   | Default       | Description                                     |
| ----------------- | ---------------------- | ------------- | ----------------------------------------------- |
| `models`          | `(string \| object)[]` | Required      | Models used for all Design Lab workflows, min 2 |
| `default_variant` | `string \| null`       | `"max"`       | Variant applied to plain string model entries   |
| `base_output_dir` | `string`               | `.design-lab` | Output directory for run artifacts              |

Model entries can be plain strings or objects:

```json
{
  "models": [
    "openai/gpt-5.2-codex",
    { "model": "openai/gpt-5.2-codex", "variant": "xhigh" },
    { "model": "local/model-without-variant", "variant": null }
  ]
}
```

- Plain strings use `default_variant`.
- `variant` can be any non-empty string supported by your provider/OpenCode setup.
- `variant: null` means invoke that model without a variant.

## Workflows

### Generate Plans

```text
/design-lab:ask generate plans for adding OAuth login
```

Each selected model writes its own plan under `plans/`, and `manifest.json`
records the model-to-file mapping.

### Revise Plans

```text
/design-lab:ask revise the latest plans to support multi-tenant auth
```

The primary agent reads `manifest.json` and asks each model to revise only its
own plan file.

### Blind Review Plans

```text
/design-lab:ask anonymously review the latest plans
```

The primary agent copies plan files to anonymous names under
`blinds/plans-blind/`, writes `blinds/mapping.json`, and sends only anonymous
files to reviewers.

### Review Current Code Changes

```text
/design-lab:ask review current changes with gpt and kimi only
```

From the normal `build` agent, this also works as a plain prompt:

```text
review current changes with multiple models
```

The primary agent collects `git status`, `git diff`, changed files, and your
review focus into a context packet. Selected model subagents read the packet and
write review files under `reviews/`. They do not edit source code.

Reviewer selection can use full model names, short names, file stems, agent
names, or ordinals such as `1, 3, 5`. Ambiguous selectors require clarification.

## Output Structure

Plan and blind review runs use:

```text
.design-lab/YYYY-MM-DD-topic/
├── prompt.md
├── manifest.json
├── plans/
│   ├── gpt-5-2-codex.md
│   └── kimi-k2-5-free.md
├── blinds/
│   ├── mapping.json
│   └── plans-blind/
│       ├── plan-a.md
│       └── plan-b.md
├── reviews/
│   ├── review-gpt-5-2-codex.md
│   └── review-kimi-k2-5-free.md
└── summary.md
```

Current-code review runs use:

```text
.design-lab/YYYY-MM-DD-code-review/
├── context/
│   ├── review-request.md
│   ├── git-status.txt
│   ├── diff.patch
│   └── changed-files.txt
├── reviews/
│   ├── code-review-gpt-5-2-codex.md
│   └── code-review-kimi-k2-5-free.md
├── manifest.json
└── summary.md
```

## Goal Mode

Set a session-scoped goal and the plugin keeps working autonomously until it is
complete, blocked, or a safety limit is reached — like Codex/Claude goal mode.

```bash
/goal fix the failing tests and verify the suite passes
/goal ship the release --success "tests pass and changelog updated" --max-turns 20
/goal status        # current state, budget usage, last checkpoint
/goal history       # lifecycle history
/goal pause         # pause without clearing
/goal resume        # continue with a fresh budget window
/goal clear         # discard the goal
/goal add <cond>    # background the current goal, focus a new one
/goal list          # numbered live goals
/goal focus <n>     # switch focus
/goal sequence a; b; c   # run objectives one at a time, auto-promoting
```

Completion requires evidence:

```
[goal:evidence] ran npm test (83 passing), verified the build output
[goal:complete]
```

Safety limits (configurable under `"goals"` in design-lab.json): 10 auto-continue
turns, 15 minutes, 200k context tokens, 1.5s minimum delay, no-progress pause
(< 50 output tokens, 2-turn grace), no-tool-call pause (2 turns), 80% budget
wrap-up, 3 prompt-failure circuit breaker. Goals persist to
`.opencode/goals/` and survive compaction and restarts (recovered paused).

Plan-mode safety: goals created from the `plan` agent stay paused; auto-continue
never escapes Plan mode; resume from Plan mode is refused. Override with
`"goals": { "allow_goal_execution_from_plan": true }`.

Agent tools: `goal_status`, `goal_set`, `goal_pause`, `goal_resume`, `goal_block`,
`goal_complete` let the model manage the goal itself.

Add `.opencode/goals/` to your `.gitignore` (goal state is project-local).

## Development

```bash
bun run build
bun run dev
bun run test
bun run typecheck
bun run export-schemas
```
