import { describe, expect, it } from "vitest";
import { DesignLabConfigSchema } from "./schema";

describe("DesignLabConfigSchema goals section", () => {
  it("accepts a goals section with overrides", () => {
    const parsed = DesignLabConfigSchema.parse({
      models: ["opencode/kimi-k2.6", "opencode/gpt-5.4"],
      goals: {
        max_auto_turns: 20,
        max_tokens: 400000,
        restricted_agents: ["plan", "ask"],
        allow_goal_execution_from_plan: false,
      },
    });
    expect(parsed.goals?.max_auto_turns).toBe(20);
    expect(parsed.goals?.restricted_agents).toEqual(["plan", "ask"]);
  });

  it("defaults goals to undefined when omitted", () => {
    const parsed = DesignLabConfigSchema.parse({
      models: ["opencode/kimi-k2.6", "opencode/gpt-5.4"],
    });
    expect(parsed.goals).toBeUndefined();
  });

  it("rejects negative max_auto_turns", () => {
    expect(() =>
      DesignLabConfigSchema.parse({
        models: ["opencode/kimi-k2.6", "opencode/gpt-5.4"],
        goals: { max_auto_turns: -1 },
      }),
    ).toThrow();
  });
});
