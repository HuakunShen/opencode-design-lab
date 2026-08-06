import type { GoalOptions } from "./config";

/**
 * Set of agents treated as planning-only. When empty, plan-mode restrictions
 * are disabled entirely (allow_goal_execution_from_plan).
 * Accepts Readonly<GoalOptions> (callers may pass the frozen defaults).
 */
export function restrictedAgentSet(options: Readonly<GoalOptions>): Set<string> {
  if (options.allow_goal_execution_from_plan === true) return new Set();
  const names = Array.isArray(options.restricted_agents)
    ? options.restricted_agents
    : ["plan"];
  return new Set(
    names.map((name) => name.trim().toLowerCase()).filter(Boolean),
  );
}

export function isPlanAgent(agent: unknown, restricted: Set<string>): boolean {
  return (
    typeof agent === "string" && restricted.has(agent.trim().toLowerCase())
  );
}
