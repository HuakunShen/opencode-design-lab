import { beforeEach, describe, expect, it } from "vitest";
import {
  activeGoal,
  buildGoalState,
  cleanupGoal,
  clearRuntimeState,
  focusGoal,
  goalDisplayState,
  promoteNextOrderedGoal,
  registerSessionGoal,
  rememberGoalResult,
  sessionOrdered,
} from "./state";
import { DEFAULT_GOAL_OPTIONS } from "./config";

const SESSION = "session-1";

beforeEach(() => {
  clearRuntimeState();
});

describe("goal state lifecycle", () => {
  it("builds a fresh goal with zeroed budgets", () => {
    const goal = buildGoalState(SESSION, "fix the tests", {
      ...DEFAULT_GOAL_OPTIONS,
      max_auto_turns: 7,
    });
    expect(goal.condition).toBe("fix the tests");
    expect(goal.turnCount).toBe(0);
    expect(goal.stopped).toBe(false);
    expect(goal.goalId).toBeTruthy();
    expect(goal.runId).toBeTruthy();
    expect(goal.history).toEqual([]);
  });

  it("register + focus makes a goal active", () => {
    const goal = buildGoalState(SESSION, "task");
    registerSessionGoal(goal);
    focusGoal(SESSION, goal);
    expect(activeGoal(SESSION)).toBe(goal);
    expect(goalDisplayState(goal)).toBe("active");
  });

  it("stopped blocked goal displays as blocked", () => {
    const goal = buildGoalState(SESSION, "task");
    goal.stopped = true;
    goal.stopReason = "blocked";
    expect(goalDisplayState(goal)).toBe("blocked");
  });

  it("cleanupGoal removes focused goal but keeps backgrounded ones", () => {
    const g1 = buildGoalState(SESSION, "one");
    const g2 = buildGoalState(SESSION, "two");
    registerSessionGoal(g1);
    registerSessionGoal(g2);
    focusGoal(SESSION, g1);
    cleanupGoal(SESSION);
    expect(activeGoal(SESSION)).toBeNull();
    expect(activeGoal(SESSION, g2.goalId, g2.runId)).toBe(g2);
  });

  it("promoteNextOrderedGoal focuses the next goal in creation order", () => {
    const g1 = buildGoalState(SESSION, "one");
    const g2 = buildGoalState(SESSION, "two");
    registerSessionGoal(g1);
    registerSessionGoal(g2);
    focusGoal(SESSION, g1);
    sessionOrdered.add(SESSION);
    const promoted = promoteNextOrderedGoal(SESSION);
    expect(promoted).toBe(g2);
    expect(activeGoal(SESSION)).toBe(g2);
    expect(g2.stopped).toBe(false);
  });

  it("promoteNextOrderedGoal returns null and clears order when exhausted", () => {
    const g1 = buildGoalState(SESSION, "one");
    registerSessionGoal(g1);
    focusGoal(SESSION, g1);
    sessionOrdered.add(SESSION);
    const promoted = promoteNextOrderedGoal(SESSION);
    expect(promoted).toBeNull();
    expect(sessionOrdered.has(SESSION)).toBe(false);
  });

  it("rememberGoalResult snapshots terminal state", () => {
    const goal = buildGoalState(SESSION, "task");
    goal.turnCount = 3;
    goal.totalTokens = 1234;
    const result = rememberGoalResult(SESSION, goal, "achieved", "", "evidence text");
    expect(result.state).toBe("achieved");
    expect(result.turnCount).toBe(3);
    expect(result.evidence).toBe("evidence text");
  });
});
