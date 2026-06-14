# Tools, Chat Hooks, and External APIs

> **Stars**: 1,102 | **Plugin**: opencode-supermemory | **Pattern**: Tool + Chat Hook + Event Hook + External API Integration

## Architecture Overview

A clean, well-structured example of integrating an external API (Supermemory) with:

1. `chat.message` hook for context injection and memory triggers
2. `tool` registration for CRUD memory operations
3. `event` hook for session compaction
4. Structured service layer (services/client.ts, services/context.ts, etc.)

## How It Uses the chat.message Hook

```typescript
"chat.message": async (input, output) => {
  // 1. Detect memory-related keywords in user messages
  if (detectMemoryKeyword(userMessage)) {
    // Inject a "nudge" that prompts the AI to use the supermemory tool
    output.parts.push({
      id: `prt_supermemory-nudge-${Date.now()}`,
      sessionID: input.sessionID,
      messageID: output.message.id,
      type: "text",
      text: MEMORY_NUDGE_MESSAGE,  // "The user wants you to remember something..."
      synthetic: true,               // Marked as synthetic so it doesn't show to user
    });
  }

  // 2. On first message of a session, inject relevant memories
  if (isFirstMessage) {
    const [profile, userMemories, projectMemories] = await Promise.all([
      supermemoryClient.getProfile(tags.user, userMessage),
      supermemoryClient.searchMemories(userMessage, tags.user),
      supermemoryClient.listMemories(tags.project, maxMemories),
    ]);

    const memoryContext = formatContextForPrompt(profile, userMemories, projectMemories);

    if (memoryContext) {
      output.parts.unshift({
        id: `prt_supermemory-context-${Date.now()}`,
        sessionID: input.sessionID,
        messageID: output.message.id,
        type: "text",
        text: memoryContext,  // Formatted memory context for the AI
        synthetic: true,
      });
    }
  }
}
```

**Key Insight**: The `chat.message` hook lets plugins:

- Read the user's message from `output.parts`
- Inject synthetic parts (invisible to user) into `output.parts` via `parts.push()` or `parts.unshift()`
- Use `input.sessionID` to track per-session state
- Use `input.agent` to know which agent is processing
- Use `input.model` to know which model is being used

## Output Part Structure

```typescript
type Part = {
  id: string; // Unique part ID
  sessionID: string; // Session this part belongs to
  messageID: string; // Parent message ID
  type: "text"; // Part type
  text: string; // Part content
  synthetic: boolean; // true = hidden from user, only visible to LLM
};
```

**Key Insight**: `synthetic: true` is crucial — it injects context only for the LLM, not in the chat UI. This is the primary way to add context.

## How It Registers the Tool

**Purpose**: Register custom tools that the AI can call during conversations.

**Example — CRUD tool with enum args** (from `opencode-supermemory`, 1,102 stars):

```typescript
import { tool } from "@opencode-ai/plugin";

return {
  tool: {
    supermemory: tool({
      description: "Manage persistent memory. Use 'search' to find, 'add' to store, 'forget' to remove.",
      args: {
        mode: tool.schema
          .enum(["add", "search", "profile", "list", "forget", "help"])
          .optional(),
        content: tool.schema.string().optional(),
        query: tool.schema.string().optional(),
        type: tool.schema
          .enum(["preference", "project-config", "error-solution", "learned-pattern"])
          .optional(),
        scope: tool.schema.enum(["user", "project"]).optional(),
        memoryId: tool.schema.string().optional(),
        limit: tool.schema.number().optional(),
      },
      async execute(args) {
        switch (args.mode) {
          case "add":
            return JSON.stringify({ success: true, message: "Memory stored" });
          case "search":
            return JSON.stringify({ success: true, results: [...] });
          default:
            return JSON.stringify({ success: false, error: "Unknown mode" });
        }
      },
    }),
  },
};
```

**Example — Tool with auth context access** (from `opencode-antigravity-auth`, 10,280 stars):

```typescript
const googleSearchTool = tool({
  description: "Search the web using Google Search...",
  args: {
    query: tool.schema.string().describe("The search query"),
    urls: tool.schema.array(tool.schema.string()).optional(),
    thinking: tool.schema.boolean().optional().default(true),
  },
  async execute(args, ctx) {
    // Access auth context via cached getAuth
    const auth = cachedGetAuth ? await cachedGetAuth() : null;
    if (!auth) return "Error: Not authenticated";

    // Make authenticated API call
    const result = await executeSearch(args, auth.accessToken);

    // Respect abort signal for cancellation
    if (ctx.abort?.aborted) return "Aborted";

    return result;
  },
});
```

**Key takeaways**:

- `tool.schema` provides Zod-like validation (`.string()`, `.enum()`, `.number()`, `.array()`, `.optional()`, `.describe()`, `.default()`)
- `execute` returns a string that the AI sees as tool output
- Return JSON strings for structured data (AI parses it well)
- The second argument `ctx` has `ctx.abort` for cancellation support
- Tools can access auth context by caching `getAuth` from the auth loader

## Tool Lifecycle Hooks

**Purpose**: Intercept and modify tool execution.

```typescript
// Before tool execution
"tool.execute.before": async (input, output) => {
  // input: { tool, sessionID, callID }
  // output: { args: any }  // Modify tool arguments
  if (input.tool === "write") {
    output.args.filePath = normalizePath(output.args.filePath);
  }
}

// After tool execution
"tool.execute.after": async (input, output) => {
  // input: { tool, sessionID, callID, args }
  // output: { title, output: string, metadata: any }
  output.title = `[Modified] ${output.title}`;
}
```

## How It Handles the Event Hook

```typescript
event: async (input) => {
  // Forward to compaction hook for memory-backed context window management
  if (compactionHook) {
    await compactionHook.event(input);
  }
};
```

**Key Insight**: Event hooks can be chained. The compaction hook uses events to detect when context windows are full and needs compression.

## Service Layer Pattern

```typescript
// src/services/client.ts - API client for external service
export const supermemoryClient = {
  searchMemories(query, tags) { ... },
  addMemory(content, tags, metadata) { ... },
  listMemories(tags, limit) { ... },
  deleteMemory(id) { ... },
  getProfile(tags, query) { ... },
};

// src/services/context.ts - Format API responses for LLM consumption
export function formatContextForPrompt(profile, userMemories, projectMemories) { ... }

// src/services/privacy.ts - Filter sensitive content
export function stripPrivateContent(content) { ... }

// src/services/logger.ts - Structured logging
export function log(message, data) { ... }
```

**Key Insight**: Separate your plugin logic into services. Keep the main plugin entry clean — it should only wire up hooks.

## Configuration Pattern

```typescript
import { CONFIG, isConfigured } from "./config.js";

// Simple env-based config
const SUPERMEMORY_API_KEY = process.env.SUPERMEMORY_API_KEY;

export function isConfigured(): boolean {
  return Boolean(SUPERMEMORY_API_KEY);
}

// Conditional plugin behavior based on config
if (!isConfigured()) {
  log("Plugin disabled - SUPERMEMORY_API_KEY not set");
}
```

**Key Insight**: Use environment variables for simple config. Check `isConfigured()` at the start of each hook to gracefully disable features.

## Model Limit Discovery

```typescript
// Fetch model context limits once at plugin init
const response = await ctx.client.provider.list();
for (const provider of response.data.all) {
  for (const [modelId, model] of Object.entries(provider.models)) {
    if (model.limit?.context) {
      modelLimits.set(`${provider.id}/${modelId}`, model.limit.context);
    }
  }
}
```

**Key Insight**: Use `ctx.client.provider.list()` to discover available models and their capabilities (context limits in this case).
