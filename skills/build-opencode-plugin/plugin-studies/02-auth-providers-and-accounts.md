# Auth, Providers, and Accounts

> **Stars**: 10,280 | **Plugin**: opencode-antigravity-auth | **Pattern**: Auth + Provider + Tool + Event hooks

## Architecture Overview

This is the most comprehensive example of **auth** and **provider** hooks in the ecosystem. It shows:

1. OAuth flow with Google Antigravity
2. Multi-account management with rotation
3. Custom `fetch` override for LLM requests
4. Rate limit handling with exponential backoff
5. Token refresh and cache strategies
6. TUI-integrated toasts and notifications
7. Custom tool registration (`google_search`)

## How It Uses the Auth Hook

**Purpose**: Handle authentication with AI providers (OAuth, API keys, custom fetch).

**Example — Custom fetch with retry and token refresh** (from `opencode-antigravity-auth`, 10,280 stars):

```typescript
auth: {
  provider: "my-provider",
  loader: async (getAuth, provider) => {
    const auth = await getAuth();  // Get current auth state

    return {
      apiKey: "",  // Empty if using custom fetch
      async fetch(input, init) {
        // Intercept EVERY LLM API call
        const latestAuth = await getAuth();

        const headers = {
          ...init?.headers,
          "Authorization": `Bearer ${latestAuth.access}`,
          "x-project-id": latestAuth.projectId,
        };

        let response = await fetch(input, { ...init, headers });

        // Token refresh on 401
        if (response.status === 401) {
          const newToken = await refreshToken(latestAuth.refresh);
          headers["Authorization"] = `Bearer ${newToken.access}`;
          response = await fetch(input, { ...init, headers });
        }

        // Rate limit retry with backoff
        if (response.status === 429) {
          const retryAfter = response.headers.get("retry-after-ms");
          await sleep(Number(retryAfter) || 1000);
          response = await fetch(input, { ...init, headers });
        }

        return response;
      }
    };
  },
  methods: [{
    type: "oauth",
    label: "Login with My Provider",
    authorize(inputs) {
      // Return OAuth URL for browser login
      return {
        url: "https://provider.com/oauth/authorize?...",
        instructions: "Open the URL in your browser and follow the instructions."
      };
    },
    // Manual code entry fallback
    callback(code) {
      return exchangeCodeForToken(code);
    }
  }]
}
```

**Example — API key auth** (from `opencode-openai-codex-auth`, 2,017 stars):

```typescript
auth: {
  provider: "codex",
  loader: async (getAuth) => {
    return {
      apiKey: process.env.OPENAI_API_KEY || "",  // Simple API key auth
    };
  },
  methods: [{
    type: "api",
    label: "OpenAI API Key",
    prompts: [{
      type: "text",
      key: "apiKey",
      message: "Enter your OpenAI API key:",
    }],
    authorize(inputs) {
      return { type: "success", key: inputs.apiKey };
    }
  }]
}
```

**Key takeaways**:
- The `loader` returns `{ apiKey }` for simple auth, or `{ apiKey, fetch }` for custom fetch
- Custom `fetch` intercepts every LLM API call — use for: token injection, refresh, retry, rate limiting, request/response transformation
- `auth.methods` defines how users authenticate (OAuth or API key)
- `getAuth()` returns the current OpenCode auth state (tokens, expiry, project info)
- Proactive token refresh: refresh tokens 5 minutes before expiry (see antigravity-auth's `createProactiveRefreshQueue`)
- Rate limit patterns: track per-account 429s, rotate accounts, exponential backoff

## How It Uses the Provider Hook

**Purpose**: Register custom AI providers and their models.

**Example — Dynamic model registration** (from `opencode-antigravity-auth`):

```typescript
provider: {
  id: "antigravity",
  models: async (provider, ctx) => {
    // Discover available models from the provider
    const models = await fetchAvailableModels(ctx.auth);
    return {
      "gemini-2.5-pro": {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        context: 1_000_000,
        cost: { input: 1.25, output: 10.00 },
      },
      // ...more models
    };
  },
}
```

**Key takeaways**:
- `provider.id` identifies the provider
- `provider.models` dynamically resolves available models
- Set `cost: { input: 0, output: 0 }` in the auth loader to hide costs for custom providers

## How It Registers Custom Tools

```typescript
const googleSearchTool = tool({
  description: "Search the web using Google Search...",
  args: {
    query: tool.schema.string().describe("The search query"),
    urls: tool.schema.array(tool.schema.string()).optional(),
    thinking: tool.schema.boolean().optional().default(true),
  },
  async execute(args, ctx) {
    // Uses the auth context to make authenticated API calls
    const auth = cachedGetAuth ? await cachedGetAuth() : null;
    // ...search implementation
    return executeSearch({ query, urls, thinking }, accessToken, projectId, ctx.abort);
  },
});

return {
  tool: {
    google_search: googleSearchTool,
  }
};
```

**Key Insight**: Tools can access the auth context via the `getAuth` function cached during the auth loader execution. The `ctx.abort` signal should be respected for cancellation.

## How It Uses the Event Hook

```typescript
event: async (input) => {
  // Handle session.created - detect child sessions for toast filtering
  if (input.event.type === "session.created") {
    const props = input.event.properties;
    if (props?.info?.parentID) {
      isChildSession = true;
    }
  }
  
  // Handle session.error - auto-recovery
  if (input.event.type === "session.error") {
    const error = props?.error;
    if (isRecoverableError(error)) {
      await handleSessionRecovery(messageInfo);
      // Auto-continue the session
      await client.session.prompt({
        path: { id: sessionID },
        body: { parts: [{ type: "text", text: "continue" }] },
        query: { directory },
      });
    }
  }
}
```

**Key Insight**: The event hook handles lifecycle events. `session.error` enables auto-recovery. `session.created` lets plugins track session hierarchies (parent/child).

## Rate Limiting & Retry Pattern

```typescript
// Token bucket rate limiting
initTokenTracker({
  maxTokens: config.max_tokens,
  regenerationRatePerMinute: config.regeneration_rate_per_minute,
});

// Exponential backoff with account rotation
function getRateLimitBackoff(accountIndex, quotaKey, serverRetryAfterMs, maxBackoffMs) {
  // Track consecutive 429s per account+quota
  // Rotate to next account when threshold exceeded
  // Use server's retry-after header when available
}

// Proactive token refresh before expiry
refreshQueue = createProactiveRefreshQueue(client, providerId, {
  bufferSeconds: 300,  // Refresh 5 min before expiry
  checkIntervalSeconds: 60,
});
```

**Key Insight**: Production auth plugins need sophisticated rate limiting with:
- Account rotation (multiple API keys/accounts)
- Token bucket rate limiting per account
- Proactive token refresh before expiry
- Exponential backoff with jitter

## TUI Toast Integration

```typescript
await client.tui.showToast({
  body: { 
    title: "Rate Limit",
    message: `Rate limited, waiting ${delay}s`,
    variant: "warning"  // "info" | "warning" | "success" | "error"
  },
});
```

**Key Insight**: `client.tui.showToast` shows user-facing notifications. Useful for rate limit warnings, auth success/failure, and status updates.

## Configuration Loading

```typescript
const config = loadConfig(directory);  // From files + env vars
initRuntimeConfig(config);              // Apply to runtime
```

**Key Insight**: Config can be loaded from multiple sources: plugin config file, environment variables, OpenCode user config. The `directory` from `PluginInput` is the project root.
