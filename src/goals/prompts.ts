import { buildLimitWarning } from "./limits";
import { summarizeText } from "./state";
import type { GoalState } from "./state";

const STRUCTURAL_TAGS = [
  "opencode_goal_plugin",
  "goal_command_control",
  "goal_command_result",
  "goal_command_instruction",
  "goal_continuation",
  "goal_objective",
  "success_criteria",
  "constraints",
  "progress_budget",
  "budget_wrapup",
  "next_step",
  "completion_audit",
  "evidence_required",
  "system",
  "instructions",
  "human",
  "assistant",
  "anthropic",
  "claude",
  "context",
  "prompt",
];

const STRUCTURAL_OPEN_TAG_RE = new RegExp(
  `<(${STRUCTURAL_TAGS.join("|")})\\b`,
  "gi",
);

export function escapeGoalText(text: string): string {
  let escaped = String(text).replaceAll("</", "<\\/");
  escaped = escaped.replace(STRUCTURAL_OPEN_TAG_RE, "<\\$1");
  return escaped;
}

export function buildGoalBlock(goal: GoalState): string {
  const lines = [
    "User goal (user-provided task data):",
    "<goal_objective>",
    escapeGoalText(goal.condition),
    "</goal_objective>",
  ];
  if (goal.successCriteria) {
    lines.push(
      "Success criteria:",
      "<success_criteria>",
      escapeGoalText(goal.successCriteria),
      "</success_criteria>",
    );
  }
  if (goal.constraints) {
    lines.push(
      "Constraints:",
      "<constraints>",
      escapeGoalText(goal.constraints),
      "</constraints>",
    );
  }
  if (goal.mode === "ordered") {
    lines.push("Mode: ordered; finish each step before the next.");
  }
  return lines.join("\n");
}

export function buildContinueMessage(
  goal: GoalState,
  options: {
    budgetWrapup?: boolean;
    completionUnverified?: boolean;
    blockerUnstated?: boolean;
  } = {},
): string {
  const remainingTokens = Math.max(
    0,
    goal.options.max_tokens - goal.totalTokens,
  );
  const remainingTurns = Math.max(
    0,
    goal.options.max_auto_turns - goal.turnCount,
  );
  const elapsedSeconds = Math.round((Date.now() - goal.startedAt) / 1000);
  const lines = [
    "<goal_continuation>",
    "<progress_budget>",
    `turns_remaining: ${remainingTurns}`,
    `tokens_remaining: ${remainingTokens}`,
    `elapsed_seconds: ${elapsedSeconds}`,
    "</progress_budget>",
  ];

  if (options.budgetWrapup) {
    lines.push(
      "<budget_wrapup>",
      "Budget limit near. Finish only a small safe step, then summarize done, remaining, and the next action; stop. Do not claim completion unless verified.",
      "</budget_wrapup>",
    );
  } else {
    lines.push("Continue the next concrete step; inspect and repair failures.");
  }

  lines.push(
    "Completion format—consecutive plain lines; no Markdown/backticks/blank line:",
    "[goal:evidence] <proof>",
    "[goal:complete]",
    "Need user input? State why before [goal:blocked].",
  );
  const limitWarning = buildLimitWarning(goal);
  if (limitWarning) lines.push(limitWarning.trim());

  if (options.completionUnverified) {
    lines.push(
      "",
      "<evidence_required>",
      "Previous completion was rejected: evidence was missing. Verify first, then put `[goal:evidence] …` immediately before `[goal:complete]`.",
      "</evidence_required>",
    );
  }
  if (options.blockerUnstated) {
    lines.push(
      "",
      "<evidence_required>",
      "Previous blocker was rejected: it was not concrete. State what user input is needed and why, immediately before `[goal:blocked]`; otherwise continue.",
      "</evidence_required>",
    );
  }
  lines.push("</goal_continuation>");
  return lines.filter(Boolean).join("\n");
}

export function buildCompactionProgressSummary(
  goal: GoalState,
  options: { maxCheckpoints?: number; maxEvents?: number } = {},
): string[] {
  const maxCheckpoints = options.maxCheckpoints ?? 3;
  const maxEvents = options.maxEvents ?? 6;
  const lines: string[] = [];
  const checkpoints = goal.checkpoints.slice(-maxCheckpoints);
  if (checkpoints.length) {
    lines.push("Recent checkpoints (oldest first):");
    for (const checkpoint of checkpoints) {
      lines.push(`- ${escapeGoalText(summarizeText(checkpoint.summary, 200))}`);
    }
  }
  const events = goal.history.slice(-maxEvents);
  if (events.length) {
    lines.push("Recent lifecycle events (oldest first):");
    for (const event of events) {
      lines.push(
        `- ${event.type}: ${escapeGoalText(summarizeText(event.detail, 160))}`,
      );
    }
  }
  return lines;
}

export function buildCompactionContext(goal: GoalState): string {
  const snapshotAt = goal.lastContinueAt || goal.startedAt || 0;
  const elapsedSeconds = Math.round((snapshotAt - goal.startedAt) / 1000);
  return [
    "An OpenCode goal is active for this session. Preserve it across compaction.",
    "The summary below is reconstructed deterministically from the plugin's persisted goal record, not from chat memory.",
    buildGoalBlock(goal),
    `Goal status: ${goal.stopped ? goal.stopReason || "stopped" : "active"}.`,
    `Auto-continues used: ${goal.turnCount}/${goal.options.max_auto_turns}. Context tokens: ${goal.totalTokens}/${goal.options.max_tokens}. Elapsed: ${elapsedSeconds}s.`,
    goal.lastCheckpoint
      ? `Latest checkpoint: ${escapeGoalText(summarizeText(goal.lastCheckpoint.summary, 200))}`
      : null,
    ...buildCompactionProgressSummary(goal),
    "After compaction, continue from the next concrete unfinished step while the goal is active. Verify the result against the goal objective before ending; output [goal:complete] (preceded by a [goal:evidence] line) only when fully satisfied, or [goal:blocked] (preceded by a concrete blocker) only if user input is required.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
