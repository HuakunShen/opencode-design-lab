# Context Manipulation and Permissions

> **Stars**: 2,495 | **Plugin**: opencode-dynamic-context-pruning | **Pattern**: Chat Hooks + Token Management + Permission Control

## Architecture Overview

This plugin optimizes LLM context windows by:

1. `chat.params` hook: Modify model parameters before API calls
2. `chat.message` hook: Compress/reorganize messages
3. `chat.headers` hook: Add custom headers
4. `permission.ask` hook: Control tool permissions
5. `experimental.chat.system.transform` hook: Modify system prompts
6. `experimental.chat.messages.transform` hook: Transform entire message arrays
7. Token counting and context window awareness

## How It Uses chat.params

**Purpose**: Modify LLM parameters before each API call.

**Example — Dynamic token limit** (from `opencode-dynamic-context-pruning`, 2,495 stars):

```typescript
"chat.params": async (input, output) => {
  // input: { sessionID, agent, model, provider, message }
  // output: { temperature, topP, topK, maxOutputTokens, options }

  const availableTokens = await getAvailableContext(input.sessionID, input.model);
  output.maxOutputTokens = Math.min(output.maxOutputTokens || 4096, availableTokens);

  // Adjust temperature during compression
  if (isCompressionPass) {
    output.temperature = 0.1;
  }
}
```

**Key takeaways**:

- `output.maxOutputTokens` limits response length
- `output.temperature` controls creativity (0 = deterministic, 1 = creative)
- `output.topP` nucleus sampling parameter
- `output.options` passes provider-specific options

## How It Uses chat.headers

**Purpose**: Add custom HTTP headers to LLM API requests.

```typescript
"chat.headers": async (input, output) => {
  // Add tracking/analytics headers
  output.headers["X-Plugin-Version"] = "1.0.0";
  output.headers["X-Context-State"] = isCompressed ? "compressed" : "normal";
}
```

**Key Insight**: `chat.headers` for injecting custom HTTP headers into LLM API calls. Useful for tracking, logging, or provider-specific features.

## How It Uses Message Transform Hooks

```typescript
// Transform individual messages
"chat.message": async (input, output) => {
  // Compress long messages, remove redundant content
  for (const part of output.parts) {
    if (part.type === "text" && part.text.length > MAX_PART_LENGTH) {
      part.text = await compressMessage(part.text);
    }
  }
}

// Transform entire message array (before sending to LLM)
"experimental.chat.messages.transform": async (input, output) => {
  // Reorganize, prune, or compress the full message history
  output.messages = await pruneMessages(output.messages, maxTokens);
}

// Transform system prompt
"experimental.chat.system.transform": async (input, output) => {
  // Add context window info to system prompt
  output.system.push(`Available context: ${availableTokens} tokens remaining`);
}
```

**Key Insight**: Three levels of message manipulation:

1. `chat.message` — per-message, before sending
2. `experimental.chat.messages.transform` — the full message array
3. `experimental.chat.system.transform` — the system prompt array

## How It Uses permission.ask

**Purpose**: Control whether a tool execution should be allowed.

```typescript
"permission.ask": async (input, output) => {
  // input: { sessionID, tool, permission, args }
  // output: { status: "ask" | "deny" | "allow" }

  // Auto-deny expensive operations when context is critical
  if (isContextCritical && input.tool === "write") {
    output.status = "deny";
  }

  // Auto-allow safe operations
  if (input.tool === "read") {
    output.status = "allow";
  }
}
```

**Key Insight**: `permission.ask` gives plugins control over tool permissions. Can auto-allow or auto-deny based on context state. Status options: "ask" (default), "allow" (auto-approve), "deny" (auto-reject).

## Experimental Hooks

**Purpose**: More intrusive message manipulation (subject to breaking changes).

**Message array transformation**:

```typescript
"experimental.chat.messages.transform": async (input, output) => {
  // output.messages is the full array of { info: Message, parts: Part[] }
  // Can prune, reorder, or compress the entire conversation history
  output.messages = await pruneMessages(output.messages, maxTokens);
}
```

**System prompt transformation**:

```typescript
"experimental.chat.system.transform": async (input, output) => {
  // output.system is string[] (system prompt lines)
  output.system.push(`Available context: ${availableTokens} tokens`);
}
```

**Session compaction**:

```typescript
"experimental.session.compacting": async (input, output) => {
  // Called before compaction starts
  output.context.push("Preserve key architectural decisions.");
  // output.prompt = "..." // Override the compaction prompt entirely
}

"experimental.compaction.autocontinue": async (input, output) => {
  output.enabled = false;  // Skip auto-continue after compaction
}
```

> **Warning**: Experimental hooks are subject to breaking changes. Use with caution and pin to specific plugin versions.
