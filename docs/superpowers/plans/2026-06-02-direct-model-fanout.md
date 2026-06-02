# Direct Model Fanout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make default-agent Design Lab activation show each model worker as a top-level native OpenCode `task` card.

**Architecture:** The `design-lab` skill will make the current/default agent act as the coordinator and call `task` directly for each `design_lab_model_*` agent. The `design_lab` coordinator remains available for slash commands and direct agent usage, while `design_lab_run` remains only a fallback.

**Tech Stack:** TypeScript, OpenCode plugin hooks, bundled OpenCode skills, Vitest, Bun.

---

### Task 1: Update Bootstrap Guidance Tests

**Files:**

- Modify: `src/skills/design-lab-bootstrap.test.ts`
- Modify: `src/skills/design-lab-bootstrap.ts`

- [ ] **Step 1: Write the failing test**

Add expectations that the injected nudge tells the active agent to call model subagents directly and avoids delegating to `design_lab`:

```ts
expect(triggerParts[0].text).toContain(
  "call `task` directly for each `design_lab_model_*`",
);
expect(triggerParts[0].text).toContain("top-level task card");
expect(triggerParts[0].text).not.toContain('subagent_type: "design_lab"');
```

- [ ] **Step 2: Run failing test**

Run: `bun run test src/skills/design-lab-bootstrap.test.ts`

Expected: FAIL because the current nudge still says to delegate one task to `design_lab`.

- [ ] **Step 3: Update implementation text**

Change `DESIGN_LAB_NUDGE` so it instructs the current agent to load `design-lab`, stay in the current agent, and call native `task` directly for each selected `design_lab_model_*` agent. Keep the self-delegation guard for sessions already running as `design_lab`.

- [ ] **Step 4: Run passing test**

Run: `bun run test src/skills/design-lab-bootstrap.test.ts`

Expected: PASS.

### Task 2: Update Bundled Skill Workflow

**Files:**

- Modify: `skills/design-lab/SKILL.md`
- Modify: `src/skills/design-lab-bootstrap.test.ts`

- [ ] **Step 1: Write the failing test**

Extend the bootstrap test to require the nudge to mention the bundled skill's direct fanout contract:

```ts
expect(triggerParts[0].text).toContain(
  "the loaded skill owns model selection, output paths, manifests, and synthesis",
);
```

- [ ] **Step 2: Run failing test**

Run: `bun run test src/skills/design-lab-bootstrap.test.ts`

Expected: FAIL until the nudge contains the direct fanout contract.

- [ ] **Step 3: Update bundled skill**

Rewrite `skills/design-lab/SKILL.md` so the current agent:

```md
- Directly calls native `task` for each selected `design_lab_model_*` agent.
- Does not first delegate to `design_lab`, because that hides model workers one level down.
- Creates the run directory, manifest, and summary in the current session.
- Uses `design_lab` only when the user explicitly selected that agent or invoked `/design-lab:ask`.
- Uses `design_lab_run` only when native `task` is unavailable.
```

- [ ] **Step 4: Run passing test**

Run: `bun run test src/skills/design-lab-bootstrap.test.ts`

Expected: PASS.

### Task 3: Update Docs And Verify Runtime Shape

**Files:**

- Modify: `README.md`
- Modify: `DESIGN.md`

- [ ] **Step 1: Update docs**

Document the default-agent path as:

```text
build/current agent
  -> task(design_lab_model_*) cards visible at top level
  -> current agent reads outputs and writes summary
```

Document the direct-agent path as:

```text
design_lab agent or /design-lab:ask
  -> design_lab coordinator
  -> task(design_lab_model_*) inside that session
```

- [ ] **Step 2: Run focused tests**

Run: `bun run test src/skills/design-lab-bootstrap.test.ts src/agents/index.test.ts src/design-lab.test.ts`

Expected: PASS.

- [ ] **Step 3: Run full verification**

Run: `bun run test`, `bun run typecheck`, and `bun run build`.

Expected: tests pass, typecheck exits 0, build succeeds. The known `noExternal` deprecation warning may remain.

- [ ] **Step 4: Runtime smoke**

Run a CLI smoke from `build` that forces `task` calls to two model agents directly and forbids `design_lab_run` and `task(design_lab)`. Expected JSON events should contain top-level `tool: "task"` calls whose `input.subagent_type` starts with `design_lab_model_`.

Do not commit unless the user explicitly asks.
