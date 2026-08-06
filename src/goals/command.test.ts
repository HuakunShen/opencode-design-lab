import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GOAL_OPTIONS } from "./config";
import {
  activeGoal as activeGoalState,
  buildGoalState,
  clearRuntimeState,
  focusGoal,
  goalStates,
  registerSessionGoal,
} from "./state";
import {
  addGoalFromCommand,
  createGoalFromCommand,
  createSequenceFromCommand,
  formatGoalList,
  formatStatus,
  goalDisplayState,
  handleGoalControl,
} from "./command";

const SESSION = "session-1";
const OPTIONS = { ...DEFAULT_GOAL_OPTIONS };

beforeEach(() => clearRuntimeState());

function activeGoal(condition: string) {
  const goal = buildGoalState(SESSION, condition, OPTIONS);
  registerSessionGoal(goal);
  focusGoal(SESSION, goal);
  return goal;
}

describe("formatStatus", () => {
  it("includes objective, state, and budget usage", () => {
    const goal = activeGoal("fix tests");
    goal.turnCount = 2;
    const text = formatStatus(goal, "goal");
    expect(text).toContain("Active goal: fix tests");
    expect(text).toContain("State: active");
    expect(text).toContain("Auto-continues sent: 2/10");
  });

  it("shows blocked state and reason", () => {
    const goal = activeGoal("fix tests");
    goal.stopped = true;
    goal.stopReason = "blocked";
    goal.blockedReason = "need an API token";
    const text = formatStatus(goal, "goal");
    expect(text).toContain("State: blocked");
    expect(text).toContain("Blocked reason: need an API token");
  });
});

describe("handleGoalControl", () => {
  it("returns status text for bare /goal and /goal status", async () => {
    goalStates.delete(SESSION);
    const text = await handleGoalControl(SESSION, "", "goal");
    expect(text).toContain("No active goal");
  });

  it("pauses an active goal", async () => {
    const goal = activeGoal("fix tests");
    const text = await handleGoalControl(SESSION, "pause", "goal");
    expect(text).toContain("paused");
    expect(goal.stopped).toBe(true);
    expect(goal.stopReason).toBe("user requested pause");
  });

  it("clears the active goal", async () => {
    activeGoal("fix tests");
    const text = await handleGoalControl(SESSION, "clear", "goal");
    expect(text).toContain("cleared");
    expect(goalStates.has(SESSION)).toBe(false);
  });

  it("resumes a stopped goal with a fresh budget window", async () => {
    const goal = activeGoal("fix tests");
    goal.stopped = true;
    goal.stopReason = "user intervention";
    const text = await handleGoalControl(SESSION, "resume", "goal");
    expect(text).toContain("resumed");
    expect(goal.stopped).toBe(false);
    expect(goal.promptFailures).toBe(0);
    expect(goal.formatFailures).toBe(0);
  });

  it("rejects resume from plan mode", async () => {
    const goal = activeGoal("fix tests");
    goal.stopped = true;
    goal.stopReason = "plan mode";
    const text = await handleGoalControl(SESSION, "resume", "goal", "plan");
    expect(text.toLowerCase()).toContain("plan");
    expect(goal.stopped).toBe(true);
  });

  it("lists multiple goals with numbers", () => {
    const g1 = activeGoal("one");
    const g2 = buildGoalState(SESSION, "two", OPTIONS);
    registerSessionGoal(g2);
    const text = formatGoalList(SESSION, "goal");
    expect(text).toContain("1");
    expect(text).toContain("one");
    expect(text).toContain("2");
    expect(text).toContain("two");
    expect(text).toContain(goalDisplayState(g1));
  });

  it("focuses a goal by position and rejects invalid positions", async () => {
    const g1 = activeGoal("one");
    const g2 = buildGoalState(SESSION, "two", OPTIONS);
    registerSessionGoal(g2);
    // Focus position 2.
    const text = await handleGoalControl(SESSION, "focus 2", "goal");
    expect(text).toContain("two");
    expect(goalStates.get(SESSION)).toBe(g2);
    // Invalid position is rejected with a clear message, not NaN.
    const bad = await handleGoalControl(SESSION, "focus foo", "goal");
    expect(bad.toLowerCase()).toContain("invalid");
    // Out-of-range position.
    const oob = await handleGoalControl(SESSION, "focus 99", "goal");
    expect(oob).toContain("No goal at position 99");
    void g1;
  });

  it("returns unknown-subcommand text", async () => {
    const text = await handleGoalControl(SESSION, "bogus", "goal");
    expect(text).toContain("Unknown /goal subcommand");
  });
});

describe("createGoalFromCommand", () => {
  it("replaces the focused goal and keeps backgrounded ones", () => {
    const g1 = activeGoal("one");
    const g2 = buildGoalState(SESSION, "two", OPTIONS);
    registerSessionGoal(g2);
    const created = createGoalFromCommand(
      SESSION,
      "three",
      OPTIONS,
      { successCriteria: "", constraints: "", mode: "normal" },
      undefined,
    );
    expect(goalStates.get(SESSION)).toBe(created);
    expect(created?.condition).toBe("three");
    // g2 (backgrounded) survives replacement; g1 (focused) is discarded.
    expect(activeGoalState(SESSION, g2.goalId, g2.runId)).toBe(g2);
    expect(activeGoalState(SESSION, g1.goalId, g1.runId)).toBeNull();
  });

  it("pauses the goal when created from a restricted planning agent", () => {
    const created = createGoalFromCommand(
      SESSION,
      "three",
      OPTIONS,
      { successCriteria: "", constraints: "", mode: "normal" },
      "plan",
    );
    expect(created?.stopped).toBe(true);
    expect(created?.stopReason).toBe("plan mode");
  });

  it("addGoalFromCommand backgrounds the current goal and focuses a new one", () => {
    const g1 = activeGoal("one");
    const g2 = addGoalFromCommand(
      SESSION,
      "two",
      OPTIONS,
      { successCriteria: "", constraints: "", mode: "normal" },
      undefined,
    );
    // g1 is paused/backgrounded; g2 is focused and active.
    expect(g1.stopped).toBe(true);
    expect(g1.stopReason).toBe("backgrounded");
    expect(goalStates.get(SESSION)).toBe(g2);
    expect(g2.stopped).toBe(false);
    // Both remain registered (g1 survives in the session registry).
    expect(activeGoalState(SESSION, g1.goalId, g1.runId)).toBe(g1);
  });

  it("createSequenceFromCommand queues goals and focuses the first", () => {
    const goals = createSequenceFromCommand(
      SESSION,
      ["build the parser", "write the tests", "ship the release"],
      OPTIONS,
      undefined,
    );
    expect(goals).toHaveLength(3);
    expect(goalStates.get(SESSION)).toBe(goals[0]);
    expect(goals[0].stopped).toBe(false);
    expect(goals[1].stopped).toBe(true);
    expect(goals[1].stopReason).toBe("queued");
    expect(goals[2].stopReason).toBe("queued");
  });
});
