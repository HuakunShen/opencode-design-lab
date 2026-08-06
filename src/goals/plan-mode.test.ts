import { describe, expect, it } from "vitest";
import { isPlanAgent, restrictedAgentSet } from "./plan-mode";
import { DEFAULT_GOAL_OPTIONS } from "./config";

describe("plan-mode safety", () => {
  it("defaults to restricting the plan agent", () => {
    const set = restrictedAgentSet(DEFAULT_GOAL_OPTIONS);
    expect(set.has("plan")).toBe(true);
    expect(set.has("build")).toBe(false);
  });

  it("matches restricted agents case-insensitively", () => {
    const set = restrictedAgentSet({
      ...DEFAULT_GOAL_OPTIONS,
      restricted_agents: ["Plan", "ASK"],
    });
    expect(set.has("plan")).toBe(true);
    expect(set.has("ask")).toBe(true);
  });

  it("returns an empty set when allow_goal_execution_from_plan", () => {
    const set = restrictedAgentSet({
      ...DEFAULT_GOAL_OPTIONS,
      allow_goal_execution_from_plan: true,
    });
    expect(set.size).toBe(0);
  });

  it("isPlanAgent respects the configured set", () => {
    const set = restrictedAgentSet(DEFAULT_GOAL_OPTIONS);
    expect(isPlanAgent("plan", set)).toBe(true);
    expect(isPlanAgent("PLAN", set)).toBe(true);
    expect(isPlanAgent("build", set)).toBe(false);
  });
});
