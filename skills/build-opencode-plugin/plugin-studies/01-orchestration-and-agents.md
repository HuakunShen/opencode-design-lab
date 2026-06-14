# Orchestration and Agents

> **Stars**: 55,506 | **Plugin**: oh-my-opencode | **Pattern**: Multi-Model Orchestration + Background Tasks + Session Recovery

## Architecture Overview

oh-my-opencode is the largest and most feature-rich opencode plugin. It demonstrates almost every plugin API capability. Key architectural choices:

1. **Discipline Agents**: Pre-configured specialist agents (Sisyphus, Hephaestus, Oracle, Librarian) with model-specific tuning
2. **Hash-Anchored Edit Tool**: Implements `LINE#ID` content hashing for surgical edits
3. **Built-in MCPs**: Exa (search), Context7 (docs), Grep.app (GitHub)
4. **Background Agents**: Parallel agent execution with `task()` function
5. **Session Recovery**: Auto-resume on errors

## How It Registers Agents

```typescript
// The plugin defines specialist agents with model-specific configurations
// Each agent has a category (visual-engineering, deep, quick, ultrabrain)
// The category maps to specific models automatically

config.agent = {
  sisyphus: { model: "claude-opus-4-7", systemPrompt: "..." },
  hephaestus: { model: "gpt-5-4", systemPrompt: "..." },
  oracle: { model: "claude-opus-4-7", systemPrompt: "..." },
  // ...more agents
};
```

**Key Insight**: Agents aren't just model wrappers — they have custom system prompts and categories that map to model capabilities.

## How It Registers Commands

```typescript
config.command = {
  "ulw-loop": {
    template: "Start ultrawork loop until completion",
    agent: "sisyphus",
    description: "Start self-referential development loop",
  },
  "init-deep": {
    template: "Generate hierarchical AGENTS.md files...",
    description: "Initialize hierarchical AGENTS.md knowledge base",
  },
};
```

**Key Insight**: Commands can specify which agent should handle them via the `agent` field. The template uses `$input` for user input.

## How It Uses Tools

oh-my-opencode implements custom tools via LSP and AST-grep integration:

- `lsp_rename`, `lsp_goto_definition`, `lsp_find_references`, `lsp_diagnostics`
- `ast_grep_search`, `ast_grep_replace` — pattern-aware code transformations

**Key Insight**: Tools are registered in the `config` hook, not via the `tool` hook directly. The `tool` hook is for plugin-specific tools.

## How It Handles Skills

oh-my-opencode implements "Skill-Embedded MCPs" — skills carry their own MCP servers:

```typescript
// Skills definition in .opencode/skills/
// Each skill has: SKILL.md (instructions) + MCP configs
// Skills can be evaluated (evals/)
```

## Session Management Patterns

```typescript
// Using the session tools
session_list({ project_path: directory }); // List sessions
session_read({ session_id: "ses_xxx" }); // Read session messages
session_search({ query: "some text" }); // Search across sessions
```

## How It Uses Event Hooks

**Purpose**: Handle lifecycle events (session start, errors, etc.).

**Example — Session recovery** (from `opencode-antigravity-auth`, 10,280 stars):

```typescript
event: async (input) => {
  // input: { event: { type: string, properties?: unknown } }

  // Detect child sessions (subagents, background tasks)
  if (input.event.type === "session.created") {
    const props = input.event.properties as { info?: { parentID?: string } };
    if (props?.info?.parentID) {
      isChildSession = true; // Used to filter toasts in child sessions
    }
  }

  // Auto-recover from errors
  if (input.event.type === "session.error") {
    const error = props?.error;
    if (isRecoverableError(error)) {
      await fixSession(sessionID);
      // Auto-continue
      await client.session.prompt({
        path: { id: sessionID },
        body: { parts: [{ type: "text", text: "continue" }] },
      });
    }
  }
};
```

**Key takeaways**:

- `session.created` — track parent/child session relationships
- `session.error` — implement auto-recovery
- `session.deleted` — cleanup resources
- Use `client.session.prompt()` to programmatically send messages to a session

## Key Architecture Decisions

1. **Task delegation is prompt-based**: Agents use `task()` and `call_omo_agent()` system functions to delegate work
2. **Ralph Loop pattern**: A self-referential loop that continues until complete
3. **Todo enforcement**: System monitors idle agents and re-engages them
4. **Model-specific tuning**: Each agent uses a model optimized for its task type

## Relevant APIs Used

- `config` hook: registers agents, commands, instructions
- Built-in tools: LSP, AST-grep, Tmux
- MCP integration: built-in servers for search, docs, code search
- Session management: list, read, search sessions
- Event hooks: session recovery, auto-continue

## Parallel Agent Execution (Background Task System)

oh-my-opencode's most important architectural innovation: **true parallel agent execution** via a dedicated background task infrastructure.

### The 3-Tool System

```
src/tools/background-task/
├── create-background-task.ts    # task() - spawn background agent
├── create-background-output.ts  # background_output() - collect results
├── create-background-cancel.ts  # background_cancel() - kill running task
├── clients.ts                   # SDK client wrappers
├── constants.ts                 # Tool descriptions
├── types.ts                     # BackgroundTaskArgs, etc.
└── ...
```

### How Parallel Execution Works

```
Step 1: AI calls task(agent="explore", prompt="...")
  → BackgroundManager.launch() creates child session
  → Returns task_id immediately
  → Agent starts, runs in background session

Step 2: AI calls task() again for another agent
  → Second session starts in parallel (no waiting)

Step 3: <system-reminder> notifies when each task completes

Step 4: AI calls background_output(task_id="...") to get results
```

**Key architectural components**:

- `BackgroundManager` — singleton managing all background tasks, tracks lifecycle (pending → running → completed/error/cancelled)
- Child sessions inherit parent context (model, agent, conversation)
- `full_session` flag in background_output returns full message history
- `session_id` parameter allows continuing an existing task

### What This Means for Plugin Developers

The background task system is harness-level. **Individual plugins don't implement their own parallelism** — they declare commands and tools, and the harness provides parallelism. When a plugin's command template says "delegate to subagents", the harness's `task()` tool makes that parallel if the AI uses it correctly.

If you want determinstic parallelism in your own plugin, you can use `ctx.client.session.create()` + `ctx.client.session.prompt()` from the SDK to spawn child sessions programmatically. This gives you full control without relying on AI behavior.
