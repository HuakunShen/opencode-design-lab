# No-Config Plugin Load Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Design Lab plugin load commands, skills, tools, and a fallback `design_lab` agent even when no valid `design-lab.json` exists.

**Architecture:** Keep config-dependent model subagents gated behind valid config. Add a fallback primary agent that only explains the missing/invalid config and points users to `/design-lab:init` plus project/user config paths. Keep the existing `design_lab_run` tool behavior unchanged except for any needed guidance text.

**Tech Stack:** TypeScript, OpenCode plugin config hook, Vitest, Bun.

---

### Task 1: Fallback Agent Registration

**Files:**

- Modify: `src/agents/index.ts`
- Modify: `src/agents/index.test.ts`
- Modify: `src/design-lab.ts`
- Modify: `src/design-lab.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that require `createDesignLabFallbackAgent()` to return an all-mode `design_lab` agent with no `model`, no `task` fanout, no model names, and clear `/design-lab:init` guidance. Add a plugin registration test with `loadPluginConfig` mocked to `null` that requires commands, skills, tools, and fallback `design_lab` to be registered while no `design_lab_model_*` agents are registered.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `bun run test src/agents/index.test.ts src/design-lab.test.ts`

Expected: FAIL because `createDesignLabFallbackAgent` is missing and no fallback agent is registered without config.

- [ ] **Step 3: Implement minimal fallback agent**

Export `createDesignLabFallbackAgent()` from `src/agents/index.ts`. It should return an `AgentConfig` with `mode: "all"`, no model, no subagent delegation requirement, and a prompt that tells the user config is missing or invalid and to run `/design-lab:init` or create `.opencode/design-lab.json` / `~/.config/opencode/design-lab.json`.

- [ ] **Step 4: Register fallback agent without config**

In `src/design-lab.ts`, register `design_lab: createDesignLabFallbackAgent()` in the `else` branch when `pluginConfig` is `null`. Do not register any `design_lab_model_*` entries in that branch.

- [ ] **Step 5: Verify focused tests pass**

Run: `bun run test src/agents/index.test.ts src/design-lab.test.ts`

Expected: PASS.

### Task 2: Full Verification

**Files:**

- No additional source files.

- [ ] **Step 1: Format touched files**

Run: `bunx prettier --write "src/agents/index.ts" "src/agents/index.test.ts" "src/design-lab.ts" "src/design-lab.test.ts"`

- [ ] **Step 2: Run full verification**

Run: `bun run test`

Expected: 8 test files pass.

Run: `bun run typecheck`

Expected: exit 0.

Run: `bun run build`

Expected: build completes and writes `.opencode/plugins/design-lab.js`.

- [ ] **Step 3: Runtime smoke check without config**

Temporarily move the global user config out of the way, run `opencode debug agent design_lab` from a directory with no project config, and confirm the fallback prompt appears. Restore the global config immediately afterward.

### Task 3: Release Decision

**Files:**

- Depends on whether the user approves committing/publishing.

- [ ] **Step 1: Stop before commit/publish unless explicitly approved**

Report the implementation and verification status. If the user approves release, commit only intended files, bump patch version, tag, push, watch the npm publish workflow, refresh the OpenCode package cache, and verify `opencode debug agent design_lab` from a no-config directory.
