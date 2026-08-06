import type { DesignLabConfig } from "../config/schema";

/**
 * Per-goal options resolved from the design-lab.json `goals` section.
 * Snake_case matches the config file.
 */
export type GoalOptions = {
  auto_continue: boolean;
  max_auto_turns: number;
  max_duration_ms: number;
  max_tokens: number;
  min_delay_ms: number;
  no_progress_token_threshold: number;
  no_progress_turns_before_pause: number;
  no_tool_call_turns_before_pause: number;
  budget_wrapup_ratio: number;
  max_prompt_failures: number;
  persist_state: boolean;
  state_dir: string;
  restricted_agents: readonly string[];
  allow_goal_execution_from_plan: boolean;
};

/**
 * Built-in defaults for every goal option.
 * Frozen (including the nested array) so per-goal overrides never mutate the
 * shared snapshot.
 */
export const DEFAULT_GOAL_OPTIONS: Readonly<GoalOptions> = Object.freeze({
  auto_continue: true,
  max_auto_turns: 10,
  max_duration_ms: 15 * 60 * 1000,
  max_tokens: 200000,
  min_delay_ms: 1500,
  no_progress_token_threshold: 50,
  no_progress_turns_before_pause: 2,
  no_tool_call_turns_before_pause: 2,
  budget_wrapup_ratio: 0.8,
  max_prompt_failures: 3,
  persist_state: true,
  state_dir: ".opencode/goals",
  restricted_agents: Object.freeze(["plan"]),
  allow_goal_execution_from_plan: false,
});

/**
 * Extract goal options from a DesignLabConfig, merging the optional `goals`
 * section over the built-in defaults. Returns a fresh frozen snapshot so
 * callers can spread it into per-goal option overrides safely. A missing or
 * invalid config yields the built-in defaults.
 */
export function extractGoalsConfig(
  config: DesignLabConfig | null | undefined,
): Readonly<GoalOptions> {
  const section: Partial<GoalOptions> = config?.goals ?? {};
  const merged: GoalOptions = {
    auto_continue: section.auto_continue ?? DEFAULT_GOAL_OPTIONS.auto_continue,
    max_auto_turns:
      section.max_auto_turns ?? DEFAULT_GOAL_OPTIONS.max_auto_turns,
    max_duration_ms:
      section.max_duration_ms ?? DEFAULT_GOAL_OPTIONS.max_duration_ms,
    max_tokens: section.max_tokens ?? DEFAULT_GOAL_OPTIONS.max_tokens,
    min_delay_ms: section.min_delay_ms ?? DEFAULT_GOAL_OPTIONS.min_delay_ms,
    no_progress_token_threshold:
      section.no_progress_token_threshold ??
      DEFAULT_GOAL_OPTIONS.no_progress_token_threshold,
    no_progress_turns_before_pause:
      section.no_progress_turns_before_pause ??
      DEFAULT_GOAL_OPTIONS.no_progress_turns_before_pause,
    no_tool_call_turns_before_pause:
      section.no_tool_call_turns_before_pause ??
      DEFAULT_GOAL_OPTIONS.no_tool_call_turns_before_pause,
    budget_wrapup_ratio:
      section.budget_wrapup_ratio ?? DEFAULT_GOAL_OPTIONS.budget_wrapup_ratio,
    max_prompt_failures:
      section.max_prompt_failures ?? DEFAULT_GOAL_OPTIONS.max_prompt_failures,
    persist_state: section.persist_state ?? DEFAULT_GOAL_OPTIONS.persist_state,
    state_dir: section.state_dir ?? DEFAULT_GOAL_OPTIONS.state_dir,
    restricted_agents:
      section.restricted_agents ?? DEFAULT_GOAL_OPTIONS.restricted_agents,
    allow_goal_execution_from_plan:
      section.allow_goal_execution_from_plan ??
      DEFAULT_GOAL_OPTIONS.allow_goal_execution_from_plan,
  };
  return Object.freeze(merged);
}
