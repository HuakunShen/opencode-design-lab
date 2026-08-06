import { DEFAULT_GOAL_OPTIONS } from "./config";
import type { GoalOptions } from "./config";
import {
  buildGoalState,
  cleanupGoal,
  focusGoal,
  goalDisplayState,
  goalStates,
  listSessionGoals,
  lastGoalResults,
  pauseGoalClock,
  pushHistoryEntry,
  registerSessionGoal,
  resumeGoalClock,
  sessionOrdered,
} from "./state";
import type { GoalState } from "./state";
import { isPlanAgent, restrictedAgentSet } from "./plan-mode";
import { normalizeMode } from "./flags";

const CLEAR_COMMANDS = new Set([
  "clear",
  "stop",
  "off",
  "reset",
  "none",
  "cancel",
]);
const PAUSE_COMMANDS = new Set(["pause"]);
const RESUME_COMMANDS = new Set(["resume"]);

// Mutable copy of the frozen defaults so the GoalOptions param default

export { goalDisplayState } from "./state";

export function formatHistory(history: GoalState["history"]): string {
  if (!history.length) return "No goal history recorded yet.";
  return history
    .map(
      (entry) =>
        `- [${new Date(entry.timestamp).toISOString()}] ${entry.type}: ${entry.detail}`,
    )
    .join("\n");
}

export function formatStatus(
  goal: GoalState,
  commandName = "goal",
  completionAuditLabel = "evidence gate only (independent verifier off)",
): string {
  const elapsed = Math.round((Date.now() - goal.startedAt) / 1000);
  const lastProgress =
    goal.lastProgressAt > 0
      ? `${Math.round((Date.now() - goal.lastProgressAt) / 1000)}s ago`
      : "none yet";
  const lastCheckpoint = goal.lastCheckpoint
    ? `${goal.lastCheckpoint.summary} (${Math.round((Date.now() - goal.lastCheckpoint.timestamp) / 1000)}s ago)`
    : "none yet";
  const lines = [
    `Active goal: ${goal.condition}`,
    `State: ${goalDisplayState(goal)}`,
    `Completion audit: ${completionAuditLabel}`,
  ];
  if (goal.successCriteria)
    lines.push(`Success criteria: ${goal.successCriteria}`);
  if (goal.constraints) lines.push(`Constraints: ${goal.constraints}`);
  if (goal.mode && goal.mode !== "normal") lines.push(`Mode: ${goal.mode}`);
  lines.push(
    `Auto-continues sent: ${goal.turnCount}/${goal.options.max_auto_turns}`,
    `Context tokens: ${goal.totalTokens.toLocaleString()}/${goal.options.max_tokens.toLocaleString()}`,
    `Elapsed: ${elapsed}s/${Math.round(goal.options.max_duration_ms / 1000)}s`,
    `Last progress: ${lastProgress}`,
    `No-progress turns: ${goal.noProgressTurns}`,
    `Recent checkpoint: ${lastCheckpoint}`,
    `Last status: ${goal.lastStatus || "No assistant turn recorded yet."}`,
  );
  if (goal.stopped) lines.push(`Stopped: ${goal.stopReason || "unknown"}`);
  if (goal.blockedReason) lines.push(`Blocked reason: ${goal.blockedReason}`);
  if (goal.stopped) {
    lines.push(
      `Suggested action: ${
        goal.stopReason === "blocked"
          ? `address the blocker, then run /${commandName} resume`
          : `run /${commandName} resume to continue, or /${commandName} clear to discard`
      }`,
    );
  }
  return lines.join("\n");
}

export function formatGoalList(
  sessionID: string,
  commandName = "goal",
): string {
  const goals = listSessionGoals(sessionID);
  const focused = goalStates.get(sessionID);
  if (goals.length === 0) {
    return `No goals. Set one with \`/${commandName} <condition>\`.`;
  }
  const lines = ["Live goals:"];
  goals.forEach((goal, index) => {
    const marker = focused === goal ? " (focused)" : "";
    lines.push(
      `${index + 1}. ${goal.condition} — ${goalDisplayState(goal)}${marker}${
        goal.stopped && goal.stopReason ? ` (${goal.stopReason})` : ""
      }`,
    );
  });
  if (sessionOrdered.has(sessionID))
    lines.push("Session mode: ordered sequence.");
  return lines.join("\n");
}

export async function handleGoalControl(
  sessionID: string,
  args: string,
  commandName: string,
  currentAgent: string | undefined = undefined,
  options: Readonly<GoalOptions> = DEFAULT_GOAL_OPTIONS,
): Promise<string> {
  const goal = goalStates.get(sessionID);
  const restricted = restrictedAgentSet(options);

  if (!args || args === "status") {
    if (goal) return formatStatus(goal, commandName);
    const lastResult = lastGoalResults.get(sessionID);
    if (lastResult) {
      return `Last goal: ${lastResult.condition}\nState: ${lastResult.state}\n${
        lastResult.evidence ? `Evidence: ${lastResult.evidence}\n` : ""
      }`;
    }
    return `No active goal. Set one with \`/${commandName} <condition>\`.`;
  }

  if (args === "history") {
    if (goal) {
      return [
        `Goal history for: ${goal.condition}`,
        "",
        `Latest checkpoint: ${goal.lastCheckpoint?.summary || "none yet"}`,
        "",
        formatHistory(goal.history),
      ].join("\n");
    }
    return "No goal history recorded yet. Set a goal first.";
  }

  if (args === "list") return formatGoalList(sessionID, commandName);

  if (PAUSE_COMMANDS.has(args)) {
    if (!goal) return "No active goal to pause.";
    if (goal.stopped && goal.stopReason === "user requested pause")
      return "Goal already paused.";
    goal.stopped = true;
    goal.stopReason = "user requested pause";
    goal.blockedReason = "";
    goal.lastStatus = `Paused. Run /${commandName} resume to continue.`;
    pauseGoalClock(goal);
    pushHistoryEntry(goal, "paused", "Paused by the user via /goal pause.");
    return "Goal paused.";
  }

  if (RESUME_COMMANDS.has(args)) {
    if (!goal) return "No active goal to resume.";
    if (!goal.stopped) return "Goal is already running.";
    if (isPlanAgent(currentAgent, restricted)) {
      return "Resume is refused while the active agent is a restricted planning agent. Switch to Build mode and resume there.";
    }
    goal.stopped = false;
    goal.stopReason = "";
    goal.blockedReason = "";
    goal.promptFailures = 0;
    goal.formatFailures = 0;
    goal.budgetWrapupSent = false;
    goal.lastStatus = "Resumed.";
    resumeGoalClock(goal);
    pushHistoryEntry(goal, "resumed", "Resumed by the user via /goal resume.");
    return "Goal resumed with a fresh budget window.";
  }

  if (CLEAR_COMMANDS.has(args)) {
    if (goal) {
      pushHistoryEntry(goal, "cleared", "Cleared by the user via /goal clear.");
    }
    sessionOrdered.delete(sessionID);
    cleanupGoal(sessionID);
    lastGoalResults.delete(sessionID);
    return "Goal cleared.";
  }

  if (args.startsWith("focus ")) {
    const raw = args.slice(6).trim();
    if (!/^\d+$/.test(raw)) {
      return `Invalid goal position: ${raw || "(empty)"}. Run /${commandName} list to see numbered goals.`;
    }
    const number = Number(raw);
    const goals = listSessionGoals(sessionID);
    const target = goals[number - 1];
    if (!target)
      return `No goal at position ${number}. Run /${commandName} list to see goals.`;
    focusGoal(sessionID, target);
    if (target.stopped && target.stopReason === "backgrounded") {
      target.stopped = false;
      target.stopReason = "";
    }
    pushHistoryEntry(target, "focused", "Focused by the user via /goal focus.");
    return `Focused goal ${number}: ${target.condition}`;
  }

  return `Unknown /${commandName} subcommand: ${args.split(/\s+/)[0]}`;
}

export function createGoalFromCommand(
  sessionID: string,
  condition: string,
  options: GoalOptions,
  meta: { successCriteria: string; constraints: string; mode: string },
  currentAgent: string | undefined,
): GoalState | null {
  const restricted = restrictedAgentSet(options);
  const planningOnly = isPlanAgent(currentAgent, restricted);
  const goal = buildGoalState(sessionID, condition, options, {
    successCriteria: meta.successCriteria,
    constraints: meta.constraints,
    mode: normalizeMode(meta.mode) ?? "normal",
  });
  if (planningOnly) {
    goal.stopped = true;
    goal.stopReason = "plan mode";
    goal.lastStatus =
      "Created from a restricted planning agent; paused until you switch to Build mode and run /goal resume.";
    pushHistoryEntry(
      goal,
      "paused",
      "Created from a planning agent; paused in plan mode.",
    );
  }
  sessionOrdered.delete(sessionID);
  cleanupGoal(sessionID);
  lastGoalResults.delete(sessionID);
  registerSessionGoal(goal);
  focusGoal(sessionID, goal);
  return goal;
}

/**
 * Create a new focused goal while backgrounding (pausing) the current one.
 * Unlike createGoalFromCommand, this does NOT discard the existing goal.
 */
export function addGoalFromCommand(
  sessionID: string,
  condition: string,
  options: GoalOptions,
  meta: { successCriteria: string; constraints: string; mode: string },
  currentAgent: string | undefined,
): GoalState {
  const restricted = restrictedAgentSet(options);
  const planningOnly = isPlanAgent(currentAgent, restricted);
  const current = goalStates.get(sessionID);
  if (current && !current.stopped) {
    current.stopped = true;
    current.stopReason = "backgrounded";
    current.lastStatus = "Backgrounded by /goal add; paused until focused.";
    pushHistoryEntry(current, "backgrounded", "Backgrounded by /goal add.");
  }
  const goal = buildGoalState(sessionID, condition, options, {
    successCriteria: meta.successCriteria,
    constraints: meta.constraints,
    mode: normalizeMode(meta.mode) ?? "normal",
  });
  if (planningOnly) {
    goal.stopped = true;
    goal.stopReason = "plan mode";
    goal.lastStatus =
      "Created from a restricted planning agent; paused until you switch to Build mode and run /goal resume.";
    pushHistoryEntry(
      goal,
      "paused",
      "Created from a planning agent; paused in plan mode.",
    );
  }
  lastGoalResults.delete(sessionID);
  registerSessionGoal(goal);
  focusGoal(sessionID, goal);
  return goal;
}

/**
 * Create an ordered sequence from a set of conditions. The first goal is
 * focused and active; the rest are queued (paused, stopReason "queued").
 * Completing a goal auto-promotes the next via promoteNextOrderedGoal.
 */
export function createSequenceFromCommand(
  sessionID: string,
  conditions: string[],
  options: GoalOptions,
  currentAgent: string | undefined,
): GoalState[] {
  const restricted = restrictedAgentSet(options);
  const planningOnly = isPlanAgent(currentAgent, restricted);
  const goals: GoalState[] = [];
  sessionOrdered.add(sessionID);
  cleanupGoal(sessionID);
  lastGoalResults.delete(sessionID);
  for (let i = 0; i < conditions.length; i += 1) {
    const goal = buildGoalState(sessionID, conditions[i], options);
    if (planningOnly) {
      goal.stopped = true;
      goal.stopReason = "plan mode";
      goal.lastStatus =
        "Created from a restricted planning agent; paused until you switch to Build mode.";
    } else if (i > 0) {
      goal.stopped = true;
      goal.stopReason = "queued";
      goal.lastStatus = `Queued in an ordered sequence (position ${i + 1}).`;
      pushHistoryEntry(goal, "queued", `Queued in an ordered sequence (position ${i + 1}).`);
    }
    registerSessionGoal(goal);
    goals.push(goal);
  }
  const first = goals[0];
  if (first) focusGoal(sessionID, first);
  return goals;
}
