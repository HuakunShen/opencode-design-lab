# General Multi-Model Ask Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a general multi-model prompt workflow that asks every configured model the same prompt, saves each full response, and has a primary agent synthesize the results in chat and `summary.md`.

**Architecture:** Add a `/design-lab:ask` command routed to a new `multi_model` primary agent. The plugin will register `multi_model_*` subagents from `ask_models` when configured, otherwise from `design_models`; each subagent writes only its assigned response file, while the primary agent creates the run directory, delegates work, verifies files, and writes the synthesis.

**Tech Stack:** TypeScript, Bun, OpenCode plugin config hooks, OpenCode agents, Vitest, Zod v4.

---

## Ground Rules

- Work in the current `main` checkout because the user explicitly approved using `main` instead of an isolated worktree.
- Do not commit. `AGENTS.md` says never auto commit.
- Follow TDD for behavior changes: write failing tests first, watch them fail, then implement.
- Keep the existing design-specific workflow intact.
- Do not register tool-based `generate_designs` / `review_designs` in this feature; the new workflow should match the current slash-command plus agent orchestration pattern.
- Fix Vitest discovery before feature work: `references/**` is a checked-in reference project and must not be included in this project's test suite.

## File Structure

- Modify `src/config/schema.ts`: add optional `ask_models` using the existing `ModelConfigSchema`.
- Create `vitest.config.ts`: limit this project's test discovery to `src/**/*.test.ts` so `references/**` is excluded.
- Modify `src/config/loader.test.ts`: verify `ask_models` loads and preserves string/object model entries.
- Modify `src/agents/index.ts`: add generic multi-model agent naming and agent factory functions.
- Create `src/agents/index.test.ts`: verify generic agent names, permissions, prompt content, and variant propagation.
- Modify `src/commands/index.ts`: add `buildAskCommand()` and update the init template.
- Modify `src/design-lab.ts`: register `/design-lab:ask`, `multi_model`, and `multi_model_*` agents.
- Modify `README.md`: document command, config, and output structure.
- Modify `DESIGN.md`: document generic fan-out/fan-in architecture.
- Regenerate `schemas/design-lab-config.schema.json` with `bun run export-schemas`.

---

### Task 0: Exclude Reference Projects From Vitest

**Files:**

- Create: `vitest.config.ts`

- [ ] **Step 1: Observe the failing baseline**

Run: `bun run test`

Expected before this task: FAIL because Vitest discovers `references/oh-my-openagent/**` tests that import `bun:test`. Those files belong to reference material, not this plugin source tree.

- [ ] **Step 2: Add Vitest project config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Verify the baseline is scoped to this project**

Run: `bun run test`

Expected: PASS for the current `src/**` tests only. No `references/**` tests should run.

---

### Task 1: Add `ask_models` To Config

**Files:**

- Modify: `src/config/loader.test.ts`
- Modify: `src/config/schema.ts`

- [ ] **Step 1: Write the failing config test**

Append this test inside the existing `describe("loadPluginConfig", () => { ... })` block in `src/config/loader.test.ts`:

```ts
it("loads optional ask_models for general multi-model prompts", () => {
  const projJson = projectConfigJsonPath("/tmp/test-proj");
  mockedExistsSync.mockImplementation((p) => p === projJson);
  mockedReadFileSync.mockImplementation((p) => {
    if (p === projJson) {
      return JSON.stringify({
        design_models: ["design-a", "design-b"],
        ask_models: ["ask-a", { model: "ask-b", variant: "high" }],
      });
    }
    return "";
  });

  const result = loadPluginConfig("/tmp/test-proj");

  expect(result).not.toBeNull();
  expect(result!.design_models).toEqual(["design-a", "design-b"]);
  expect(result!.ask_models).toEqual([
    "ask-a",
    { model: "ask-b", variant: "high" },
  ]);
});
```

- [ ] **Step 2: Run the config test and verify RED**

Run: `bun run test src/config/loader.test.ts`

Expected: FAIL because `ask_models` is rejected by `DesignLabConfigSchema` or unavailable on `DesignLabConfig`.

- [ ] **Step 3: Add `ask_models` to the schema**

In `src/config/schema.ts`, add this field after `review_models`:

```ts
  /**
   * List of models to use for general multi-model prompts.
   * If not specified, defaults to using all design_models.
   * Each entry follows the same format as design_models.
   */
  ask_models: z.array(ModelConfigSchema).optional(),
```

- [ ] **Step 4: Run the config test and verify GREEN**

Run: `bun run test src/config/loader.test.ts`

Expected: PASS.

---

### Task 2: Add Generic Multi-Model Agent Factories

**Files:**

- Create: `src/agents/index.test.ts`
- Modify: `src/agents/index.ts`

- [ ] **Step 1: Write failing agent tests**

Create `src/agents/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  createMultiModelPrimaryAgent,
  createMultiModelSubagent,
  getMultiModelSubagentName,
} from "./index";

describe("multi-model agents", () => {
  it("builds stable generic subagent names", () => {
    expect(getMultiModelSubagentName("openai/gpt-5.2-codex")).toBe(
      "multi_model_gpt52codex",
    );
  });

  it("creates a primary agent that can delegate and summarize", () => {
    const agent = createMultiModelPrimaryAgent({
      baseOutputDir: ".design-lab",
      askModels: [
        {
          model: "openai/gpt-5.2-codex",
          variant: "max",
          agentName: "multi_model_gpt52codex",
          fileStem: "gpt-5-2-codex",
        },
      ],
    });

    expect(agent.mode).toBe("primary");
    expect(agent.model).toBe("openai/gpt-5.2-codex");
    expect(agent.prompt).toContain("General multi-model workflow");
    expect(agent.prompt).toContain("multi_model_gpt52codex");
    expect(agent.prompt).toContain("responses/gpt-5-2-codex.md");
    expect(agent.tools?.delegate_task).toBe(true);
    expect(agent.tools?.task).toBe(false);
    expect(agent.permission?.edit).toBe("deny");
  });

  it("creates a subagent that only writes its assigned output file", () => {
    const agent = createMultiModelSubagent("openai/gpt-5.2-codex", "high");

    expect(agent.mode).toBe("subagent");
    expect(agent.model).toBe("openai/gpt-5.2-codex");
    expect(agent.variant).toBe("high");
    expect(agent.prompt).toContain("ONLY write to the exact output_file");
    expect(agent.prompt).toContain("WROTE: <output_file>");
    expect(agent.tools?.write).toBe(true);
    expect(agent.tools?.delegate_task).toBe(false);
    expect(agent.permission?.bash).toBe("deny");
  });
});
```

- [ ] **Step 2: Run the agent test and verify RED**

Run: `bun run test src/agents/index.test.ts`

Expected: FAIL because `createMultiModelPrimaryAgent`, `createMultiModelSubagent`, and `getMultiModelSubagentName` do not exist.

- [ ] **Step 3: Add generic agent types and name function**

In `src/agents/index.ts`, add these near the existing designer constants and types:

```ts
const MULTI_MODEL_SUBAGENT_PREFIX = "multi_model_";

type MultiModelSpec = {
  model: string;
  variant?: string;
  agentName: string;
  fileStem: string;
};

type MultiModelPrimaryAgentOptions = {
  baseOutputDir: string;
  askModels: MultiModelSpec[];
};

/**
 * Build the agent name for a generic multi-model subagent.
 */
export function getMultiModelSubagentName(model: string): string {
  return `${MULTI_MODEL_SUBAGENT_PREFIX}${normalizeAgentSuffix(model)}`;
}
```

- [ ] **Step 4: Add the primary agent factory**

In `src/agents/index.ts`, add this exported function before `buildDesignerPrimaryPrompt()`:

```ts
/**
 * Create the primary generic multi-model agent configuration.
 */
export function createMultiModelPrimaryAgent(
  options: MultiModelPrimaryAgentOptions,
): AgentConfig {
  const primaryModel = options.askModels[0]?.model;

  return {
    description:
      "General multi-model coordinator that compares model responses.",
    mode: "primary",
    model: primaryModel,
    prompt: buildMultiModelPrimaryPrompt(options),
    tools: {
      read: true,
      write: true,
      bash: true,
      delegate_task: true,
      edit: false,
      task: false,
    },
    permission: {
      bash: "allow",
      edit: "deny",
      webfetch: "deny",
    },
  } as AgentConfig;
}
```

- [ ] **Step 5: Add the generic primary prompt builder**

Add this helper in `src/agents/index.ts`:

```ts
function buildMultiModelPrimaryPrompt(
  options: MultiModelPrimaryAgentOptions,
): string {
  const askList = options.askModels
    .map(
      (spec) =>
        `- ${spec.agentName} (model: ${spec.model}${spec.variant ? `, variant: ${spec.variant}` : ""}, file: responses/${spec.fileStem}.md)`,
    )
    .join("\n");

  return `You are the Design Lab multi_model primary agent. Your job is to run a General multi-model workflow for any user prompt.

## Available subagents

${askList}

## General multi-model workflow

1. Create a run directory under "${options.baseOutputDir}" using this shape:
   ${options.baseOutputDir}/YYYY-MM-DD-topic/
2. Use a short, lowercase, hyphenated topic derived from the user's prompt.
3. Create a responses/ subdirectory.
4. Write the original user prompt to prompt.md in the run directory.
5. For every listed subagent, use delegate_task in parallel. Do not wait for one model before launching the next.
6. Send every subagent the same user prompt and an exact output_file path:
   ${options.baseOutputDir}/YYYY-MM-DD-topic/responses/{fileStem}.md
7. Instruct each subagent to write only to that file and keep chat output minimal.
8. Wait for all subagents to complete, then inspect every delegate_task result.
9. Verify every successful response file exists and has non-trivial content.
10. Read all successful response files.
11. Write summary.md in the run directory with:
    - Executive Summary
    - Consensus
    - Disagreements
    - Model-by-Model Notes
    - Final Recommendation
    - Failures
12. Return a concise chat summary with the run directory, response files, summary.md, and any failures.

## Failure handling

- Treat responses starting with "FAILED:" as failed.
- Treat missing or empty output files as failed.
- Retry rate-limit or timeout failures once.
- Skip payment/auth failures and continue with other models.
- If all subagents fail, stop and report every failure.

## Output rules

- Do not paste full model responses into chat.
- Save full model responses under responses/.
- Save your synthesis to summary.md.
- Use the real model names in summaries because this general workflow is not blind review.
- Never invent subagent names. Use only the subagents listed above.`;
}
```

- [ ] **Step 6: Add the generic subagent factory**

In `src/agents/index.ts`, add this exported function near `createDesignerModelAgent()`:

```ts
/**
 * Create a generic multi-model subagent configuration for a specific model.
 */
export function createMultiModelSubagent(
  model: string,
  variant?: string,
): AgentConfig {
  return {
    description:
      "General multi-model subagent that answers prompts into files.",
    mode: "subagent",
    model,
    ...(variant ? { variant } : {}),
    prompt: buildMultiModelSubagentPrompt(model),
    tools: {
      read: true,
      write: true,
      edit: false,
      bash: false,
      task: false,
      delegate_task: false,
    },
    permission: {
      bash: "deny",
      edit: "deny",
      webfetch: "deny",
    },
  } as AgentConfig;
}
```

- [ ] **Step 7: Add the generic subagent prompt builder**

Add this helper in `src/agents/index.ts`:

```ts
function buildMultiModelSubagentPrompt(model: string): string {
  return `You are a general-purpose Design Lab subagent for model: ${model}.

You receive prompts from the multi_model primary agent. Answer independently using your own reasoning.

## Rules

- ONLY write to the exact output_file path provided by the primary agent.
- Never modify project source files or files outside the requested output_file.
- Do not call other agents.
- Do not compare yourself to other models.
- Do not mention hidden implementation details unless directly relevant to the user's prompt.
- Keep chat output minimal.
- If output_file is missing or unclear, reply with: "FAILED: missing output_file".
- After writing successfully, reply with: "WROTE: <output_file>".
- If you cannot complete the task, reply with: "FAILED: <specific reason>".

## Response file format

Write a Markdown file with these sections:

1. Title
2. Direct Answer
3. Reasoning
4. Assumptions
5. Risks or Caveats
6. Suggested Next Steps`;
}
```

- [ ] **Step 8: Run the agent test and verify GREEN**

Run: `bun run test src/agents/index.test.ts`

Expected: PASS.

---

### Task 3: Add `/design-lab:ask` Command

**Files:**

- Create: `src/commands/index.test.ts`
- Modify: `src/commands/index.ts`

- [ ] **Step 1: Write failing command test**

Create `src/commands/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildAskCommand } from "./index";

describe("buildAskCommand", () => {
  it("routes general multi-model asks to the multi_model agent", () => {
    const command = buildAskCommand("/tmp/project");

    expect(command.agent).toBe("multi_model");
    expect(command.description).toContain("Ask all configured models");
    expect(command.template).toContain("$input");
    expect(command.template).toContain("ask_models");
    expect(command.template).toContain("design_models");
    expect(command.template).toContain(
      "/tmp/project/.opencode/design-lab.json",
    );
    expect(command.template).toContain("General multi-model workflow");
  });
});
```

- [ ] **Step 2: Run the command test and verify RED**

Run: `bun run test src/commands/index.test.ts`

Expected: FAIL because `buildAskCommand` does not exist.

- [ ] **Step 3: Add command builder**

Add this function near the existing command builders in `src/commands/index.ts`:

```ts
/**
 * Build the `/ask` command configuration.
 *
 * Usage: /design-lab:ask <prompt>
 * Sends the same prompt to all configured ask models and synthesizes results.
 */
export function buildAskCommand(directory: string): CommandConfig {
  return {
    description:
      "Ask all configured models the same prompt and synthesize their responses",
    agent: "multi_model",
    template: `Run a general multi-model ask for this prompt:

$input

## Config Loading (MUST DO FIRST)

1. Read the Design Lab config from these paths in order:
   - ${directory}/.opencode/design-lab.json
   - ${directory}/.opencode/design-lab.jsonc
   - ~/.config/opencode/design-lab.json
   - ~/.config/opencode/design-lab.jsonc
2. If no valid config is found, STOP and report:
   "Design Lab config not found or invalid. Run /design-lab:init to create one."
3. Use \`ask_models\` if specified, otherwise fallback to \`design_models\`.

## Instructions

Use your system prompt's General multi-model workflow. Save full model responses to files and return a concise synthesis in chat.`,
  };
}
```

- [ ] **Step 4: Update init template**

In `buildInitCommand()`, add `ask_models` after `review_models` in the sample JSON:

```json
  "ask_models": [
    "opencode/kimi-k2.5-free",
    "zhipuai-coding-plan/glm-4.7",
    "openai/gpt-5.2-codex",
    "google/antigravity-gemini-3-pro",
    "anthropic/claude-opus-4-5"
  ],
```

Also add one sentence after the review model explanation:

```text
`ask_models` is optional; if omitted, general asks use `design_models`.
```

- [ ] **Step 5: Run command test and verify GREEN**

Run: `bun run test src/commands/index.test.ts`

Expected: PASS.

- [ ] **Step 6: Run typecheck after command registration task**

Do not run typecheck yet if `buildAskCommand` is unused. It will be imported and registered in Task 4.

---

### Task 4: Register Command And Agents In Plugin

**Files:**

- Create: `src/design-lab.test.ts`
- Modify: `src/design-lab.ts`

- [ ] **Step 1: Write failing plugin registration test**

Create `src/design-lab.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({
  loadPluginConfig: vi.fn(() => ({
    design_models: ["design-a", "design-b"],
    ask_models: ["ask-a", { model: "ask-b", variant: "high" }],
    base_output_dir: ".design-lab",
    design_agent_temperature: 0.7,
    review_agent_temperature: 0.1,
  })),
}));

vi.mock("./utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { DesignLab } from "./design-lab";

describe("DesignLab plugin registration", () => {
  it("registers the general ask command and ask model agents", async () => {
    const hooks = await DesignLab({
      directory: "/tmp/project",
    } as Parameters<typeof DesignLab>[0]);
    const config = {} as Parameters<NonNullable<typeof hooks.config>>[0];

    await hooks.config?.(config);

    expect(config.command?.["design-lab:ask"]?.agent).toBe("multi_model");
    expect(config.agent?.multi_model?.model).toBe("ask-a");
    expect(config.agent?.multi_model?.prompt).toContain("multi_model_aska");
    expect(config.agent?.multi_model?.prompt).toContain("multi_model_askb");
    expect(config.agent?.multi_model_aska?.model).toBe("ask-a");
    expect(config.agent?.multi_model_askb?.model).toBe("ask-b");
    expect(config.agent?.multi_model_askb?.variant).toBe("high");
  });
});
```

- [ ] **Step 2: Run plugin registration test and verify RED**

Run: `bun run test src/design-lab.test.ts`

Expected: FAIL because `design-lab:ask` and `multi_model` are not registered yet.

- [ ] **Step 3: Import new factories and command**

Update imports from `./agents`:

```ts
  createMultiModelPrimaryAgent,
  createMultiModelSubagent,
  getMultiModelSubagentName,
```

Update imports from `./commands`:

```ts
  buildAskCommand,
```

- [ ] **Step 4: Register command**

In `config.command`, add:

```ts
        "design-lab:ask": buildAskCommand(ctx.directory),
```

- [ ] **Step 5: Build ask model specs**

After `reviewConfigs`, add:

```ts
const askConfigs = (pluginConfig.ask_models ?? pluginConfig.design_models).map(
  normalizeModelConfig,
);
```

After unique config declarations, add:

```ts
const askConfigsUnique = uniqueNormalizedConfigs(askConfigs);
```

After `reviewSpecs`, add:

```ts
const askSpecs = askConfigsUnique.map((cfg) => ({
  model: cfg.model,
  variant: cfg.variant,
  agentName: getMultiModelSubagentName(cfg.model),
  fileStem: getDesignerModelFileStem(cfg.model),
}));
```

- [ ] **Step 6: Register generic subagents**

After `subagentEntries`, add:

```ts
const multiModelSubagentEntries = askSpecs.map((spec) => [
  spec.agentName,
  createMultiModelSubagent(spec.model, spec.variant),
]);
```

In `config.agent`, add:

```ts
          multi_model: createMultiModelPrimaryAgent({
            baseOutputDir: pluginConfig.base_output_dir,
            askModels: askSpecs,
          }),
          ...Object.fromEntries(multiModelSubagentEntries),
```

- [ ] **Step 7: Update logging**

In the logger context, add:

```ts
            askModels: askConfigsUnique.map((c) => c.model),
```

- [ ] **Step 8: Run plugin registration test and verify GREEN**

Run: `bun run test src/design-lab.test.ts`

Expected: PASS.

- [ ] **Step 9: Run typecheck**

Run: `bun run typecheck`

Expected: PASS.

---

### Task 5: Update Documentation

**Files:**

- Modify: `README.md`
- Modify: `DESIGN.md`

- [ ] **Step 1: Update README command table and usage list**

Add `/design-lab:ask <prompt>` to both command lists:

```md
| `/design-lab:ask <prompt>` | Ask all configured models the same prompt and synthesize responses |
```

```md
- `/design-lab:ask <prompt>` — Asks all configured models the same prompt and synthesizes responses
```

- [ ] **Step 2: Update README config example**

Add `ask_models` to the sample config:

```json
  "ask_models": [
    "claude-sonnet-4",
    "gpt-4o",
    "gemini-3-pro"
  ],
```

- [ ] **Step 3: Update README configuration options**

Add this table row:

```md
| `ask_models` | `(string | object)[]` | `design_models` | Models for general multi-model prompts |
```

- [ ] **Step 4: Add README general ask output structure**

Add this example near the output structure section:

````md
General ask runs also write prompt and response files:

```text
.design-lab/YYYY-MM-DD-topic/
├── prompt.md
├── responses/
│   ├── claude-sonnet-4.md
│   ├── gpt-4o.md
│   └── gemini-3-pro.md
└── summary.md
```
````

````

- [ ] **Step 5: Update DESIGN.md architecture documentation**

Add a section describing:

```md
### Generic Multi-Model Ask Flow

`/design-lab:ask` runs a general fan-out/fan-in workflow. The `multi_model` primary agent sends the same prompt to each `multi_model_*` subagent, each subagent writes `responses/{model}.md`, and the primary agent writes `summary.md` after reading all successful responses.

This differs from `/design-lab:design`: design uses design-specific output conventions and can feed into blind review, while ask is for any prompt and uses real model names in the synthesis.
````

---

### Task 6: Schema Export And Full Verification

**Files:**

- Modify generated: `schemas/design-lab-config.schema.json`
- Build output may update: `.opencode/plugins/design-lab.js`

- [ ] **Step 1: Regenerate JSON schemas**

Run: `bun run export-schemas`

Expected: `schemas/design-lab-config.schema.json` includes `ask_models`.

- [ ] **Step 2: Run format**

Run: `bun run format`

Expected: Prettier completes successfully.

- [ ] **Step 3: Run tests**

Run: `bun run test`

Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`

Expected: PASS.

- [ ] **Step 5: Run build**

Run: `bun run build`

Expected: `.opencode/plugins/design-lab.js` builds successfully.

- [ ] **Step 6: Inspect diff**

Run: `git diff -- docs/superpowers/plans/2026-06-02-general-multi-model-ask.md src/config/schema.ts src/config/loader.test.ts src/agents/index.ts src/agents/index.test.ts src/commands/index.ts src/design-lab.ts README.md DESIGN.md schemas/design-lab-config.schema.json .opencode/plugins/design-lab.js`

Expected: only the plan and intended general multi-model ask changes are present.

---

## Self-Review

- Spec coverage: The plan implements the requested general workflow, file-first model outputs, chat summary, and command plus custom agent architecture.
- Placeholder scan: No TBD/TODO placeholders are present.
- Type consistency: The plan consistently uses `ask_models`, `multi_model`, `multi_model_*`, `createMultiModelPrimaryAgent`, `createMultiModelSubagent`, and `getMultiModelSubagentName`.
- Scope: The plan does not alter the existing blind review workflow except to share config conventions and output directory roots.
