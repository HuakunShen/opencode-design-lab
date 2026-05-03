---
name: build-opencode-plugin
description: Guide for building OpenCode plugins. Covers all hooks, patterns, and architecture decisions based on 35+ real plugin studies. Use when building or modifying OpenCode plugins.
---

# Build OpenCode Plugin

基于对 35+ 个真实 OpenCode 插件的源码研究，涵盖所有 Hook 类型、实用模式和架构决策。

## Quick Start

**Minimal plugin** (30 lines):

```typescript
import type { Plugin } from "@opencode-ai/plugin";

export const myPlugin: Plugin = async (ctx) => {
  return {
    config: async (config) => {
      // Register commands, agents, instructions
    },
  };
};

export default myPlugin;
```

**Package.json**:
```json
{
  "name": "opencode-my-plugin",
  "main": "./dist/index.js",
  "type": "module",
  "dependencies": {
    "@opencode-ai/plugin": "^1.14.0",
    "@opencode-ai/sdk": "^1.14.0"
  }
}
```

**Install**: Add to `~/.config/opencode/opencode.json`:
```json
{ "plugin": ["opencode-my-plugin"] }
```

---

## Building and Publishing

### Source File Structure

OpenCode plugins are standard npm packages. The source can live anywhere, but the **built output** must be loadable by Node.js:

```
my-plugin/
├── src/
│   └── index.ts          # Plugin entry point (your source)
├── dist/                 # Build output (or .opencode/plugins/)
│   └── index.js          # Compiled plugin (ESM)
├── package.json
└── tsconfig.json
```

**Key rule**: OpenCode loads the file pointed to by `package.json` `"main"` field. It does NOT compile your TypeScript. You must ship compiled JavaScript.

### Build Tools

Most plugins use one of these:

| Tool | Used By | Best For |
|---|---|---|
| **tsdown** | opencode-design-lab | Fast, zero-config, bundles dependencies |
| **tsup** | opencode-supermemory | Fast, esbuild-based, good for libraries |
| **rollup** | opencode-antigravity-auth | Full control, tree-shaking |
| **tsc** | opencode-firecrawl | Simple, no bundling |

### tsdown Configuration (Recommended)

From `opencode-design-lab`:

```typescript
// tsdown.config.ts
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: "./src/design-lab.ts",     // Your plugin entry file
  outDir: ".opencode/plugins",      // Where the built file goes
  exports: false,                   // Don't generate extra export files
  dts: false,                       // Don't generate .d.ts (not needed)
  fixedExtension: false,
  noExternal: ["pino", "zod"],      // Bundle these deps into the output
});
```

**Critical options explained**:
- `entry`: Your plugin's main TypeScript file — the one that `export default`s the plugin
- `outDir`: Where the compiled `.js` goes. `.opencode/plugins/` is conventional but not required
- `noExternal`: Dependencies to **bundle into** the output. Without this, OpenCode may fail to resolve them at runtime
- `exports: false`: Prevents generating `index.mjs` / `index.cjs` variants — OpenCode expects a single file

### package.json Setup

```json
{
  "name": "opencode-my-plugin",
  "version": "1.0.0",
  "type": "module",
  "main": ".opencode/plugins/my-plugin.js",
  "files": [
    ".opencode/plugins"
  ],
  "scripts": {
    "build": "tsdown",
    "dev": "tsdown --watch",
    "prepublishOnly": "npm run build"
  },
  "dependencies": {
    "@opencode-ai/plugin": "^1.14.0"
  },
  "devDependencies": {
    "tsdown": "^0.21.0",
    "typescript": "^6.0.0"
  }
}
```

**Key fields**:
- `"main"`: Points to the **built** file, not the source. This is what OpenCode `require()`s
- `"files"`: Only include the build output in the npm package. Don't ship `src/`
- `"type": "module"`: OpenCode plugins must be ESM

### What Gets Published to npm

Only the build output:

```bash
npm publish
# Publishes:
#   .opencode/plugins/my-plugin.js   ← the compiled plugin
#   package.json
#   README.md
#   LICENSE
#
# Does NOT publish:
#   src/                              ← source code
#   tsdown.config.ts                  ← build config
#   node_modules/                     ← dependencies (bundled or external)
```

**Why only ship the build?**
- OpenCode loads plugins via `require("opencode-my-plugin")` which resolves to `"main"`
- Source files are useless at runtime — OpenCode doesn't compile TypeScript
- Smaller package size

### Local Development (Without Publishing)

For testing before publishing:

```bash
# 1. Build your plugin
npm run build

# 2. Link locally
npm link

# 3. In your test project, use the local plugin
npm link opencode-my-plugin

# 4. Add to ~/.config/opencode/opencode.json:
# { "plugin": ["opencode-my-plugin"] }
```

Or use a local path (no npm publish needed):

```json
// ~/.config/opencode/opencode.json
{
  "plugin": ["/absolute/path/to/my-plugin"]
}
```

OpenCode will `require()` that path directly.

### How OpenCode Loads Plugins

When you add `"plugin": ["opencode-my-plugin"]` to your config:

1. OpenCode runs `require("opencode-my-plugin")` using Node.js module resolution
2. This resolves to `package.json` `"main"` field → `.opencode/plugins/my-plugin.js`
3. OpenCode calls the default export as a function: `const hooks = await plugin(ctx)`
4. The returned `hooks` object is registered with the OpenCode runtime

**If your plugin fails to load**, check:
- Does `"main"` point to a file that exists after `npm run build`?
- Is the file ESM (`"type": "module"` in package.json)?
- Are dependencies either bundled (`noExternal`) or listed in `dependencies`?
- Does the default export return a `Promise<Hooks>`?

---

## What Do You Want to Build?

| I want to... | See this study | Hooks Covered |
|---|---|---|
| Build multi-agent orchestration, background tasks, session recovery | [01-orchestration-and-agents.md](./plugin-studies/01-orchestration-and-agents.md) | `config`, `event` |
| Add auth (OAuth/API keys), custom providers, multi-account management | [02-auth-providers-and-accounts.md](./plugin-studies/02-auth-providers-and-accounts.md) | `auth`, `provider`, `tool`, `event` |
| Register custom tools, chat context injection, external API integration | [03-tools-chat-and-external-apis.md](./plugin-studies/03-tools-chat-and-external-apis.md) | `tool`, `chat.message`, `tool.execute.*`, `event` |
| Set up config, commands, dynamic agents, skill registration | [04-config-patterns.md](./plugin-studies/04-config-patterns.md) | `config`, `shell.env` |
| Manipulate LLM context, modify parameters, control permissions | [05-context-manipulation.md](./plugin-studies/05-context-manipulation.md) | `chat.params`, `chat.headers`, `chat.message`, `permission.ask`, `experimental.*` |

---

## Hooks Index

All available hooks from `@opencode-ai/plugin`:

| Hook | Purpose | Study Reference |
|---|---|---|
| `config` | Register commands, agents, instructions, skills | [04-config-patterns.md](./plugin-studies/04-config-patterns.md) |
| `tool` | Register custom AI-callable tools | [03-tools-chat-and-external-apis.md](./plugin-studies/03-tools-chat-and-external-apis.md) |
| `auth` | Handle authentication (OAuth, API keys, custom fetch) | [02-auth-providers-and-accounts.md](./plugin-studies/02-auth-providers-and-accounts.md) |
| `provider` | Register custom AI providers and models | [02-auth-providers-and-accounts.md](./plugin-studies/02-auth-providers-and-accounts.md) |
| `chat.message` | Intercept/modify messages before LLM | [03-tools-chat-and-external-apis.md](./plugin-studies/03-tools-chat-and-external-apis.md) |
| `chat.params` | Modify LLM parameters (temperature, tokens) | [05-context-manipulation.md](./plugin-studies/05-context-manipulation.md) |
| `chat.headers` | Add custom HTTP headers to LLM requests | [05-context-manipulation.md](./plugin-studies/05-context-manipulation.md) |
| `event` | Handle lifecycle events (session start, errors) | [01-orchestration-and-agents.md](./plugin-studies/01-orchestration-and-agents.md) |
| `shell.env` | Inject env vars into shell commands | [04-config-patterns.md](./plugin-studies/04-config-patterns.md) |
| `permission.ask` | Control tool execution permissions | [05-context-manipulation.md](./plugin-studies/05-context-manipulation.md) |
| `tool.execute.before` | Intercept before tool execution | [03-tools-chat-and-external-apis.md](./plugin-studies/03-tools-chat-and-external-apis.md) |
| `tool.execute.after` | Intercept after tool execution | [03-tools-chat-and-external-apis.md](./plugin-studies/03-tools-chat-and-external-apis.md) |
| `experimental.chat.messages.transform` | Transform entire message array | [05-context-manipulation.md](./plugin-studies/05-context-manipulation.md) |
| `experimental.chat.system.transform` | Modify system prompts | [05-context-manipulation.md](./plugin-studies/05-context-manipulation.md) |
| `experimental.session.compacting` | Hook into session compaction | [05-context-manipulation.md](./plugin-studies/05-context-manipulation.md) |

---

## Common Patterns

### Pattern 1: Command as Prompt Template

Commands are prompt templates with `$input`:

```typescript
config.command = {
  "my-command": {
    description: "Does something useful",
    agent: "my-agent",  // Optional routing
    template: `You are doing X. Follow these steps:
1. First step
2. Second step

User input: $input`,
  }
};
```

### Pattern 2: Conditional Registration

Register basic features unconditionally, advanced features only when configured:

```typescript
const hasConfig = loadConfig(ctx.directory) !== null;

config.command = {
  "always-available": buildAlwaysCommand(),
  ...(hasConfig && { "needs-config": buildConfigDependentCommand() }),
};
```

### Pattern 3: Service Layer

Separate API clients, formatters, and utilities:

```
src/
├── index.ts          # Main plugin — just wires hooks
├── services/
│   ├── client.ts     # External API calls
│   ├── context.ts    # Format API responses for LLM
│   └── logger.ts     # Structured logging
└── config.ts         # Configuration
```

### Pattern 4: TUI Integration

Use `client.tui.showToast` for notifications:

```typescript
await client.tui.showToast({
  body: {
    title: "Rate Limit",
    message: `Account ${email} rate limited. Switching...`,
    variant: "warning",  // "info" | "warning" | "success" | "error"
  },
});
```

---

## Architecture Decisions

### Task Delegation: Code vs Prompt

**Research finding**: In all studied plugins, task delegation is done via **prompts**, not code.

| Approach | Example | Used By |
|---|---|---|
| Pure prompt | "Delegate to agent X to do Y" | oh-my-opencode, design-lab |
| System function | `task()`, `call_omo_agent()` | oh-my-opencode built-ins |
| Code-based | Programmatic subagent spawning | Not found in any studied plugin |

**Recommendation**: Use prompts for delegation. The AI understands natural language instructions better than programmatic APIs for complex task routing.

### Config: File vs Environment Variable

| Config Source | Best For | Example |
|---|---|---|
| Plugin config file | Complex nested settings | antigravity-auth |
| Environment variables | Secrets, simple flags | supermemory, firecrawl |
| OpenCode config | Agent/models config | oh-my-opencode |

### Logging

Most plugins use a simple custom logger:

```typescript
export function log(message: string, data?: Record<string, unknown>) {
  if (process.env.DEBUG) {
    console.log(`[plugin] ${message}`, data);
  }
}
```

---

## Parallel Agent Execution

### The Problem

Pure prompt-based parallel execution is not deterministic:

```typescript
// Prompt-only approach — AI might do them sequentially
template: `Fire all delegate_task calls simultaneously...`
```

### The Solution: Background Tasks

oh-my-opencode implements **actual parallel execution** via built-in tools:

| Tool | Purpose |
|---|---|
| `task()` | Launch background agent — returns `task_id` immediately |
| `background_output()` | Collect results after agent completes |
| `background_cancel()` | Cancel a running task |

**Usage pattern**:
```
// Fire 3 agents in parallel:
task(agent="explore", prompt="Find auth patterns...")      // returns task_a
task(agent="librarian", prompt="Find jwt docs...")          // returns task_b
task(agent="oracle", prompt="Architecture review...")       // returns task_c

// Wait for system notifications, then collect:
background_output(task_id="task_a")
background_output(task_id="task_b")
background_output(task_id="task_c")
```

**Critical rule**: Never call `background_output` immediately. Always wait for the `<system-reminder>` notification.

### Plugin-Implemented Parallelism

Plugins can build similar patterns using the OpenCode SDK:

```typescript
async function runAgentsInParallel(prompts: { agent: string; prompt: string }[]) {
  const tasks = await Promise.all(
    prompts.map(async ({ agent, prompt }) => {
      const session = await client.session.create({
        body: { title: `Background: ${agent}`, directory, parentID: ctx.session?.id },
      });
      await client.session.prompt({
        path: { id: session.data!.id },
        body: { parts: [{ type: "text", text: prompt }], agent },
      });
      return session.data!.id;
    })
  );
  return tasks;  // All sessions running in parallel
}
```

| Approach | Best For | Complexity | Determinism |
|---|---|---|---|
| Prompt instructions | Simple cases, 2-3 agents | Low | Low |
| Background task tools | Heavy orchestration, 5+ agents | High | High |
| Programmatic SDK | Plugin-managed parallelism | High | Highest |

---

## Plugin Type Reference

```typescript
type Plugin = (input: PluginInput, options?: PluginOptions) => Promise<Hooks>;

type PluginInput = {
  client: ReturnType<typeof createOpencodeClient>;  // OpenCode client API
  project: Project;                                   // Project metadata
  directory: string;                                  // Project root path
  worktree: string;                                   // Git worktree path
  serverUrl: URL;                                     // OpenCode server URL
  $: BunShell;                                        // Shell utility
};
```
