import { describe, expect, it } from "vitest";
import type { DesignLabConfig } from "../config/schema";
import {
  DEFAULT_GOAL_OPTIONS,
  extractGoalsConfig,
  type GoalOptions,
} from "./config";

const BASE: DesignLabConfig = {
  models: ["opencode/kimi-k2.6", "opencode/gpt-5.4"],
  default_variant: "max",
  base_output_dir: ".design-lab",
  design_agent_temperature: 0.7,
  review_agent_temperature: 0.1,
};

describe("extractGoalsConfig", () => {
  it("returns defaults when goals section is absent", () => {
    const options = extractGoalsConfig(BASE);
    expect(options.max_auto_turns).toBe(10);
    expect(options.max_tokens).toBe(200000);
    expect(options.restricted_agents).toEqual(["plan"]);
  });

  it("merges overrides from the goals section", () => {
    const options = extractGoalsConfig({
      ...BASE,
      goals: {
        max_auto_turns: 25,
        max_duration_ms: 3600000,
      } as NonNullable<DesignLabConfig["goals"]>,
    });
    expect(options.max_auto_turns).toBe(25);
    expect(options.max_duration_ms).toBe(3600000);
    expect(options.max_tokens).toBe(200000);
  });

  it("produces a frozen snapshot per call", () => {
    const a = extractGoalsConfig(BASE);
    const b = extractGoalsConfig(BASE);
    expect(Object.isFrozen(a)).toBe(true);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it("camelCase alias maps onto GoalOptions", () => {
    expect(DEFAULT_GOAL_OPTIONS).toMatchObject({
      max_auto_turns: 10,
      max_duration_ms: 900000,
      max_tokens: 200000,
    });
  });
});

export type { GoalOptions };
