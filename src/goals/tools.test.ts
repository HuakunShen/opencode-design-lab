import { beforeEach, describe, expect, it } from "vitest";
import type { GoalOptions } from "./config";
import { DEFAULT_GOAL_OPTIONS } from "./config";
import {
  buildGoalState,
  clearRuntimeState,
  focusGoal,
  goalStates,
  lastGoalResults,
  registerSessionGoal,
} from "./state";
import { buildAgentToolHandlers } from "./tools";

const SESSION = "session-1";
const OPTIONS: GoalOptions = { ...DEFAULT_GOAL_OPTIONS };
const persist = async () => true;

beforeEach(() => clearRuntimeState());

function activeGoal(condition: string) {
  const goal = buildGoalState(SESSION, condition, OPTIONS);
  registerSessionGoal(goal);
  focusGoal(SESSION, goal);
  return goal;
}

describe("agent tool handlers", () => {
  const handlers = buildAgentToolHandlers({
    defaultGoalOptions: OPTIONS,
    persist,
  });

  it("setGoal creates and focuses a new goal", async () => {
    const message = await handlers.setGoal(SESSION, {
      objective: "refactor auth",
    });
    expect(message).toContain("refactor auth");
    expect(goalStates.get(SESSION)?.condition).toBe("refactor auth");
  });

  it("setGoal refuses an empty objective", async () => {
    const message = await handlers.setGoal(SESSION, { objective: "  " });
    expect(message).toContain("No objective");
  });

  it("setGoal from plan agent pauses the goal", async () => {
    const message = await handlers.setGoal(
      SESSION,
      { objective: "refactor auth" },
      "plan",
    );
    expect(message).toContain("paused");
    expect(goalStates.get(SESSION)?.stopped).toBe(true);
    expect(goalStates.get(SESSION)?.stopReason).toBe("plan mode");
  });

  it("updateGoal completes with evidence and archives", async () => {
    const goal = activeGoal("fix tests");
    const message = await handlers.updateGoal(SESSION, {
      status: "complete",
      evidence: "npm test: 83 passing",
    });
    expect(message).toContain("complete");
    expect(goal.stopped).toBe(true);
    expect(goalStates.has(SESSION)).toBe(false);
    expect(lastGoalResults.get(SESSION)?.state).toBe("achieved");
  });

  it("updateGoal blocks with a concrete blocker", async () => {
    const goal = activeGoal("deploy");
    const message = await handlers.updateGoal(SESSION, {
      status: "blocked",
      blocker: "need a production API token",
    });
    expect(message).toContain("blocked");
    expect(goal.stopReason).toBe("blocked");
    expect(goal.blockedReason).toBe("need a production API token");
  });

  it("updateGoal requires evidence for completion", async () => {
    activeGoal("fix tests");
    const message = await handlers.updateGoal(SESSION, { status: "complete" });
    expect(message).toContain("evidence");
  });

  it("updateGoal pauses and resumes", async () => {
    const goal = activeGoal("fix tests");
    await handlers.updateGoal(SESSION, { status: "paused" });
    expect(goal.stopped).toBe(true);
    await handlers.updateGoal(SESSION, { status: "resumed" });
    expect(goal.stopped).toBe(false);
  });

  it("rejects complete with a failed check claim", async () => {
    activeGoal("fix tests");
    const message = await handlers.updateGoal(SESSION, {
      status: "complete",
      evidence: "x",
      claim: {
        summary: "done",
        checks: [{ command: "npm test", result: "failed" }],
      },
    });
    expect(message).toContain("failed check");
  });

  it("refuses resume from a plan agent", async () => {
    const goal = activeGoal("fix tests");
    goal.stopped = true;
    goal.stopReason = "plan mode";
    const message = await handlers.updateGoal(
      SESSION,
      { status: "resumed" },
      "plan",
    );
    expect(message.toLowerCase()).toContain("plan");
    expect(goal.stopped).toBe(true);
  });

  it("requires a blocker before blocking", async () => {
    activeGoal("fix tests");
    const message = await handlers.updateGoal(SESSION, { status: "blocked" });
    expect(message).toContain("blocker");
  });
});

describe("agent tool definitions", () => {
  it("buildAgentTools registers the six canonical tools", async () => {
    const handlers = buildAgentToolHandlers({
      defaultGoalOptions: OPTIONS,
      persist,
    });
    const tools = await import("./tools");
    const definitions = tools.buildAgentTools(
      handlers,
      () => SESSION,
      persist,
      OPTIONS,
    );
    const names = Object.keys(definitions);
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
});
