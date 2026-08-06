import { describe, expect, it } from "vitest";
import { buildGoalState } from "./state";
import { DEFAULT_GOAL_OPTIONS } from "./config";
import {
  budgetWrapupNeeded,
  buildLimitWarning,
  messageHasToolCall,
  normalizeMessageUsage,
  normalizeUsage,
  stopReason,
  totalTokensForMessage,
} from "./limits";

const SESSION = "session-1";

function goalWith(maxTurns: number, maxDurationMs: number, maxTokens: number) {
  return buildGoalState(SESSION, "task", {
    ...DEFAULT_GOAL_OPTIONS,
    max_auto_turns: maxTurns,
    max_duration_ms: maxDurationMs,
    max_tokens: maxTokens,
  });
}

describe("stopReason", () => {
  it("returns max turns when turnCount reaches the cap", () => {
    const goal = goalWith(3, 600000, 100000);
    goal.turnCount = 3;
    expect(stopReason(goal)).toContain("max turns");
  });

  it("returns max duration when elapsed exceeds the cap", () => {
    const goal = goalWith(100, 1000, 100000);
    goal.startedAt = Date.now() - 2000;
    expect(stopReason(goal)).toContain("max duration");
  });

  it("returns max tokens when budget exhausted", () => {
    const goal = goalWith(100, 600000, 1000);
    goal.totalTokens = 1000;
    expect(stopReason(goal)).toContain("max context tokens");
  });

  it("returns null when within all limits", () => {
    const goal = goalWith(10, 600000, 100000);
    expect(stopReason(goal)).toBeNull();
  });
});

describe("budgetWrapupNeeded", () => {
  it("triggers once at the wrap-up ratio", () => {
    const goal = goalWith(10, 600000, 1000);
    goal.totalTokens = 799;
    expect(budgetWrapupNeeded(goal)).toBe(false);
    goal.totalTokens = 800;
    expect(budgetWrapupNeeded(goal)).toBe(true);
    goal.budgetWrapupSent = true;
    expect(budgetWrapupNeeded(goal)).toBe(false);
  });
});

describe("buildLimitWarning", () => {
  it("warns when limits are near", () => {
    const goal = goalWith(3, 600000, 100000);
    goal.turnCount = 1;
    expect(buildLimitWarning(goal)).toContain("auto-continue turn(s) remaining");
  });

  it("returns empty string when limits are far", () => {
    const goal = goalWith(10, 600000, 100000);
    expect(buildLimitWarning(goal)).toBe("");
  });
});

describe("token accounting", () => {
  it("totalTokensForMessage sums input/output/reasoning/cache", () => {
    const message = {
      info: { tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 200, write: 40 } } },
    };
    expect(totalTokensForMessage(message)).toBe(400);
  });

  it("totalTokensForMessage prefers a reported total", () => {
    const message = { info: { tokens: { total: 999, input: 100 } } };
    expect(totalTokensForMessage(message)).toBe(999);
  });

  it("totalTokensForMessage counts flat cache fields when no total", () => {
    const message = {
      info: { tokens: { input: 100, output: 50, cacheRead: 200, cache_write: 40 } },
    };
    expect(totalTokensForMessage(message)).toBe(390);
  });

  it("normalizeUsage sanitizes invalid provider values", () => {
    const usage = normalizeUsage({
      input: "x",
      output: 5,
      cost: -1,
    } as unknown as Parameters<typeof normalizeUsage>[0]);
    expect(usage.input).toBe(0);
    expect(usage.output).toBe(5);
    expect(usage.cost).toBe(0);
    expect(usage.costKnown).toBe(false);
  });

  it("messageHasToolCall detects tool parts", () => {
    expect(messageHasToolCall({ parts: [{ type: "text", text: "hi" }] })).toBe(false);
    expect(messageHasToolCall({ parts: [{ type: "tool", name: "read" }] })).toBe(true);
    expect(messageHasToolCall({})).toBe(false);
  });

  it("normalizeMessageUsage reads info tokens and cost", () => {
    const usage = normalizeMessageUsage({
      info: { tokens: { input: 10, output: 20, cache: { read: 30 } }, cost: 0.5 },
    });
    expect(usage.input).toBe(10);
    expect(usage.output).toBe(20);
    expect(usage.cacheRead).toBe(30);
    expect(usage.cost).toBe(0.5);
    expect(usage.costKnown).toBe(true);
  });
});
