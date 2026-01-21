import type { PluginInput } from "@opencode-ai/plugin";
import type { DesignLabConfig, DesignSettings } from "../config/schema";
import type { DesignArtifact } from "../schemas";
import type { DesignReview, Score } from "../schemas";
import {
  DESIGN_GENERATION_PROMPT,
  QUALITATIVE_REVIEW_PROMPT,
  TOPIC_GENERATION_PROMPT,
  buildQuantitativeScoringPrompt,
} from "../prompts";
import { log, logger } from "../utils/logger";

export interface AgentConfig {
  model: string;
  prompt: string;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  tools?: Record<string, boolean>;
}

export async function createTopicGenerationAgent(
  ctx: PluginInput,
  config: DesignLabConfig,
): Promise<AgentConfig> {
  const model = config.topic_generation_model || config.design_models[0];

  return {
    model,
    prompt: TOPIC_GENERATION_PROMPT,
    temperature: 0.5,
    top_p: 0.9,
    max_tokens: 50,
    tools: {},
  };
}

export async function createDesignAgent(
  ctx: PluginInput,
  model: string,
  config: DesignLabConfig,
): Promise<AgentConfig> {
  log(`createDesignAgent: ${model}`)
  const settings: DesignSettings = config.design || {};

  return {
    model,
    prompt: settings.agent_prompt || DESIGN_GENERATION_PROMPT,
    temperature: settings.temperature ?? 0.7,
    top_p: settings.top_p ?? 0.9,
    max_tokens: settings.max_tokens ?? 4000,
    tools: {
      read: true,
      write: true,
      bash: false,
      webfetch: false,
      task: false,
    },
  };
}

export async function createQualitativeReviewAgent(
  ctx: PluginInput,
  model: string,
  config: DesignLabConfig,
): Promise<AgentConfig> {
  return {
    model,
    prompt: QUALITATIVE_REVIEW_PROMPT,
    temperature: 0.5,
    top_p: 0.9,
    max_tokens: 3000,
    tools: {
      read: true,
      write: false,
      bash: false,
      webfetch: false,
      task: false,
    },
  };
}

export async function createQuantitativeScoringAgent(
  ctx: PluginInput,
  model: string,
  config: DesignLabConfig,
  criteria: import("../config/schema").ScoringCriteria[],
): Promise<AgentConfig> {
  return {
    model,
    prompt: buildQuantitativeScoringPrompt(criteria),
    temperature: 0.3,
    top_p: 0.9,
    max_tokens: 2000,
    tools: {
      read: true,
      write: false,
      bash: false,
      webfetch: false,
      task: false,
    },
  };
}

export async function invokeAgent<T>(
  ctx: PluginInput,
  sessionID: string,
  directory: string,
  agentConfig: AgentConfig,
  promptVariables: Record<string, string>,
): Promise<T> {
  log(`invokeAgent: ${agentConfig.model}`)
  let prompt = agentConfig.prompt;

  for (const [key, value] of Object.entries(promptVariables)) {
    const placeholder = `{{${key}}}`;
    prompt = prompt.replace(new RegExp(placeholder, "g"), value);
  }

  try {
    const [providerID, modelID] = agentConfig.model.split("/");
    if (!providerID || !modelID) {
      throw new Error(`Invalid model format: ${agentConfig.model}. Expected format: providerID/modelID`);
    }

    await ctx.client.session.prompt({
      path: { id: sessionID },
      body: {
        parts: [{ type: "text", text: prompt }],
        model: { providerID, modelID },
        tools: agentConfig.tools,
      },
      query: { directory },
    });

    // Poll for session completion
    const POLL_INTERVAL_MS = 500;
    const MAX_POLL_TIME_MS = 10 * 60 * 1000; // 10 minutes max
    const pollStart = Date.now();
    let lastMsgCount = 0;
    let stablePolls = 0;
    const STABILITY_REQUIRED = 3;

    while (Date.now() - pollStart < MAX_POLL_TIME_MS) {
      const elapsed = Date.now() - pollStart;
      if (elapsed > 10000) { // Only check stability after 10s
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      const statusResult = await ctx.client.session.status();
      const allStatuses = (statusResult.data ?? {}) as Record<
        string,
        { type: string }
      >;
      const sessionStatus = allStatuses[sessionID];

      if (sessionStatus && sessionStatus.type !== "idle") {
        stablePolls = 0;
        lastMsgCount = 0;
        continue;
      }

      const messagesCheck = await ctx.client.session.messages({
        path: { id: sessionID },
      });

      if (messagesCheck.error) {
        throw new Error(
          `Failed to check messages during polling: ${messagesCheck.error}`,
        );
      }

      const msgs = messagesCheck.data as Array<unknown>;
      const currentMsgCount = msgs.length;

      if (currentMsgCount > 0 && currentMsgCount === lastMsgCount) {
        stablePolls++;
        if (stablePolls >= STABILITY_REQUIRED) {
          break;
        }
      } else {
        stablePolls = 0;
        lastMsgCount = currentMsgCount;
      }
    }

    const messagesResult = await ctx.client.session.messages({
      path: { id: sessionID },
    });

    if (messagesResult.error) {
      throw new Error(`Failed to get messages: ${messagesResult.error}`);
    }

    const messages = messagesResult.data;
    const lastAssistantMessage = messages
      .filter((m: { info: { role: string } }) => m.info.role === "assistant")
      .sort(
        (
          a: { info: { time?: { created?: number } } },
          b: { info: { time?: { created?: number } } },
        ) => (b.info.time?.created || 0) - (a.info.time?.created || 0),
      )[0];

    if (!lastAssistantMessage) {
      throw new Error("No assistant message found");
    }

    const textParts = lastAssistantMessage.parts.filter(
      (p: { type: string }) => p.type === "text",
    ) as Array<{ type: "text"; text: string }>;
    let responseText = textParts.map((p) => p.text).join("\n");

    // Strip Markdown code blocks if present
    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
    const match = responseText.match(codeBlockRegex);
    if (match) {
      responseText = match[1];
    }

    try {
      const parsed = JSON.parse(responseText);
      return parsed as T;
    } catch (parseError) {
      throw new Error(
        `Failed to parse agent response as JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}\nResponse text: ${responseText}`,
      );
    }
  } catch (error) {
    throw new Error(
      `Agent invocation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function invokeDesignAgent(
  ctx: PluginInput,
  sessionID: string,
  directory: string,
  model: string,
  config: DesignLabConfig,
  task: string,
  requirements: string,
  constraints: string,
  nonFunctionalRequirements: string,
): Promise<DesignArtifact> {
  log(`invokeDesignAgent: ${model}`)
  const agentConfig = await createDesignAgent(ctx, model, config);

  return invokeAgent<DesignArtifact>(ctx, sessionID, directory, agentConfig, {
    task_description: task,
    requirements: requirements || "None specified",
    constraints: constraints || "None specified",
    non_functional_requirements: nonFunctionalRequirements || "None specified",
  });
}

export async function invokeQualitativeReviewAgent(
  ctx: PluginInput,
  sessionID: string,
  directory: string,
  model: string,
  config: DesignLabConfig,
  design: DesignArtifact,
  task: string,
  requirements: string,
  constraints: string,
  nonFunctionalRequirements: string,
): Promise<DesignReview> {
  const agentConfig = await createQualitativeReviewAgent(ctx, model, config);

  return invokeAgent<DesignReview>(ctx, sessionID, directory, agentConfig, {
    design_json: JSON.stringify(design, null, 2),
    task_description: task,
    requirements: requirements || "None specified",
    constraints: constraints || "None specified",
    non_functional_requirements: nonFunctionalRequirements || "None specified",
  });
}

export async function invokeQuantitativeScoringAgent(
  ctx: PluginInput,
  sessionID: string,
  directory: string,
  model: string,
  config: DesignLabConfig,
  criteria: import("../config/schema").ScoringCriteria[],
  design: DesignArtifact,
  task: string,
  requirements: string,
  constraints: string,
  nonFunctionalRequirements: string,
): Promise<Score[]> {
  const agentConfig = await createQuantitativeScoringAgent(
    ctx,
    model,
    config,
    criteria,
  );

  return invokeAgent<Score[]>(ctx, sessionID, directory, agentConfig, {
    design_json: JSON.stringify(design, null, 2),
    task_description: task,
    requirements: requirements || "None specified",
    constraints: constraints || "None specified",
    non_functional_requirements: nonFunctionalRequirements || "None specified",
  });
}
