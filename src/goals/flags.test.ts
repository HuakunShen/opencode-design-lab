import { describe, expect, it } from "vitest";
import { DEFAULT_GOAL_OPTIONS } from "./config";
import { parseGoalArguments } from "./flags";

describe("parseGoalArguments", () => {
  it("parses a plain condition", () => {
    const result = parseGoalArguments(
      "fix the failing tests",
      DEFAULT_GOAL_OPTIONS,
    );
    expect(result.errors).toEqual([]);
    expect(result.condition).toBe("fix the failing tests");
  });

  it("supports --flag value and --flag=value", () => {
    const a = parseGoalArguments(
      "fix tests --max-turns 20",
      DEFAULT_GOAL_OPTIONS,
    );
    expect(a.options.max_auto_turns).toBe(20);
    const b = parseGoalArguments(
      "fix tests --max-turns=20",
      DEFAULT_GOAL_OPTIONS,
    );
    expect(b.options.max_auto_turns).toBe(20);
  });

  it("supports --max-minutes and --budget shorthands", () => {
    const a = parseGoalArguments(
      "fix tests --max-minutes 30",
      DEFAULT_GOAL_OPTIONS,
    );
    expect(a.options.max_duration_ms).toBe(30 * 60000);
    const b = parseGoalArguments(
      "fix tests --budget 100k",
      DEFAULT_GOAL_OPTIONS,
    );
    expect(b.options.max_tokens).toBe(100000);
  });

  it("captures success criteria and constraints with quoting", () => {
    const result = parseGoalArguments(
      'ship --success "tests pass and changelog updated" --constraints "do not touch the public API"',
      DEFAULT_GOAL_OPTIONS,
    );
    expect(result.condition).toBe("ship");
    expect(result.meta.successCriteria).toBe(
      "tests pass and changelog updated",
    );
    expect(result.meta.constraints).toBe("do not touch the public API");
  });

  it("rejects unknown flags with a helpful error", () => {
    const result = parseGoalArguments(
      "fix tests --bogus 1",
      DEFAULT_GOAL_OPTIONS,
    );
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("--bogus");
  });

  it("rejects missing flag values", () => {
    const result = parseGoalArguments(
      "fix tests --max-turns",
      DEFAULT_GOAL_OPTIONS,
    );
    expect(result.errors.some((e) => e.includes("Missing value"))).toBe(true);
  });

  it("rejects invalid modes", () => {
    const result = parseGoalArguments(
      "fix tests --mode turbo",
      DEFAULT_GOAL_OPTIONS,
    );
    expect(result.errors.some((e) => e.includes("Invalid mode"))).toBe(true);
  });

  it("accepts --mode ordered", () => {
    const result = parseGoalArguments(
      "fix tests --mode ordered",
      DEFAULT_GOAL_OPTIONS,
    );
    expect(result.meta.mode).toBe("ordered");
  });

  it("rejects invalid and zero budgets", () => {
    expect(
      parseGoalArguments("fix tests --budget abc", DEFAULT_GOAL_OPTIONS).errors,
    ).toHaveLength(1);
    expect(
      parseGoalArguments("fix tests --budget 0", DEFAULT_GOAL_OPTIONS).errors,
    ).toHaveLength(1);
  });

  it("rejects non-positive and non-integer limits", () => {
    expect(
      parseGoalArguments("fix tests --max-turns=0", DEFAULT_GOAL_OPTIONS).errors,
    ).toHaveLength(1);
    expect(
      parseGoalArguments("fix tests --max-minutes -5", DEFAULT_GOAL_OPTIONS).errors,
    ).toHaveLength(1);
    expect(
      parseGoalArguments("fix tests --max-duration-ms 1.5", DEFAULT_GOAL_OPTIONS).errors,
    ).toHaveLength(1);
  });
});
