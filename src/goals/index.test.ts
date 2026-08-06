import { describe, expect, it } from "vitest";
import type { DesignLabConfig } from "../config/schema";
import { createGoalsHooks } from "./index";

const CONFIG: DesignLabConfig = {
  models: ["opencode/kimi-k2.6", "opencode/gpt-5.4"],
  default_variant: "max",
  base_output_dir: ".design-lab",
  design_agent_temperature: 0.5,
  review_agent_temperature: 0.1,
  // Keep goal persistence out of the repo during tests.
  goals: { persist_state: false } as DesignLabConfig["goals"],
};

function mockClient() {
  return {
    session: {
      messages: async () => ({ data: [] }),
      promptAsync: async () => ({ data: { id: "m1" } }),
      abort: async () => ({}),
    },
    app: { log: async () => {} },
  } as unknown as Parameters<typeof createGoalsHooks>[0];
}

function hooks() {
  return createGoalsHooks(mockClient(), () => CONFIG);
}

describe("createGoalsHooks", () => {
  it("returns the hooks surface with all goal hooks", () => {
    expect(hooks()).toMatchObject({
      event: expect.any(Function),
      "command.execute.before": expect.any(Function),
      "chat.message": expect.any(Function),
      "tool.execute.before": expect.any(Function),
      "experimental.session.compacting": expect.any(Function),
      "experimental.compaction.autocontinue": expect.any(Function),
      "experimental.chat.system.transform": expect.any(Function),
    });
    expect(hooks().tool).toBeDefined();
  });

  it("config hook registers the goal command", async () => {
    const config: Record<string, unknown> = {};
    await hooks().config?.(config as never);
    const commands = (config as { command?: Record<string, unknown> }).command;
    expect(commands?.goal).toBeDefined();
  });

  it("registers goal tools on the tool hook", () => {
    const names = Object.keys(hooks().tool ?? {});
    expect(names).toEqual(
      expect.arrayContaining([
        "goal_status",
        "goal_set",
        "goal_pause",
        "goal_resume",
        "goal_block",
        "goal_complete",
      ]),
    );
  });

  it("compaction.autocontinue returns false while a goal is active", async () => {
    const h = hooks();
    // Create a goal via the command path first.
    const cmdOutput = { parts: [{ type: "text", text: "fix tests" }] };
    await h["command.execute.before"]?.(
      {
        sessionID: "s1",
        command: "goal",
        arguments: "fix the failing tests",
      } as never,
      cmdOutput as never,
    );
    const output = { enabled: true };
    await h["experimental.compaction.autocontinue"]?.(
      { sessionID: "s1" } as never,
      output as never,
    );
    expect(output.enabled).toBe(false);
  });

  it("command.execute.before intercepts /goal and replaces the turn", async () => {
    const output = { parts: [{ type: "text", text: "fix tests" }] };
    await hooks()["command.execute.before"]?.(
      {
        sessionID: "s1",
        command: "goal",
        arguments: "fix the failing tests",
      } as never,
      output as never,
    );
    expect(output.parts[0].text).toContain("<goal_objective>");
    expect(output.parts[0].text).toContain("fix the failing tests");
  });

  it("does not treat a control-like condition as a control subcommand", async () => {
    const output = { parts: [{ type: "text", text: "fix tests" }] };
    await hooks()["command.execute.before"]?.(
      {
        sessionID: "s1",
        command: "goal",
        arguments: "stop the leak",
      } as never,
      output as never,
    );
    // "stop the leak" is a goal condition, not the /goal stop subcommand.
    expect(output.parts[0].text).toContain("<goal_objective>");
    expect(output.parts[0].text).toContain("stop the leak");
  });

  it("treats /goal status as a control subcommand", async () => {
    const output = { parts: [{ type: "text", text: "fix tests" }] };
    await hooks()["command.execute.before"]?.(
      {
        sessionID: "s1",
        command: "goal",
        arguments: "status",
      } as never,
      output as never,
    );
    expect(output.parts[0].text).toContain("<goal_command_result>");
  });

  it("does not fire a continuation on a non-idle session.status event", async () => {
    const h = hooks();
    const cmdOutput = { parts: [{ type: "text", text: "fix tests" }] };
    await h["command.execute.before"]?.(
      { sessionID: "s1", command: "goal", arguments: "fix tests" } as never,
      cmdOutput as never,
    );
    // A busy status must NOT default to idle (which would fire a continuation)
    // and must not be mistaken for a plan-agent switch that stops the goal.
    await h["event"]?.({
      event: {
        type: "session.status",
        properties: { sessionID: "s1", status: { type: "busy" } },
      },
    } as never);
    // The goal stays active (not stopped by plan-agent handling).
    const { goalStates } = await import("./state");
    expect(goalStates.get("s1")?.stopped).toBe(false);
  });

  it("tool.execute.before blocks tools during a control turn", async () => {
    const h = hooks();
    const output = { parts: [{ type: "text", text: "fix tests" }] };
    await h["command.execute.before"]?.(
      { sessionID: "s1", command: "goal", arguments: "status" } as never,
      output as never,
    );
    await expect(
      h["tool.execute.before"]?.({ sessionID: "s1", tool: "read" } as never, {} as never),
    ).rejects.toThrow();
  });

  it("archives the goal when the assistant emits evidence-gated completion", async () => {
    const h = hooks();
    const { goalStates, lastGoalResults } = await import("./state");
    // Create a goal.
    const cmdOutput = { parts: [{ type: "text", text: "fix tests" }] };
    await h["command.execute.before"]?.(
      { sessionID: "s1", command: "goal", arguments: "fix tests" } as never,
      cmdOutput as never,
    );
    const goal = goalStates.get("s1");
    expect(goal).toBeDefined();
    if (!goal) return;
    // Simulate the assistant ending a turn with evidence + completion.
    goal.lastAssistantText =
      "ran the suite\n[goal:evidence] all tests pass\n[goal:complete]";
    goal.turnCount = 1;
    // Fire an idle event; the idle handler should archive the goal.
    await h["event"]?.({
      event: { type: "session.idle", properties: { sessionID: "s1" } },
    } as never);
    expect(goalStates.has("s1")).toBe(false);
    expect(lastGoalResults.get("s1")?.state).toBe("achieved");
    expect(lastGoalResults.get("s1")?.evidence).toContain("all tests pass");
  });

  it("pauses the goal as blocked when the assistant states a blocker", async () => {
    const h = hooks();
    const { goalStates } = await import("./state");
    const cmdOutput = { parts: [{ type: "text", text: "deploy" }] };
    await h["command.execute.before"]?.(
      { sessionID: "s1", command: "goal", arguments: "deploy" } as never,
      cmdOutput as never,
    );
    const goal = goalStates.get("s1");
    expect(goal).toBeDefined();
    if (!goal) return;
    goal.lastAssistantText =
      "The deploy step needs a production API token.\n[goal:blocked]";
    goal.turnCount = 1;
    await h["event"]?.({
      event: { type: "session.idle", properties: { sessionID: "s1" } },
    } as never);
    expect(goal.stopped).toBe(true);
    expect(goal.stopReason).toBe("blocked");
    expect(goal.blockedReason).toContain("production API token");
  });

  it("rejects an unsubstantiated completion and keeps the goal running", async () => {
    const h = hooks();
    const { goalStates } = await import("./state");
    const cmdOutput = { parts: [{ type: "text", text: "fix tests" }] };
    await h["command.execute.before"]?.(
      { sessionID: "s1", command: "goal", arguments: "fix tests" } as never,
      cmdOutput as never,
    );
    const goal = goalStates.get("s1");
    expect(goal).toBeDefined();
    if (!goal) return;
    // Bare [goal:complete] with no evidence line must be rejected.
    goal.lastAssistantText = "done\n[goal:complete]";
    goal.turnCount = 1;
    await h["event"]?.({
      event: { type: "session.idle", properties: { sessionID: "s1" } },
    } as never);
    expect(goalStates.has("s1")).toBe(true);
    expect(goal.stopped).toBe(false);
    expect(goal.formatFailures).toBeGreaterThan(0);
  });

  it("accounts assistant tokens toward the context budget", async () => {
    // Custom client whose messages carry a token-bearing assistant turn.
    const client = {
      session: {
        messages: async () => ({
          data: [
            {
              info: {
                role: "assistant",
                tokens: { input: 100, output: 50, reasoning: 10, total: 160 },
              },
              parts: [{ type: "text", text: "made progress on the task" }],
            },
          ],
        }),
        promptAsync: async () => ({ data: { id: "m1" } }),
        abort: async () => ({}),
      },
      app: { log: async () => {} },
    } as unknown as Parameters<typeof createGoalsHooks>[0];
    const h = createGoalsHooks(client, () => CONFIG);
    const { goalStates } = await import("./state");
    const cmdOutput = { parts: [{ type: "text", text: "fix tests" }] };
    await h["command.execute.before"]?.(
      { sessionID: "s1", command: "goal", arguments: "fix tests" } as never,
      cmdOutput as never,
    );
    const goal = goalStates.get("s1");
    expect(goal).toBeDefined();
    if (!goal) return;
    goal.turnCount = 1;
    await h["event"]?.({
      event: { type: "session.idle", properties: { sessionID: "s1" } },
    } as never);
    expect(goal.totalTokens).toBe(160);
    expect(goal.usage.input).toBe(100);
  });

  it("pauses after repeated low-progress turns", async () => {
    // A client that reports a real assistant turn with tiny output and no
    // tool calls (a stalled turn) across repeated idles.
    const client = {
      session: {
        messages: async () => ({
          data: [
            {
              info: { role: "assistant", tokens: { output: 3, input: 10 } },
              parts: [{ type: "text", text: "hmm" }],
            },
          ],
        }),
        promptAsync: async () => ({ data: { id: "m1" } }),
        abort: async () => ({}),
      },
      app: { log: async () => {} },
    } as unknown as Parameters<typeof createGoalsHooks>[0];
    const h = createGoalsHooks(client, () => CONFIG);
    const { goalStates } = await import("./state");
    const cmdOutput = { parts: [{ type: "text", text: "fix tests" }] };
    await h["command.execute.before"]?.(
      { sessionID: "s1", command: "goal", arguments: "fix tests" } as never,
      cmdOutput as never,
    );
    const goal = goalStates.get("s1");
    expect(goal).toBeDefined();
    if (!goal) return;
    goal.turnCount = 1;
    // Two idle events with a stalled low-output turn pause the goal.
    for (let i = 0; i < 2; i += 1) {
      await h["event"]?.({
        event: { type: "session.idle", properties: { sessionID: "s1" } },
      } as never);
    }
    expect(goal.stopped).toBe(true);
    expect(goal.stopReason).toBe("no progress");
  });

  it("handles /goal add by backgrounding the current goal", async () => {
    const h = hooks();
    const { goalStates } = await import("./state");
    const out1 = { parts: [{ type: "text", text: "one" }] };
    await h["command.execute.before"]?.(
      { sessionID: "s1", command: "goal", arguments: "first goal" } as never,
      out1 as never,
    );
    const first = goalStates.get("s1");
    const out2 = { parts: [{ type: "text", text: "two" }] };
    await h["command.execute.before"]?.(
      { sessionID: "s1", command: "goal", arguments: "add second goal" } as never,
      out2 as never,
    );
    expect(first?.stopped).toBe(true);
    expect(first?.stopReason).toBe("backgrounded");
    expect(goalStates.get("s1")?.condition).toBe("second goal");
    expect(out2.parts[0].text).toContain("<goal_objective>");
  });

  it("handles /goal sequence by queuing objectives", async () => {
    const h = hooks();
    const { goalStates } = await import("./state");
    const out = { parts: [{ type: "text", text: "seq" }] };
    await h["command.execute.before"]?.(
      { sessionID: "s1", command: "goal", arguments: "sequence build parser; write tests; ship" } as never,
      out as never,
    );
    const focused = goalStates.get("s1");
    expect(focused?.condition).toBe("build parser");
    expect(focused?.stopped).toBe(false);
    expect(out.parts[0].text).toContain("<goal_objective>");
  });
});
