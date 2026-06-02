---
name: design-lab
description: Use when the user asks for multi-model design, multi-model planning, multi-model review, comparing AI model plans, blind or anonymous review, or current-code review with multiple models
---

# Design Lab

Use this skill in the current agent. Do not ask the user to switch agents.

## When To Use

Use Design Lab when the user asks for:

- Multi-model design or planning
- Multi-model review or critique
- Comparing plans or answers from multiple AI models
- Blind or anonymous review of model plans
- Current-code review with multiple models

## How To Run

Prefer native OpenCode Task fanout when possible:

- If you are already running as `design_lab`, do not load this skill again or
  delegate back to `design_lab`; run the workflow directly.
- In the current/default agent, do not call `task` with `subagent_type:
"design_lab"`. That hides the model workers one level down.
- Instead, call native `task` directly for each selected `design_lab_model_*`
  agent. Each model worker should appear as a top-level task card in the current
  OpenCode session.
- The loaded skill owns model selection, output paths, manifests, and synthesis
  when running from the current/default agent.
- If native Task tool fanout is unavailable, call the `design_lab_run` tool as a
  fallback bridge.

Use `workflow: "auto"` unless the user clearly requested one of these workflows:

- `ask`: ask every configured model the same prompt
- `plan`: generate independent model plans
- `revise`: revise existing model plans
- `blind_review`: anonymously review existing model plans
- `code_review`: review current code or current changes

Pass each model worker a complete prompt with the user's request, the workflow,
and its exact `output_file`. Do not ask model workers to call other agents.

## Direct Fanout Workflow

Use this path from the normal `build` or current/default agent:

1. Read `.opencode/design-lab.json` or `.opencode/design-lab.jsonc` if present.
2. Select matching `design_lab_model_*` agents from the native Task tool's
   available agent list. Use all model agents unless the user selected a subset.
3. Create a run directory under the configured `base_output_dir` or `.design-lab`
   using a short timestamp/topic slug.
4. Write the original prompt to `prompt.md` and write a `manifest.json` with
   selected agent names, output files, skipped agents, and workflow.
5. Call native `task` once per selected `design_lab_model_*` agent. Launch all
   independent model tasks before waiting when possible.
6. Give each worker one exact output file, such as `responses/<agent-suffix>.md`,
   `plans/<agent-suffix>.md`, or `reviews/code-review-<agent-suffix>.md`.
7. After tasks finish, verify output files exist and have useful content.
8. Write `summary.md` with consensus, disagreements, recommended answer or
   findings, and failures.
9. Reply with a concise summary and paths. Do not paste full model responses into
   chat.

## Review Safety

For current-code reviews, reviewer subagents must not modify source code. Present
findings first. Only edit source code after the user explicitly asks for fixes.

## Fallback

If both native delegation and `design_lab_run` are unavailable, tell the user to
restart OpenCode after installing or rebuilding the Design Lab plugin. If
configuration is missing, tell the user to run `/design-lab:init`.
