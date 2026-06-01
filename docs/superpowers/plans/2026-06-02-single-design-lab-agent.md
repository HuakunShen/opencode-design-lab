# Single Design Lab Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the split `designer` / `multi_model` workflow with one `design_lab` primary agent that can run multi-model plans, revisions, blind reviews, and same-session code reviews.

**Architecture:** The plugin registers one model-inheriting primary agent named `design_lab` and one configured subagent per model named `design_lab_model_*`. The primary agent owns orchestration, manifest files, reviewer selection, and summaries; model subagents only write their assigned artifact files and never modify source code during review. `/design-lab:ask` is a lightweight route into the same primary agent, while direct interaction with `design_lab` uses the same prompt contract.

**Tech Stack:** TypeScript, Bun, OpenCode plugin config hooks, OpenCode agent configs, Zod v4, Vitest, tsdown.

---

## File Structure

- Modify `src/config/schema.ts`: replace legacy model-list fields with `models` and `default_variant`, and allow arbitrary string variants or `null`.
- Modify `src/config/loader.test.ts`: cover new model config behavior and remove old `ask_models` assumptions.
- Modify `src/agents/index.ts`: replace old designer/multi-model primary/subagent factories with `design_lab` factories and prompts.
- Modify `src/agents/index.test.ts`: cover agent naming, primary model inheritance, arbitrary variants, prompt contracts, and review-only rules.
- Modify `src/commands/index.ts`: keep `/design-lab:ask` as the single workflow command and update `/design-lab:init` template.
- Modify `src/commands/index.test.ts`: verify old workflow commands are absent from the build helpers and `/design-lab:ask` routes to `design_lab`.
- Modify `src/design-lab.ts`: register `design_lab` plus `design_lab_model_*`; stop registering `designer`, `multi_model`, `designer_model_*`, and `multi_model_*`.
- Modify `src/design-lab.test.ts`: verify one primary agent, configured subagents, and unrelated commands remain.
- Modify `README.md` and `DESIGN.md`: document the new config, single-agent workflow, variants, manifests, plan/revise/review, and review-current-changes flow.
- Regenerate `schemas/design-lab-config.schema.json` with `bun run export-schemas`.

---

### Task 1: Update Config Model Schema

**Files:**

- Modify: `src/config/loader.test.ts`
- Modify: `src/config/schema.ts`

- [ ] **Step 1: Write failing tests for `models` and arbitrary variants**

Add tests showing that config supports:

- `models` as the required model list.
- `default_variant` as an arbitrary string, including `xhigh`.
- per-model `variant` as arbitrary string or `null`.
- legacy `design_models` without `models` is rejected.

Use assertions like:

```ts
expect(result!.models).toEqual([
  "openai/gpt-5.2-codex",
  { model: "openai/gpt-5.2-codex", variant: "xhigh" },
  { model: "local/model-without-variant", variant: null },
]);
expect(result!.default_variant).toBe("max");
```

- [ ] **Step 2: Verify RED**

Run: `bun run test src/config/loader.test.ts`

Expected: FAIL because `models` is not currently required and `xhigh` / `null` variants are rejected.

- [ ] **Step 3: Implement schema changes**

Change `ModelConfigSchema` to:

```ts
const VariantSchema = z.union([z.string().min(1), z.null()]);

const ModelConfigSchema = z.union([
  z.string().describe("Model identifier (e.g. 'opencode/kimi-k2.6')"),
  z.object({
    model: z.string().describe("Model identifier (e.g. 'opencode/kimi-k2.6')"),
    variant: VariantSchema.optional().describe(
      "Optional model variant. Use null to omit variant for this model.",
    ),
  }),
]);
```

Replace `design_models`, `review_models`, and `ask_models` with:

```ts
models: z.array(ModelConfigSchema).min(2, "At least 2 models required"),
default_variant: VariantSchema.default("max"),
```

- [ ] **Step 4: Verify GREEN**

Run: `bun run test src/config/loader.test.ts`

Expected: PASS.

---

### Task 2: Replace Agent Factories

**Files:**

- Modify: `src/agents/index.test.ts`
- Modify: `src/agents/index.ts`

- [ ] **Step 1: Write failing agent tests**

Cover these behaviors:

- `getDesignLabSubagentName("openai/gpt-5.2-codex")` returns `design_lab_model_gpt52codex`.
- `normalizeModelConfig("openai/gpt-5.2-codex", "xhigh")` returns variant `xhigh`.
- `normalizeModelConfig({ model: "local/no-variant", variant: null }, "max")` preserves `variant: null`.
- `createDesignLabPrimaryAgent()` returns a primary agent with no `model` field.
- `createDesignLabPrimaryAgent()` prompt includes plan, revise, blind review, current-code review, reviewer selection, and direct-agent usage rules.
- `createDesignLabModelAgent()` includes `variant` only when variant is not `null`.
- subagent prompt explicitly forbids source edits during review tasks.

- [ ] **Step 2: Verify RED**

Run: `bun run test src/agents/index.test.ts`

Expected: FAIL because the new names and factories do not exist.

- [ ] **Step 3: Implement new types and helpers**

Create a single `DesignLabModelSpec` type with `model`, `variant`, `agentName`, and `fileStem`.

Implement:

```ts
export function getDesignLabSubagentName(model: string): string;
export function normalizeModelConfig(
  config: ModelConfig,
  defaultVariant: string | null,
): {
  model: string;
  variant: string | null;
};
export function createDesignLabPrimaryAgent(
  options: DesignLabPrimaryAgentOptions,
): AgentConfig;
export function createDesignLabModelAgent(
  model: string,
  variant?: string | null,
): AgentConfig;
```

Keep `getDesignerModelFileStem()` if useful for stable file stems, or rename it only if tests and imports are updated consistently.

- [ ] **Step 4: Implement primary prompt contract**

The `design_lab` primary prompt must include:

- Available model subagents and model aliases.
- Config/runtime rule: direct use of `design_lab` must behave like `/design-lab:ask`.
- General ask workflow: save prompt, delegate responses, write summary.
- Plan workflow: write `plans/{fileStem}.md`, `manifest.json`, and `summary.md`.
- Revise workflow: locate run dir, read `manifest.json`, delegate each model to revise only its own `plans/{fileStem}.md`.
- Blind review workflow: copy anonymous `plans/` to `blinds/plans-blind/`, write `blinds/mapping.json`, delegate reviewers with only anonymous paths.
- Current-code review workflow: collect `git status`, `git diff`, and changed files into `context/`, delegate review-only tasks, then summarize findings.
- Reviewer selection: use all models by default; if prompt specifies models by full name, short name, file stem, or ordinal, use only those; ask for clarification when ambiguous; report unknown models.
- Failure handling: inspect every `delegate_task` result, retry rate-limit/timeouts once, report failed subagents.

- [ ] **Step 5: Implement subagent prompt contract**

The subagent prompt must include:

- Write only the exact `output_file` path.
- Never call other agents.
- Never modify project source files.
- During code review, read review packet files and write only the review file.
- During plan/revise, read and write only assigned plan artifacts.
- Return `WROTE: <output_file>` after successful file write or `FAILED: <reason>` on failure.

- [ ] **Step 6: Verify GREEN**

Run: `bun run test src/agents/index.test.ts`

Expected: PASS.

---

### Task 3: Rewrite Commands

**Files:**

- Modify: `src/commands/index.test.ts`
- Modify: `src/commands/index.ts`

- [ ] **Step 1: Write failing command tests**

Cover these behaviors:

- `buildAskCommand()` routes to `design_lab`.
- `buildAskCommand()` template mentions project-local config files only.
- `buildInitCommand()` emits the new `models` / `default_variant` config shape and arbitrary variant examples.
- The command module no longer exports or registers old design/review/synthesize workflow helpers if tests currently cover them.

- [ ] **Step 2: Verify RED**

Run: `bun run test src/commands/index.test.ts`

Expected: FAIL because `/design-lab:ask` still routes to `multi_model`, init still uses old fields, and old helper expectations still exist.

- [ ] **Step 3: Implement command changes**

Update `/design-lab:ask` to route to `design_lab` and delegate all behavior to the primary prompt.

Update init template to create:

```json
{
  "$schema": "https://raw.githubusercontent.com/HuakunShen/opencode-design-lab/main/schemas/design-lab-config.schema.json",
  "models": [
    { "model": "openai/gpt-5.2-codex", "variant": "xhigh" },
    { "model": "anthropic/claude-opus-4-5", "variant": "max" },
    { "model": "local/model-without-variant", "variant": null }
  ],
  "default_variant": "max",
  "base_output_dir": ".design-lab"
}
```

- [ ] **Step 4: Verify GREEN**

Run: `bun run test src/commands/index.test.ts`

Expected: PASS.

---

### Task 4: Update Plugin Registration

**Files:**

- Modify: `src/design-lab.test.ts`
- Modify: `src/design-lab.ts`

- [ ] **Step 1: Write failing plugin tests**

Cover these behaviors:

- Registers `design_lab` primary.
- Does not register `designer` or `multi_model`.
- Registers `design_lab_model_*` subagents from `models`.
- Preserves per-model `variant`, including arbitrary `xhigh`, and omits variant for `null`.
- Registers `/design-lab:ask`, `/design-lab:init`, `/design-lab:journal`, and `/design-lab:repowiki`.
- Does not register `/design-lab:design`, `/design-lab:review`, or `/design-lab:synthesize`.

- [ ] **Step 2: Verify RED**

Run: `bun run test src/design-lab.test.ts`

Expected: FAIL because registration still uses old agents and old commands.

- [ ] **Step 3: Implement registration changes**

Use `pluginConfig.models.map((cfg) => normalizeModelConfig(cfg, pluginConfig.default_variant))`.

Create specs:

```ts
const modelSpecs = modelConfigsUnique.map((cfg) => ({
  model: cfg.model,
  variant: cfg.variant,
  agentName: getDesignLabSubagentName(cfg.model),
  fileStem: getDesignerModelFileStem(cfg.model),
}));
```

Register:

```ts
config.agent = {
  ...(config.agent ?? {}),
  design_lab: createDesignLabPrimaryAgent({
    baseOutputDir: pluginConfig.base_output_dir,
    models: modelSpecs,
  }),
  ...Object.fromEntries(modelSubagentEntries),
};
```

- [ ] **Step 4: Verify GREEN**

Run: `bun run test src/design-lab.test.ts`

Expected: PASS.

---

### Task 5: Update Docs and Schema Export

**Files:**

- Modify: `README.md`
- Modify: `DESIGN.md`
- Modify generated: `schemas/design-lab-config.schema.json`

- [ ] **Step 1: Update docs**

Document:

- Single primary agent `design_lab`.
- Subagent family `design_lab_model_*`.
- `models` / `default_variant` config.
- arbitrary variants like `xhigh`.
- `variant: null`.
- `/design-lab:ask` and direct `design_lab` use.
- plan, revise, blind review, current-code review.
- reviewer subset selection by prompt.
- review subagents never edit source code.

- [ ] **Step 2: Regenerate JSON schema**

Run: `bun run export-schemas`

Expected: `schemas/design-lab-config.schema.json` reflects `models`, `default_variant`, arbitrary string variants, and nullable variants.

---

### Task 6: Full Verification

**Files:**

- Build artifact: `.opencode/plugins/design-lab.js`

- [ ] **Step 1: Run all tests**

Run: `bun run test`

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`

Expected: PASS.

- [ ] **Step 3: Run build**

Run: `bun run build`

Expected: PASS and `.opencode/plugins/design-lab.js` updated.

- [ ] **Step 4: Inspect working tree**

Run: `git status --short`

Expected: only intentional files are modified. Do not commit.

---

## Self-Review

- Spec coverage: The tasks cover single primary agent, direct-agent usage, `/design-lab:ask`, arbitrary variants, nullable variants, manifest-based plan/revise, anonymous review, current-code review, reviewer subset selection, and review-only source safety.
- Placeholder scan: No unresolved placeholders are left in the implementation instructions.
- Type consistency: The plan consistently uses `models`, `default_variant`, `design_lab`, `design_lab_model_*`, `createDesignLabPrimaryAgent`, `createDesignLabModelAgent`, and `getDesignLabSubagentName`.
- Commit policy: This repository's `AGENTS.md` says never auto commit, so no commit steps are included.
