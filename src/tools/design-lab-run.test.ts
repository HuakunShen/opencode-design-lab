import type { PluginInput, ToolContext } from "@opencode-ai/plugin";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadPluginConfig } from "../config";
import {
  createAgentSession,
  extractSessionOutput,
  pollForCompletion,
} from "../utils/session-helpers";
import { createDesignLabRunTool } from "./design-lab-run";

vi.mock("../config", () => ({
  loadPluginConfig: vi.fn(),
}));

vi.mock("../utils/session-helpers", () => ({
  createAgentSession: vi.fn(),
  extractSessionOutput: vi.fn(),
  pollForCompletion: vi.fn(),
}));

const mockedLoadPluginConfig = vi.mocked(loadPluginConfig);
const mockedCreateAgentSession = vi.mocked(createAgentSession);
const mockedExtractSessionOutput = vi.mocked(extractSessionOutput);
const mockedPollForCompletion = vi.mocked(pollForCompletion);

function createCtx() {
  return {
    directory: "/tmp/project",
    client: {
      session: {
        prompt: vi.fn(async () => ({ data: { id: "message-id" } })),
        promptAsync: vi.fn(async () => ({ data: undefined })),
      },
    },
  } as unknown as PluginInput;
}

function createToolContext() {
  return {
    sessionID: "parent-session",
    messageID: "parent-message",
    agent: "build",
    directory: "/tmp/project",
    worktree: "/tmp/project",
    abort: new AbortController().signal,
    metadata: vi.fn(),
    ask: vi.fn(),
  } as unknown as ToolContext;
}

describe("design_lab_run tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedLoadPluginConfig.mockReturnValue({
      models: ["model-a", "model-b"],
      default_variant: "max",
      base_output_dir: ".design-lab",
      design_agent_temperature: 0.7,
      review_agent_temperature: 0.1,
    });
    mockedCreateAgentSession.mockResolvedValue("child-session");
    mockedPollForCompletion.mockResolvedValue(undefined);
    mockedExtractSessionOutput.mockResolvedValue("Design Lab summary");
  });

  it("runs the design_lab agent in a child session without switching the current agent", async () => {
    const ctx = createCtx();
    const tool = createDesignLabRunTool(ctx);

    const result = await tool.execute(
      {
        prompt: "Review current changes with multiple models",
        workflow: "code_review",
      },
      createToolContext(),
    );

    expect(mockedCreateAgentSession).toHaveBeenCalledWith(
      ctx,
      "parent-session",
      "Design Lab - code_review",
      "/tmp/project",
    );
    expect(ctx.client.session.promptAsync).toHaveBeenCalledWith({
      path: { id: "child-session" },
      body: expect.objectContaining({
        agent: "design_lab",
        parts: [
          {
            type: "text",
            text: expect.stringContaining(
              "Review current changes with multiple models",
            ),
          },
        ],
      }),
    });
    expect(ctx.client.session.promptAsync).toHaveBeenCalledWith({
      path: { id: "child-session" },
      body: expect.objectContaining({
        parts: [
          {
            type: "text",
            text: expect.stringContaining("Workflow: code_review"),
          },
        ],
      }),
    });
    expect(ctx.client.session.prompt).not.toHaveBeenCalled();
    expect(mockedPollForCompletion).toHaveBeenCalledWith(
      ctx,
      "child-session",
      expect.any(AbortSignal),
    );
    expect(result).toContain("Design Lab summary");
  });

  it("returns init guidance without creating a session when config is missing", async () => {
    mockedLoadPluginConfig.mockReturnValue(null);
    const ctx = createCtx();
    const tool = createDesignLabRunTool(ctx);

    const result = await tool.execute(
      { prompt: "Run multi-model review", workflow: "auto" },
      createToolContext(),
    );

    expect(result).toContain("/design-lab:init");
    expect(mockedCreateAgentSession).not.toHaveBeenCalled();
    expect(ctx.client.session.prompt).not.toHaveBeenCalled();
    expect(ctx.client.session.promptAsync).not.toHaveBeenCalled();
  });
});
