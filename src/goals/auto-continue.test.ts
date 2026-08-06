import { describe, expect, it, vi } from "vitest";
import type { GoalOptions } from "./config";
import { DEFAULT_GOAL_OPTIONS } from "./config";
import { activeContinues, buildGoalState, focusGoal, registerSessionGoal } from "./state";
import {
  buildContinuationCheck,
  checkIdleGate,
  cooldownRemainingMs,
  runIdleContinuation,
  shouldContinue,
} from "./auto-continue";

const SESSION = "session-1";
const OPTIONS: GoalOptions = { ...DEFAULT_GOAL_OPTIONS };

function goal() {
  const g = buildGoalState(SESSION, "fix tests", OPTIONS);
  registerSessionGoal(g);
  focusGoal(SESSION, g);
  return g;
}

describe("idle continuation gate", () => {
  it("passes for a clean active goal", () => {
    const g = goal();
    const result = checkIdleGate(g, SESSION, {
      sessionStatus: "idle",
      planAgentActive: false,
      userIntervention: false,
      alreadyContinuing: false,
    });
    expect(result.pass).toBe(true);
  });

  it("fails when already continuing", () => {
    const g = goal();
    const result = checkIdleGate(g, SESSION, {
      sessionStatus: "idle",
      planAgentActive: false,
      userIntervention: false,
      alreadyContinuing: true,
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("already");
  });

  it("fails when a plan agent is active", () => {
    const g = goal();
    const result = checkIdleGate(g, SESSION, {
      sessionStatus: "idle",
      planAgentActive: true,
      userIntervention: false,
      alreadyContinuing: false,
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("plan");
  });

  it("fails on user intervention", () => {
    const g = goal();
    const result = checkIdleGate(g, SESSION, {
      sessionStatus: "idle",
      planAgentActive: false,
      userIntervention: true,
      alreadyContinuing: false,
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("user");
  });

  it("fails when the session is not idle", () => {
    const g = goal();
    const result = checkIdleGate(g, SESSION, {
      sessionStatus: "running",
      planAgentActive: false,
      userIntervention: false,
      alreadyContinuing: false,
    });
    expect(result.pass).toBe(false);
  });
});

describe("cooldown", () => {
  it("returns 0 when never continued", () => {
    const g = goal();
    expect(cooldownRemainingMs(g)).toBe(0);
  });

  it("returns remaining ms when within the cooldown window", () => {
    const g = goal();
    g.lastContinueAt = Date.now() - 500;
    const remaining = cooldownRemainingMs(g);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(1500);
  });
});

describe("shouldContinue", () => {
  it("combines gate and cooldown", () => {
    const g = goal();
    const decision = shouldContinue(g, SESSION, {
      sessionStatus: "idle",
      planAgentActive: false,
      userIntervention: false,
      alreadyContinuing: false,
      lastContinueAt: Date.now() - 5000,
    });
    expect(decision).toBe(true);
  });
});

describe("buildContinuationCheck", () => {
  it("produces the full gate verdict text", () => {
    const g = goal();
    const result = buildContinuationCheck(g, SESSION, {
      sessionStatus: "idle",
      planAgentActive: false,
      userIntervention: false,
      alreadyContinuing: false,
    });
    expect(result).toContain("READY");
  });
});

describe("runIdleContinuation", () => {
  it("sends the continuation prompt and updates turn count", async () => {
    const g = goal();
    const promptAsync = vi.fn().mockResolvedValue({});
    const persist = vi.fn().mockResolvedValue(true);
    const sent = await runIdleContinuation(SESSION, g, promptAsync, persist);
    expect(sent).toBe(true);
    expect(promptAsync).toHaveBeenCalledTimes(1);
    const [sid, parts] = promptAsync.mock.calls[0];
    expect(sid).toBe(SESSION);
    expect(parts[0].text).toContain("turns_remaining: 9");
    expect(g.turnCount).toBe(1);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(activeContinues.has(SESSION)).toBe(false);
  });

  it("does not continue when auto_continue is disabled", async () => {
    const g = buildGoalState(SESSION, "task", {
      ...OPTIONS,
      auto_continue: false,
    });
    const promptAsync = vi.fn();
    const sent = await runIdleContinuation(SESSION, g, promptAsync, () =>
      Promise.resolve(true),
    );
    expect(sent).toBe(false);
    expect(promptAsync).not.toHaveBeenCalled();
  });

  it("does not continue while another continuation is in flight", async () => {
    const g = goal();
    activeContinues.set(SESSION, "other-token");
    const promptAsync = vi.fn();
    const sent = await runIdleContinuation(SESSION, g, promptAsync, () =>
      Promise.resolve(true),
    );
    expect(sent).toBe(false);
    expect(promptAsync).not.toHaveBeenCalled();
    activeContinues.delete(SESSION);
  });

  it("escalates a returned error to stopped at max failures", async () => {
    const g = buildGoalState(SESSION, "task", {
      ...OPTIONS,
      max_prompt_failures: 2,
    });
    const promptAsync = vi
      .fn()
      .mockResolvedValue({ error: { name: "RateLimitError" } });
    const persist = vi.fn().mockResolvedValue(true);
    await runIdleContinuation(SESSION, g, promptAsync, persist);
    expect(g.promptFailures).toBe(1);
    expect(g.stopped).toBe(false);
    await runIdleContinuation(SESSION, g, promptAsync, persist);
    expect(g.promptFailures).toBe(2);
    expect(g.stopped).toBe(true);
    expect(g.stopReason).toBe("auto-continue failures");
  });

  it("escalates a thrown prompt error to the failure cap", async () => {
    const g = buildGoalState(SESSION, "task", {
      ...OPTIONS,
      max_prompt_failures: 1,
    });
    const promptAsync = vi.fn().mockRejectedValue(new Error("boom"));
    const persist = vi.fn().mockResolvedValue(true);
    const sent = await runIdleContinuation(SESSION, g, promptAsync, persist);
    expect(sent).toBe(true);
    expect(g.promptFailures).toBe(1);
    expect(g.stopped).toBe(true);
    expect(g.stopReason).toBe("auto-continue failures");
  });
});
