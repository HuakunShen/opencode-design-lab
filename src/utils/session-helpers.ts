import type { PluginInput } from "@opencode-ai/plugin";
import { logger } from "./logger";

/**
 * Poll interval for checking session completion
 */
const POLL_INTERVAL_MS = 500;

/**
 * Maximum time to wait for a session to complete
 */
const MAX_POLL_TIME_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Create a new agent session
 */
export async function createAgentSession(
  ctx: PluginInput,
  parentSessionID: string | undefined,
  title: string,
  directory: string,
): Promise<string> {
  logger.info({ parentSessionID, title }, "Creating agent session");

  const createResult = await ctx.client.session.create({
    body: {
      parentID: parentSessionID,
      title,
    },
    query: {
      directory,
    },
  });

  if (createResult.error) {
    logger.error({ error: createResult.error }, "Failed to create session");
    throw new Error(`Failed to create session: ${createResult.error}`);
  }

  logger.info(
    { sessionID: createResult.data.id },
    "Session created successfully",
  );
  return createResult.data.id;
}

/**
 * Send a prompt to a session with timeout
 */
export async function sendPrompt(
  ctx: PluginInput,
  sessionID: string,
  prompt: string,
  tools?: Record<string, boolean>,
): Promise<void> {
  logger.info(
    { sessionID, promptLength: prompt.length, tools },
    "Sending prompt",
  );

  // Add 180 second timeout (3 mins) to prevent infinite hangs but allow slow models
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error("Prompt send timeout after 180 seconds")),
      180000,
    ),
  );

  const sendPromise = ctx.client.session.prompt({
    path: { id: sessionID },
    body: {
      tools: {
        ...tools,
        task: false,
        delegate_task: false,
      },
      parts: [{ type: "text", text: prompt }],
    },
  });

  const result = await Promise.race([sendPromise, timeoutPromise]);

  if (result.error) {
    logger.error({ sessionID, error: result.error }, "Failed to send prompt");
    throw new Error(`Failed to send prompt: ${result.error}`);
  }

  logger.info({ sessionID }, "Prompt sent successfully");
}

/**
 * Poll for session completion
 */
export async function pollForCompletion(
  ctx: PluginInput,
  sessionID: string,
  abortSignal?: AbortSignal,
): Promise<void> {
  const pollStart = Date.now();
  let lastMsgCount = 0;
  let stablePolls = 0;
  const STABILITY_REQUIRED = 3;
  let pollCount = 0;

  logger.info({ sessionID }, "Starting polling for completion");

  while (Date.now() - pollStart < MAX_POLL_TIME_MS) {
    pollCount++;

    // Check if aborted
    if (abortSignal?.aborted) {
      logger.warn({ sessionID }, "Polling aborted by signal");
      throw new Error("Task aborted");
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    // Check session status
    const statusResult = await ctx.client.session.status();
    const allStatuses = (statusResult.data ?? {}) as Record<
      string,
      { type: string }
    >;
    const sessionStatus = allStatuses[sessionID];

    // Log status every 10 polls
    if (pollCount % 10 === 0) {
      logger.info(
        {
          sessionID,
          status: sessionStatus?.type,
          pollCount,
          elapsed: Date.now() - pollStart,
        },
        "Polling status check",
      );
    }

    // If session is actively running, reset stability counter
    if (sessionStatus && sessionStatus.type !== "idle") {
      stablePolls = 0;
      lastMsgCount = 0;
      continue;
    }

    // Session is idle - check message stability
    const messagesCheck = await ctx.client.session.messages({
      path: { id: sessionID },
    });
    const msgs = ((messagesCheck as { data?: unknown }).data ??
      messagesCheck) as Array<unknown>;
    const currentMsgCount = msgs.length;

    if (currentMsgCount > 0 && currentMsgCount === lastMsgCount) {
      stablePolls++;
      logger.debug(
        { sessionID, stablePolls, currentMsgCount },
        "Message count stable",
      );
      if (stablePolls >= STABILITY_REQUIRED) {
        logger.info(
          { sessionID, totalPolls: pollCount, elapsed: Date.now() - pollStart },
          "Session completion confirmed",
        );
        return; // Session complete
      }
    } else {
      stablePolls = 0;
      lastMsgCount = currentMsgCount;
    }
  }

  logger.error(
    { sessionID, totalPolls: pollCount, elapsed: MAX_POLL_TIME_MS },
    "Session timed out",
  );
  throw new Error("Session timed out after 10 minutes");
}

/**
 * Extract text content from session messages
 */
export async function extractSessionOutput(
  ctx: PluginInput,
  sessionID: string,
): Promise<string> {
  const messagesResult = await ctx.client.session.messages({
    path: { id: sessionID },
  });

  if (messagesResult.error) {
    throw new Error(`Failed to get messages: ${messagesResult.error}`);
  }

  const messages = messagesResult.data;

  // Filter for assistant messages
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assistantMessages = messages.filter(
    (m: any) => m.info?.role === "assistant",
  );

  if (assistantMessages.length === 0) {
    throw new Error("No assistant response found");
  }

  // Extract text from all assistant messages
  const extractedContent: string[] = [];

  for (const message of assistantMessages) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const part of (message as any).parts ?? []) {
      if ((part.type === "text" || part.type === "reasoning") && part.text) {
        extractedContent.push(part.text);
      }
    }
  }

  return extractedContent.join("\n\n");
}

/**
 * Extract JSON from text that may contain markdown code blocks
 *
 * @param text - The text to extract JSON from
 * @returns The parsed JSON object
 * @throws Error with context if parsing fails
 */
export function extractJSON<T>(text: string): T {
  try {
    // Try to extract JSON from markdown code blocks first
    const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonBlockMatch) {
      return JSON.parse(jsonBlockMatch[1].trim()) as T;
    }

    // Try to find raw JSON (object or array)
    const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]) as T;
    }

    // Try parsing the whole thing as JSON
    return JSON.parse(text.trim()) as T;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const preview = text.substring(0, 200);
    throw new Error(
      `Failed to parse JSON: ${errorMessage}\nText preview: ${preview}${text.length > 200 ? "..." : ""}`,
    );
  }
}

/**
 * Extract short model name from full model string
 * e.g., "zhipuai-coding-plan/glm-4.6" -> "glm-4.6"
 */
export function getModelShortName(modelName: string): string {
  const parts = modelName.split("/");
  return parts[parts.length - 1] || modelName;
}

/**
 * Sanitize a string for use in file/directory names
 */
export function sanitizeForFilename(text: string): string {
  return text
    .toLowerCase()
    .replace(/\//g, "-") // Convert slashes to dashes BEFORE removing special chars
    .replace(/[^a-z0-9\s-]/g, "") // Remove special characters
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-") // Collapse multiple hyphens
    .substring(0, 50); // Limit length
}
