# Config Patterns

> **Plugins**: opencode-firecrawl (57 stars) + opencode-design-lab | **Pattern**: Config Hook + Skill Registration + Dynamic Agents

## Architecture Overview

This study combines two plugins that demonstrate config hook patterns — from minimal to advanced:

1. **opencode-firecrawl**: Minimal plugin showing skill registration and shell environment injection
2. **opencode-design-lab**: Advanced patterns with dynamic agent creation, command templates, and conditional registration

---

## Part 1: Minimal Plugin (opencode-firecrawl)

### How It Registers Skills

```typescript
async config(input) {
  // 1. Add skill instructions
  input.instructions ??= [];
  input.instructions.push(
    join(current_dir, "skills", "firecrawl-cli", "rules", "install.md"),
  );

  // 2. Register skill paths
  // @ts-expect-error -- skills is a new opencode feature, types not yet updated
  input.skills ??= {};
  // @ts-expect-error -- skills is a new opencode feature, types not yet updated
  input.skills.paths ??= [];
  // @ts-expect-error -- skills is a new opencode feature, types not yet updated
  input.skills.paths.push(join(current_dir, "skills"));
}
```

**Key Insight**: `config.skills.paths` registers skill directories. `config.instructions` adds markdown instruction files. The `@ts-expect-error` indicates this is a newer feature not yet in the official types. Skills placed in registered paths are auto-discovered like `~/.opencode/skills/`.

### How It Uses shell.env Hook

**Purpose**: Inject environment variables into shell commands.

```typescript
"shell.env": async (_input, output) => {
  if (process.env.FIRECRAWL_API_KEY) {
    output.env.FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
  }
}
```

**Key takeaways**:
- Runs before every shell command
- Use to make API keys available to CLI tools
- The `input` has: `{ cwd: string, sessionID?: string, callID?: string }`

### Minimal Plugin Structure

```typescript
import type { Plugin } from "@opencode-ai/plugin";
import { join } from "node:path";

export const plugin: Plugin = async () => {
  return {
    async config(input) { ... },
    "shell.env": async (_input, output) { ... },
  };
};

export default plugin;
```

**Key Insight**: A plugin can be as simple as 30 lines. You don't need to use every hook — just the ones relevant to your use case.

---

## Part 2: Advanced Config Patterns (opencode-design-lab)

### How It Creates Agents Dynamically

```typescript
// From config:
// { "design_models": ["claude-sonnet-4", "gpt-4o"] }

for (const model of designModels) {
  config.agent[getDesignerSubagentName(model)] = {
    model: model,
    systemPrompt: "You are a design agent...",
    // Each agent is bound to its specific model
  };
}
```

**Key Insight**: Agents don't have to be hardcoded. You can create them dynamically from configuration.

### How It Builds Commands

```typescript
config.command = {
  "design-lab:design": {
    description: "Generate design proposals...",
    agent: "designer",           // Which agent handles this command
    template: `Generate designs...
    
    Delegates to:
    - designer_model_claude → designs/claude.md
    - designer_model_gpt4o → designs/gpt4o.md
    
    $input  // User input placeholder
    `,
  }
};
```

**Key Insight**: Command templates are prompt strings. `$input` is replaced with the user's input. The `agent` field routes the command to the specified agent. Commands can embed model-specific data in their templates.

### How It Loads Config

```typescript
// src/config/loader.ts
export function loadPluginConfig(directory: string): DesignLabConfig | null {
  // 1. Check project-specific config: .opencode/design-lab.json
  // 2. Check user config: ~/.config/opencode/design-lab.json
  // 3. Return null if neither exists
}
```

**Key Insight**: Config loading should check multiple locations. Use the `directory` from `PluginInput` for project-specific paths.

### Conditional Registration Pattern

```typescript
export const DesignLab: Plugin = async (ctx) => {
  const pluginConfig = loadPluginConfig(ctx.directory);

  return {
    config: async (config) => {
      // Always register (no config needed)
      config.command = {
        "design-lab:init": buildInitCommand(ctx.directory),
        "design-lab:journal": buildJournalCommand(),
      };

      // Only register if config exists
      if (pluginConfig) {
        config.agent = { ... };  // Dynamic agents
        config.command = { ...config.command, ... };  // More commands
      }
    },
  };
};
```

**Key Insight**: Not all features need config. Register basic functionality unconditionally, advanced features only when configured.

---

## Config Hook Reference

**Purpose**: Register commands, agents, instructions, and skills. Runs once at startup.

**Example — Command + Agent registration** (from `opencode-design-lab`):

```typescript
config: async (config) => {
  // Register commands
  config.command = {
    ...(config.command ?? {}),
    "my-plugin:hello": {
      description: "Say hello",
      template: `Respond to the user. User said: $input`,
      agent: "my-agent",  // Optional: which agent handles this command
    },
  };

  // Register agents
  config.agent = {
    ...(config.agent ?? {}),
    "my-agent": {
      model: "claude-sonnet-4",  // Specific model for this agent
      systemPrompt: "You are a helpful assistant...",
      // Optional: temperature, topP, etc.
    },
  };

  // Register instructions (markdown files auto-injected as context)
  config.instructions = [
    ...(config.instructions ?? []),
    "/path/to/instructions.md",
  ];
}
```

**Example — Dynamic agent creation from config** (from `opencode-design-lab`):

```typescript
// User config: { "design_models": ["claude-sonnet-4", "gpt-4o"] }
for (const model of userConfig.design_models) {
  config.agent[`designer_model_${model}`] = {
    model: model,  // Each agent locked to its model
    systemPrompt: `You are a design agent using ${model}`,
  };
}
```

**Example — Skill registration** (from `opencode-firecrawl`):

```typescript
config: async (config) => {
  // Register skill directories (auto-discovered like ~/.opencode/skills/)
  config.skills ??= {};
  config.skills.paths ??= [];
  config.skills.paths.push(join(import.meta.dirname, "skills"));

  // Add instruction files
  config.instructions.push(join(import.meta.dirname, "skills", "rules", "install.md"));
};
```

**Key takeaways**:
- Commands use `$input` as user input placeholder in templates
- Commands can specify which `agent` should handle them
- Agents can be created dynamically from user config
- `config.instructions` auto-injects markdown files as LLM context
- `config.skills.paths` registers skill directories (newer feature)
