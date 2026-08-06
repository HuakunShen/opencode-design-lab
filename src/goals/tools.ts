import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition, ToolContext } from "@opencode-ai/plugin";
import type { GoalOptions } from "./config";
import { MAX_LEGACY_EVIDENCE_LENGTH, serializeCompletionClaim } from "./completion";
import { formatStatus } from "./command";
import { isPlanAgent, restrictedAgentSet } from "./plan-mode";
import {
  MAX_GOAL_META_LENGTH,
  MAX_GOAL_OBJECTIVE_LENGTH,
  buildGoalState,
  cleanupGoal,
  focusGoal,
  goalDisplayState,
  goalStates,
  lastGoalResults,
  pauseGoalClock,
  pushHistoryEntry,
  registerSessionGoal,
  rememberGoalResult,
  resumeGoalClock,
  sessionOrdered,
  summarizeText,
} from "./state";
import { normalizeMode } from "./flags";

const AGENT_UPDATE_STATUSES = new Set([
  "complete",
  "blocked",
  "paused",
  "resumed",
]);
const AGENT_COMPLETE_SUCCESS = "Goal marked complete and archived.";
const AGENT_BLOCK_SUCCESS = "Goal marked blocked.";

export type AgentToolHandlers = {
  defaultGoalOptions: GoalOptions;
  persist: (sessionID: string) => Promise<boolean>;
};

type UpdateArgs = {
  objective?: string;
  status?: string;
  evidence?: string;
  blocker?: string;
  claim?: Record<string, unknown>;
};

export function buildAgentToolHandlers({
  defaultGoalOptions,
  persist,
}: AgentToolHandlers) {
  async function getGoal(sessionID: string): Promise<string> {
    const goal = goalStates.get(sessionID);
    if (goal) return formatStatus(goal, "goal");
    const lastResult = lastGoalResults.get(sessionID);
    if (lastResult) {
      return `Last goal: ${lastResult.condition}\nState: ${lastResult.state}\n${
        lastResult.evidence ? `Evidence: ${lastResult.evidence}\n` : ""
      }`;
    }
    return "No active goal.";
  }

  async function setGoal(
    sessionID: string,
    args: Record<string, unknown> = {},
    agent?: string,
  ): Promise<string> {
    const objective =
      typeof args.objective === "string" ? args.objective.trim() : "";
    if (!objective)
      return "No objective provided. Pass a non-empty `objective`.";
    if (objective.length > MAX_GOAL_OBJECTIVE_LENGTH) {
      return `Invalid objective: must be ${MAX_GOAL_OBJECTIVE_LENGTH} characters or fewer.`;
    }
    for (const [field, value] of [
      ["successCriteria", args.successCriteria],
      ["constraints", args.constraints],
    ] as const) {
      if (typeof value === "string" && value.length > MAX_GOAL_META_LENGTH) {
        return `Invalid ${field}: must be ${MAX_GOAL_META_LENGTH} characters or fewer.`;
      }
    }
    const restricted = restrictedAgentSet(defaultGoalOptions);
    const planningOnly = isPlanAgent(agent, restricted);
    const goal = buildGoalState(
      sessionID,
      objective,
      { ...defaultGoalOptions },
      {
        successCriteria:
          typeof args.successCriteria === "string" ? args.successCriteria : "",
        constraints:
          typeof args.constraints === "string" ? args.constraints : "",
        mode:
          typeof args.mode === "string"
            ? (normalizeMode(args.mode) ?? "normal")
            : "normal",
      },
    );
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
    await persist(sessionID);
    return planningOnly
      ? `New goal created but paused (plan mode): ${goal.condition}. Switch to Build mode and resume to execute it.`
      : `New active goal: ${goal.condition}`;
  }

  async function updateGoal(
    sessionID: string,
    args: UpdateArgs = {},
    agent?: string,
  ): Promise<string> {
    const goal = goalStates.get(sessionID);
    if (!goal) return "No active goal to update. Use goal_set first.";

    // Validate the status value up front so the objective is not mutated when
    // the requested status is rejected.
    const status =
      args.status !== undefined
        ? String(args.status).trim().toLowerCase()
        : undefined;
    if (status !== undefined && !AGENT_UPDATE_STATUSES.has(status)) {
      return `Invalid status: ${args.status} (expected complete, blocked, paused, or resumed).`;
    }
    if (status === "blocked" && !(typeof args.blocker === "string" && args.blocker.trim())) {
      return "A non-empty blocker is required to mark a goal blocked.";
    }
    if (status === "resumed" && isPlanAgent(agent, restrictedAgentSet(defaultGoalOptions))) {
      return "Resume is refused while the active agent is a restricted planning agent. Switch to Build mode and resume there.";
    }

    if (
      typeof args.objective === "string" &&
      args.objective.trim() &&
      status === "complete"
    ) {
      return (
        "Cannot combine an objective update with status='complete'. " +
        "Use two separate calls: first update the objective, then mark it complete."
      );
    }

    if (typeof args.objective === "string" && args.objective.trim()) {
      if (args.objective.trim().length > MAX_GOAL_OBJECTIVE_LENGTH) {
        return `Invalid objective: must be ${MAX_GOAL_OBJECTIVE_LENGTH} characters or fewer.`;
      }
      goal.condition = args.objective.trim();
      goal.blockedReason = "";
      goal.budgetWrapupSent = false;
      goal.noProgressTurns = 0;
      goal.noToolCallTurns = 0;
      goal.formatFailures = 0;
      goal.lastStatus = "Goal objective updated.";
      pushHistoryEntry(
        goal,
        "edited",
        `Objective updated to: ${summarizeText(goal.condition, 400)}`,
      );
    }

    if (status !== undefined) {
      if (status === "complete") {
        const evidence =
          typeof args.evidence === "string" ? args.evidence.trim() : "";
        let claimError = "";
        let claimEvidence = "";
        if (args.claim !== undefined) {
          const claim = serializeCompletionClaim(args.claim);
          if (!claim.ok) {
            claimError = claim.error;
          } else {
            claimEvidence = claim.evidence;
          }
        }
        if (claimError) return `Invalid completion claim: ${claimError}.`;
        if (!evidence && !claimEvidence) {
          return "Completion evidence is required before a goal can be archived.";
        }
        if (evidence.length > MAX_LEGACY_EVIDENCE_LENGTH) {
          return `Evidence must be ${MAX_LEGACY_EVIDENCE_LENGTH} characters or fewer.`;
        }
        const finalEvidence = claimEvidence || evidence;
        goal.blockedReason = "";
        goal.stopped = true;
        goal.stopReason = "completed";
        goal.lastStatus = "Goal completed.";
        pushHistoryEntry(
          goal,
          "completed",
          `Marked complete via tool: ${summarizeText(finalEvidence, 400)}`,
        );
        cleanupGoal(sessionID);
        rememberGoalResult(sessionID, goal, "achieved", "", finalEvidence);
        await persist(sessionID);
        return AGENT_COMPLETE_SUCCESS;
      }
      if (status === "blocked") {
        const blocker =
          typeof args.blocker === "string" ? args.blocker.trim() : "";
        goal.blockedReason = blocker;
        goal.lastStatus = "Assistant reported blocked.";
        goal.stopped = true;
        goal.stopReason = "blocked";
        pushHistoryEntry(goal, "blocked", blocker);
        await persist(sessionID);
        return AGENT_BLOCK_SUCCESS;
      }
      if (status === "paused") {
        goal.stopped = true;
        goal.stopReason = "user requested pause";
        goal.blockedReason = "";
        goal.lastStatus = "Paused via goal tool.";
        pauseGoalClock(goal);
        pushHistoryEntry(goal, "paused", "Paused via the goal_pause tool.");
        await persist(sessionID);
        return "Goal paused.";
      }
      if (status === "resumed") {
        if (!goal.stopped) return "Goal is already running.";
        goal.stopped = false;
        goal.stopReason = "";
        goal.blockedReason = "";
        goal.promptFailures = 0;
        goal.formatFailures = 0;
        goal.budgetWrapupSent = false;
        goal.lastStatus = "Resumed.";
        resumeGoalClock(goal);
        pushHistoryEntry(goal, "resumed", "Resumed via the goal_resume tool.");
        await persist(sessionID);
        return "Goal resumed with a fresh budget window.";
      }
    }
    await persist(sessionID);
    return `Goal updated; state remains ${goalDisplayState(goal)}.`;
  }

  return { getGoal, setGoal, updateGoal };
}

export function buildAgentTools(
  handlers: ReturnType<typeof buildAgentToolHandlers>,
  resolveSessionID: (ctx: { sessionID?: string }) => string,
  persist: (sessionID: string) => Promise<boolean>,
  defaultGoalOptions: GoalOptions,
): Record<string, ToolDefinition> {
  const run =
    (
      operation: (
        sessionID: string,
        args: Record<string, unknown>,
        ctx: ToolContext,
      ) => Promise<string>,
    ) =>
    async (args: Record<string, unknown>, ctx: ToolContext) => {
      const sessionID = resolveSessionID(ctx);
      if (!sessionID) return "No session id available for the goal tool.";
      return operation(sessionID, args ?? {}, ctx);
    };

  return {
    goal_status: tool({
      description:
        "Return the current goal state in a compact, versioned JSON envelope.",
      args: {},
      execute: run(async (sessionID) => handlers.getGoal(sessionID)),
    }),
    goal_set: tool({
      description:
        "Set or replace the session goal. Call only when the user explicitly asks to set or pursue a goal.",
      args: {
        objective: tool.schema.string().min(1),
        successCriteria: tool.schema.string().optional(),
        constraints: tool.schema.string().optional(),
        mode: tool.schema.enum(["normal", "ordered"]).optional(),
      },
      execute: run(async (sessionID, args, ctx) => {
        if (typeof args.objective !== "string" || !args.objective.trim()) {
          return "No objective provided. Pass a non-empty objective.";
        }
        return handlers.setGoal(sessionID, args, ctx.agent);
      }),
    }),
    goal_pause: tool({
      description: "Pause the current goal without discarding its state.",
      args: {},
      execute: run(async (sessionID, args, ctx) =>
        handlers.updateGoal(sessionID, { status: "paused" }, ctx.agent),
      ),
    }),
    goal_resume: tool({
      description: "Resume a stopped goal with a fresh local budget window.",
      args: {},
      execute: run(async (sessionID, args, ctx) =>
        handlers.updateGoal(sessionID, { status: "resumed" }, ctx.agent),
      ),
    }),
    goal_block: tool({
      description:
        "Stop the current goal as blocked and state the concrete external requirement.",
      args: { blocker: tool.schema.string().min(1) },
      execute: run(async (sessionID, args, ctx) =>
        handlers.updateGoal(
          sessionID,
          {
            status: "blocked",
            blocker: typeof args.blocker === "string" ? args.blocker : "",
          },
          ctx.agent,
        ),
      ),
    }),
    goal_complete: tool({
      description:
        "Submit structured completion evidence. The evidence gate requires a summary and criterion evidence before a goal is archived.",
      args: {
        summary: tool.schema.string().min(1),
        criteria: tool.schema
          .array(
            tool.schema.object({
              criterion: tool.schema.string(),
              evidence: tool.schema.array(tool.schema.string()),
            }),
          )
          .optional(),
        checks: tool.schema
          .array(
            tool.schema.object({
              command: tool.schema.string().optional(),
              result: tool.schema.enum(["passed", "failed", "not-run"]),
              exitCode: tool.schema.number().optional(),
              explanation: tool.schema.string().optional(),
            }),
          )
          .optional(),
        changedFiles: tool.schema.array(tool.schema.string()).optional(),
        knownLimitations: tool.schema.array(tool.schema.string()).optional(),
      },
      execute: run(async (sessionID, args) => {
        const claim = serializeCompletionClaim(args);
        if (!claim.ok) return `Invalid completion claim: ${claim.error}.`;
        return handlers.updateGoal(sessionID, {
          status: "complete",
          claim: args,
        });
      }),
    }),
  };
}
