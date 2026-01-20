# OpenCode Design Lab - Detailed Design

**Status**: Draft
**Last updated**: 2026-01-20

## 1. Goals

- Generate multiple independent design proposals using different models.
- Evaluate and score those designs in a structured, reproducible way.
- Enforce isolation between design agents during the design phase.
- Allow dynamic model selection via a config file, without generating agent files.

## 2. Non-Goals

- No automatic merging of designs.
- No code generation.
- No autonomous prompt optimization.

## 3. References (OpenCode docs used)

- Plugins: https://opencode.ai/docs/plugins/
  - Plugin is an async function returning hook handlers.
  - Example hook: `tool.execute.before` can intercept tool usage.
- Agents: https://opencode.ai/docs/agents/
  - Agents are configured in `opencode.json` with `model`, `prompt`, and `tools`.
- Config: https://opencode.ai/docs/config

## 4. Inputs and Outputs

### 4.1 Inputs

- Task description, constraints, and non-functional requirements.
- Config file with model lists and evaluation settings.

### 4.2 Outputs

- Design artifacts (structured JSON).
- Review artifacts (structured JSON or structured markdown).
- Aggregated scores and ranking (JSON).

## 5. Architecture Overview

```
OpenCode Design Lab (Plugin)
  - ConfigLoader
  - WorkflowOrchestrator
  - AgentInvoker (SDK or agent registry)
  - IsolationEnforcer (tool.execute.before)
  - SchemaValidator
  - ScoreAggregator
  - FileManager
```

The plugin is the orchestrator. Agents only generate or evaluate artifacts.

## 6. Configuration

### 6.1 Config file location

- Global: `~/.config/opencode/design-lab.json`
- Project override: `.opencode/design-lab.json`

### 6.2 Schema (minimal)

```json
{
  "$schema": "https://raw.githubusercontent.com/yourorg/opencode-design-lab/main/assets/design-lab.schema.json",
  "design_models": [
    {
      "id": "glm-4.7",
      "model": "zhipuai-coding-plan/glm-4.7",
      "temperature": 0.6,
      "prompt": "You are a systems designer..."
    }
  ],
  "review_models": [
    {
      "id": "gpt-5.2",
      "model": "openai/gpt-5.2",
      "temperature": 0.3
    }
  ],
  "topic_model": "openai/gpt-5.2",
  "output_dir": ".design-lab",
  "scoring": {
    "dimensions": ["clarity", "feasibility", "scalability", "maintainability"],
    "range": [0, 10]
  },
  "isolation": {
    "blocked_paths": [".design-lab/**/designs/**", ".design-lab/**/reviews/**"]
  }
}
```

### 6.3 Defaulting rule

- If `review_models` is missing or empty, use **all `design_models`** as reviewers.
- If `review_models` is provided, use **only those** for review.

## 7. Model Selection Strategy (Dynamic)

The config file defines model lists at runtime. We do **not** generate agent files.

### Option A (Preferred): SDK-driven invocations

- Use OpenCode SDK within the plugin to call models directly with per-request `model`.
- This allows dynamic model choice without editing `opencode.json`.
- Each design/review call uses the model defined in config.

Pseudo-flow:

```ts
const reviewModels = resolveReviewModels(config)
for (const m of config.design_models) {
  const design = await sdk.messages.create({
    model: m.model,
    system: m.prompt,
    messages: [/* task */]
  })
  writeDesign(m.id, design)
}
for (const r of reviewModels) {
  const review = await sdk.messages.create({
    model: r.model,
    system: reviewPrompt,
    messages: [/* all designs */]
  })
  writeReview(r.id, review)
}
```

### Option B (Fallback): Pre-registered agents in `opencode.json`

- Predefine one subagent per model in `opencode.json`.
- Plugin selects which agent to run based on config.
- This avoids runtime model override, but requires the config and `opencode.json` to stay aligned.

**Recommendation**: Option A is cleaner and more dynamic if the SDK is supported inside plugins. If SDK use is not possible, fall back to Option B.

## 8. Workflow Phases

### 8.1 Setup

1. Parse input and constraints.
2. Generate topic (via `topic_model` or first design model).
3. Create directory: `{output_dir}/YYYY-MM-DD-{topic}/`.
4. Write `task.json`.

### 8.2 Design Phase

- For each `design_model`:
  - Run model with design prompt and task payload.
  - Validate output against design schema.
  - Save to `designs/design-{id}.json`.

### 8.3 Review Phase

- For each `review_model`:
  - Read all designs.
  - Produce qualitative review and/or quantitative scores.
  - Save to `reviews/review-{id}.json`.

### 8.4 Aggregation Phase

- Parse review artifacts.
- Compute averages and variance.
- Write `scores.json` and `ranking.json`.

## 9. Isolation and Hook Enforcement

Use the plugin hook `tool.execute.before` (from OpenCode plugin docs) to block reads of
`designs/` and `reviews/` during the design phase:

```ts
return {
  "tool.execute.before": async (input, output) => {
    if (phase === "design" && input.tool === "read") {
      const p = output.args.filePath
      if (p.includes(".design-lab/") && p.includes("/designs/")) {
        throw new Error("Design isolation: reading other designs is blocked")
      }
    }
  }
}
```

## 10. Schemas

### 10.1 Design schema (minimal)

```json
{
  "title": "...",
  "summary": "...",
  "assumptions": [],
  "architecture_overview": "...",
  "components": [],
  "data_flow": "...",
  "tradeoffs": [],
  "risks": [],
  "open_questions": []
}
```

### 10.2 Review schema (qualitative)

```json
{
  "strengths": [],
  "weaknesses": [],
  "missing_considerations": [],
  "risk_assessment": "low | medium | high"
}
```

### 10.3 Scoring schema (quantitative)

```json
{
  "clarity": 0,
  "feasibility": 0,
  "scalability": 0,
  "maintainability": 0,
  "overall": 0,
  "justification": "..."
}
```

## 11. File Layout

```
.design-lab/YYYY-MM-DD-topic/
  task.json
  designs/
    design-{model-id}.json
  reviews/
    review-{model-id}.json
  scores/
    score-{model-id}.json
  results/
    ranking.json
```

## 12. Error Handling and Retries

- Validate JSON output; retry once on invalid schema.
- Abort design phase if >50% of designs fail.
- Continue review phase with available designs; log missing artifacts.

## 13. Open Questions / Risks

- Can OpenCode plugins safely use the SDK in-process to invoke models?
- If SDK is not permitted, confirm whether runtime model override for agents is supported.
- Determine maximum concurrency for model calls to avoid rate limits.

## 14. Decision Summary

- Use config-driven model selection.
- Prefer SDK-based invocation for dynamic models.
- Enforce isolation with `tool.execute.before` hook.
- Keep artifacts structured and validated.
