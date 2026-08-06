import type { OpencodeClient } from "@opencode-ai/sdk";
import type { Hooks } from "@opencode-ai/plugin";
import type { DesignLabConfig } from "../config/schema";
import { extractGoalsConfig } from "./config";
import type { GoalOptions } from "./config";
import {
  addGoalFromCommand,
  createGoalFromCommand,
  createSequenceFromCommand,
  handleGoalControl,
} from "./command";
import { parseGoalArguments, formatArgumentErrors } from "./flags";
import {
  goalIsBlocked,
  goalIsComplete,
  extractBlockedReason,
  extractCompletionEvidence,
} from "./completion";
import {
  messageHasToolCall,
  normalizeMessageUsage,
  outputTokensForMessage,
  toNonNegativeInteger,
  totalTokensForMessage,
} from "./limits";
import { isPlanAgent, restrictedAgentSet } from "./plan-mode";
import {
  cleanupGoal,
  goalStates,
  promoteNextOrderedGoal,
  rememberGoalResult,
  sessionOrdered,
  sessionStatuses,
  sessionExecutionContexts,
  summarizeText,
} from "./state";
import { loadPersistedSessionState, persistState, writeGoalLedger } from "./persistence";
import type { GoalState } from "./state";
import { buildAgentToolHandlers, buildAgentTools } from "./tools";
import {
  checkIdleGate,
  cooldownRemainingMs,
  runIdleContinuation,
} from "./auto-continue";
import { buildCompactionContext, buildGoalBlock } from "./prompts";

const COMMAND_NAME = "goal";

type ClientLike = Pick<OpencodeClient, "session" | "app">;

// The SDK's Event is a discriminated union; goal hooks only need a loose,
// best-effort read of the session id and idle status.
type LooseEventProperties = {
  sessionID?: unknown;
  status?: { type?: string };
  info?: { status?: { type?: string } };
};

export function createGoalsHooks(
  client: ClientLike,
  resolveConfig: () => DesignLabConfig | null,
): Hooks {
  let options: GoalOptions = extractGoalsConfig(resolveConfig());
  let restricted = restrictedAgentSet(options);
  const sessionLoads = new Map<string, Promise<unknown>>();
  const controlTurnSessions = new Set<string>();

  const ensureSessionLoaded = async (sessionID: string): Promise<void> => {
    if (!options.persist_state || !sessionID) return;
    if (goalStates.has(sessionID)) return;
    if (sessionLoads.has(sessionID)) {
      await sessionLoads.get(sessionID);
      return;
    }
    const load = loadPersistedSessionState(options, sessionID);
    sessionLoads.set(sessionID, load);
    try {
      await load;
    } finally {
      sessionLoads.delete(sessionID);
    }
  };

  const persist = (sessionID: string): Promise<boolean> =>
    persistState(options, sessionID);

  const writeLedger = (
    sessionID: string,
    goal: GoalState | null,
    type: string,
    detail: string,
  ): boolean => writeGoalLedger(options, sessionID, goal, type, detail);

  /**
   * Scan the latest assistant turn for an evidence-gated completion or a
   * concrete blocker. When found, archive (or pause as blocked) the goal and
   * return true so the idle handler stops auto-continuing. Unsubstantiated
   * markers are rejected by returning false (the loop keeps going).
   */
  const handleAssistantTerminalMarker = async (
    sessionID: string,
    goal: NonNullable<ReturnType<typeof goalStates.get>>,
  ): Promise<{
    done: boolean;
    completionUnverified: boolean;
    blockerUnstated: boolean;
  }> => {
    const result = { done: false, completionUnverified: false, blockerUnstated: false };

    // Fetch the latest assistant message every idle; use goal.lastAssistantText
    // only as a fallback when the fetch yields no text. Re-fetching each turn
    // keeps token accounting and marker scanning live for every continuation.
    let assistantMsg:
      | {
          info?: { role?: string; tokens?: unknown };
          parts?: unknown[];
          synthetic?: boolean;
        }
      | null
      | undefined = null;
    try {
      const res = await client.session.messages({
        path: { id: sessionID },
      });
      const messages = (res as { data?: unknown }).data as
        | Array<{
            info?: { role?: string; tokens?: unknown };
            parts?: unknown[];
          }>
        | undefined;
      assistantMsg =
        [...(messages ?? [])].reverse().find((m) => m?.info?.role === "assistant") ??
        null;
    } catch {
      assistantMsg = null;
    }
    if (!assistantMsg && goal.lastAssistantText) {
      // Fetch failed or no assistant turn yet; fall back to cached text for
      // marker scanning only. Marked synthetic so it never feeds progress
      // accounting (which would false-pause a healthy goal).
      assistantMsg = { info: { role: "assistant" }, parts: [], synthetic: true };
    }

    // Token / usage accounting for safety limits. Only a real fetched message
    // (not the synthetic fetch-failure fallback) contributes to progress
    // accounting, so a healthy goal never false-pauses as "no progress".
    const realAssistantMsg = assistantMsg && !assistantMsg.synthetic ? assistantMsg : null;
    if (realAssistantMsg) {
      const total = totalTokensForMessage(realAssistantMsg);
      if (total > goal.totalTokens) {
        goal.totalTokens = total;
        goal.usage = normalizeMessageUsage(realAssistantMsg);
        goal.lastProgressAt = Date.now();
      }
      const latestOutputTokens = outputTokensForMessage(realAssistantMsg);
      const latestHasToolCall = messageHasToolCall(realAssistantMsg);
      const latestHasThinking =
        toNonNegativeInteger(
          ((realAssistantMsg as { info?: { tokens?: { reasoning?: unknown } } })
            .info?.tokens as { reasoning?: unknown } | undefined)?.reasoning,
        ) > 0;
      const lowOutputTurn =
        goal.turnCount > 0 &&
        latestOutputTokens < goal.options.no_progress_token_threshold &&
        !latestHasToolCall &&
        !latestHasThinking;
      if (lowOutputTurn) {
        goal.noProgressTurns += 1;
        if (goal.noProgressTurns >= goal.options.no_progress_turns_before_pause) {
          goal.stopped = true;
          goal.stopReason = "no progress";
          goal.lastStatus = `Goal auto-continue paused after ${goal.noProgressTurns} low-progress turn(s); the latest turn produced ${latestOutputTokens} output token(s). Run /goal resume to continue.`;
          await persist(sessionID);
          return { done: true, completionUnverified: false, blockerUnstated: false };
        }
      } else {
        goal.noProgressTurns = 0;
      }
      if (
        goal.options.no_tool_call_turns_before_pause > 0 &&
        goal.turnCount > 0 &&
        Boolean(realAssistantMsg) &&
        !latestHasToolCall &&
        !lowOutputTurn
      ) {
        goal.noToolCallTurns += 1;
        if (
          goal.noToolCallTurns >= goal.options.no_tool_call_turns_before_pause
        ) {
          goal.stopped = true;
          goal.stopReason = "no tool calls";
          goal.lastStatus = `Goal auto-continue paused after ${goal.noToolCallTurns} continuation turn(s) with no tool calls (possible self-chat loop). Run /goal resume to continue.`;
          await persist(sessionID);
          return { done: true, completionUnverified: false, blockerUnstated: false };
        }
      } else if (latestHasToolCall) {
        goal.noToolCallTurns = 0;
      }
    }

    // Build the latest assistant text for marker scanning — prefer the fetched
    // message so markers on any turn (not just the first) are seen.
    let latestText = "";
    if (assistantMsg) {
      latestText =
        (assistantMsg.parts as Array<{ type?: string; text?: string }> | undefined)
          ?.filter((p) => p?.type === "text" && p.text)
          .map((p) => p.text)
          .join("\n") ?? "";
    }
    if (!latestText) latestText = goal.lastAssistantText;
    if (latestText) goal.lastAssistantText = latestText;

    if (goalIsComplete(latestText)) {
      const evidence = extractCompletionEvidence(latestText);
      if (evidence) {
        const ledgerDurable = writeLedger(
          sessionID,
          goal,
          "completed",
          `Assistant marked the goal complete with evidence: ${summarizeText(evidence, 400)}`,
        );
        goal.lastStatus = "Goal completed.";
        cleanupGoal(sessionID);
        rememberGoalResult(sessionID, goal, "achieved", "", evidence);
        if (sessionOrdered.has(sessionID)) {
          promoteNextOrderedGoal(sessionID);
        }
        await persist(sessionID);
        void ledgerDurable;
        return { done: true, completionUnverified: false, blockerUnstated: false };
      }
      // Unsubstantiated completion: reject, keep going (re-prompt for evidence).
      goal.formatFailures += 1;
      goal.lastStatus =
        "Rejected [goal:complete]: no [goal:evidence] line provided. Re-prompting for evidence.";
      result.completionUnverified = true;
      return result;
    }

    if (goalIsBlocked(latestText)) {
      const reason = extractBlockedReason(latestText);
      if (reason) {
        writeLedger(sessionID, goal, "blocked", reason);
        goal.blockedReason = reason;
        goal.lastStatus = "Assistant reported blocked.";
        goal.stopped = true;
        goal.stopReason = "blocked";
        await persist(sessionID);
        return { done: true, completionUnverified: false, blockerUnstated: false };
      }
      goal.formatFailures += 1;
      goal.lastStatus =
        "Rejected [goal:blocked]: no concrete blocker stated. Re-prompting for the blocker.";
      result.blockerUnstated = true;
      return result;
    }

    return result;
  };

  const promptAsync = async (
    sessionID: string,
    parts: { type: "text"; text: string }[],
    context?: Record<string, unknown>,
  ): Promise<{ error?: { name?: string; message?: string } | null }> => {
    try {
      const result = await client.session.promptAsync({
        path: { id: sessionID },
        body: {
          ...(context ?? {}),
          parts,
        },
      });
      const error = result.error;
      if (error) {
        // SDK errors are untyped payloads (data/errors/success); normalize to
        // the name/message shape the continuation loop expects.
        const raw = error as { name?: unknown; message?: unknown };
        const name = typeof raw.name === "string" ? raw.name : "prompt error";
        const message =
          typeof raw.message === "string" ? raw.message : JSON.stringify(error);
        return { error: { name, message } };
      }
      return {};
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { error: { name: "prompt error", message } };
    }
  };

  const currentOptions = (): GoalOptions => options;

  const handlers = buildAgentToolHandlers({
    defaultGoalOptions: currentOptions(),
    persist,
  });

  const parseArgs = (args: string) =>
    parseGoalArguments(args, currentOptions());

  const hooks: Hooks = {
    tool: buildAgentTools(
      handlers,
      (ctx) => ctx.sessionID ?? "",
      persist,
      currentOptions(),
    ),

    config: async (config) => {
      options = extractGoalsConfig(resolveConfig());
      restricted = restrictedAgentSet(options);
      config.command = {
        ...(config.command ?? {}),
        [COMMAND_NAME]: {
          description:
            "Set a session-scoped goal and auto-continue until complete, blocked, or a safety limit.",
          template: "$ARGUMENTS",
          agent: "build",
        },
      };
    },

    "chat.params": async (input) => {
      if (!input?.sessionID) return;
      await ensureSessionLoaded(input.sessionID);
      sessionExecutionContexts.set(input.sessionID, {
        agent: input.agent,
        model: input.model,
      });
    },

    "command.execute.before": async (input, output) => {
      if (!input || input.command !== COMMAND_NAME || !output) return;
      const sessionID = input.sessionID;
      if (!sessionID) return;
      await ensureSessionLoaded(sessionID);
      if (typeof input.arguments !== "string") return;
      const args = input.arguments.trim();
      if (args.length > 32 * 1024) return;

      const agent =
        (sessionExecutionContexts.get(sessionID)?.agent as
          string | undefined) ?? undefined;
      const CONTROL_WORDS = [
        "status",
        "history",
        "list",
        "pause",
        "clear",
        "stop",
        "off",
        "reset",
        "none",
        "cancel",
      ];
      const CLEAR_WORDS = new Set(["clear", "stop", "off", "reset", "none", "cancel"]);
      // Control subcommands must be exact tokens (or resume/focus + index) so
      // a goal condition like "stop the leak" is NOT misread as a control word.
      const isControl =
        !args ||
        CONTROL_WORDS.includes(args) ||
        /^resume(?:\s+\d+)?$/i.test(args) ||
        /^focus\s+\d+$/i.test(args);

      if (isControl) {
        const text = await handleGoalControl(
          sessionID,
          args,
          COMMAND_NAME,
          agent,
          options,
        );
        controlTurnSessions.add(sessionID);
        // Record the lifecycle transition in the ledger for crash recovery.
        const transitionGoal = goalStates.get(sessionID) ?? null;
        if (args === "pause") {
          writeLedger(sessionID, transitionGoal, "paused", "Paused via /goal pause.");
        } else if (args === "resume") {
          writeLedger(sessionID, transitionGoal, "resumed", "Resumed via /goal resume.");
        } else if (CLEAR_WORDS.has(args)) {
          writeLedger(sessionID, transitionGoal, "cleared", "Cleared via /goal clear.");
        }
        replaceParts(output, frameControlText(text));
        return;
      }

      // /goal add <condition>: background the current goal, focus a new one.
      const addMatch = args.match(/^add(?:\s+(.*))?$/i);
      if (addMatch) {
        const condition = (addMatch[1] ?? "").trim();
        if (!condition) {
          replaceParts(
            output,
            frameControlText("Provide a condition: /goal add <condition>"),
          );
          return;
        }
        const parsed = parseArgs(condition);
        if (parsed.errors.length > 0) {
          replaceParts(
            output,
            frameControlText(formatArgumentErrors(parsed.errors)),
          );
          return;
        }
        const goal = addGoalFromCommand(
          sessionID,
          parsed.condition,
          parsed.options,
          parsed.meta,
          agent,
        );
        writeLedger(sessionID, goal, "set", `Goal added via /goal add: ${goal.condition}`);
        await persist(sessionID);
        const workText = buildGoalWorkInstruction(goal);
        replaceParts(output, workText, { work: true });
        return;
      }

      // /goal sequence a; b; c — run objectives one at a time.
      const seqMatch = args.match(/^sequence(?:\s+(.*))?$/i);
      if (seqMatch) {
        const body = (seqMatch[1] ?? "").trim();
        const conditions = body
          .split(/[;\n]/)
          .map((c) => c.trim())
          .filter(Boolean);
        if (conditions.length === 0) {
          replaceParts(
            output,
            frameControlText(
              "Provide objectives separated by ';': /goal sequence a; b; c",
            ),
          );
          return;
        }
        const goals = createSequenceFromCommand(sessionID, conditions, options, agent);
        for (const g of goals) {
          writeLedger(sessionID, g, "set", `Sequence goal: ${g.condition}`);
        }
        await persist(sessionID);
        const focused = goalStates.get(sessionID);
        const workText = focused
          ? buildGoalWorkInstruction(focused)
          : "Ordered sequence set, but no active goal could be focused.";
        replaceParts(output, workText, { work: true });
        return;
      }

      const parsed = parseArgs(args);
      if (parsed.errors.length > 0) {
        replaceParts(
          output,
          frameControlText(formatArgumentErrors(parsed.errors)),
        );
        return;
      }
      if (!parsed.condition) {
        const text = await handleGoalControl(
          sessionID,
          "",
          COMMAND_NAME,
          agent,
          options,
        );
        replaceParts(output, frameControlText(text));
        return;
      }
      const goal = createGoalFromCommand(
        sessionID,
        parsed.condition,
        parsed.options,
        parsed.meta,
        agent,
      );
      if (!goal) return;
      writeLedger(
        sessionID,
        goal,
        "set",
        `Goal created via /goal with limits: ${goal.options.max_auto_turns} turns, ${Math.round(goal.options.max_duration_ms / 1000)}s, ${goal.options.max_tokens.toLocaleString()} tokens.`,
      );
      await persist(sessionID);
      const workText = buildGoalWorkInstruction(goal);
      replaceParts(output, workText, { work: true });
    },

    "chat.message": async (input, output) => {
      const sessionID = input?.sessionID;
      if (!sessionID) return;
      await ensureSessionLoaded(sessionID);
      const parts = Array.isArray(output?.parts) ? output.parts : [];
      const isPluginGenerated = parts.some(
        (part) =>
          part &&
          typeof part === "object" &&
          (part as { synthetic?: boolean }).synthetic === true &&
          (part as { metadata?: Record<string, unknown> }).metadata?.[
            "opencode-goal-plugin"
          ],
      );
      if (isPluginGenerated) {
        controlTurnSessions.delete(sessionID);
        return;
      }
      controlTurnSessions.delete(sessionID);
      const goal = goalStates.get(sessionID);
      if (!goal || goal.stopped) return;
      if (goal.turnCount > 0) {
        goal.stopped = true;
        goal.stopReason = "user intervention";
        goal.lastStatus =
          "Auto-continue paused because a new human message arrived; the latest instruction wins.";
        await persist(sessionID);
      }
    },

    "tool.execute.before": async (input) => {
      if (!input?.sessionID) return;
      if (controlTurnSessions.has(input.sessionID)) {
        throw new Error(
          "This /goal control command has already been handled. No tool calls are allowed while its result is being reported.",
        );
      }
    },

    event: async ({ event }) => {
      if (!event?.type) return;
      const properties = (event as { properties?: LooseEventProperties })
        .properties;
      const sessionID =
        (properties?.sessionID as string | undefined) ??
        (event as { data?: { sessionID?: string } }).data?.sessionID ??
        "";
      if (!sessionID) return;
      await ensureSessionLoaded(sessionID);
      if (event.type === "session.idle") {
        sessionStatuses.set(sessionID, "idle");
        controlTurnSessions.delete(sessionID);
      } else if (event.type === "session.status") {
        const status = (properties?.status as { type?: string } | undefined)
          ?.type;
        sessionStatuses.set(sessionID, status ?? "");
        if (status === "idle") controlTurnSessions.delete(sessionID);
      } else if (event.type === "session.updated") {
        // SDK: properties.info is the Session object (not properties.status).
        const info = (properties as { info?: { status?: string } })
          ?.info;
        sessionStatuses.set(sessionID, info?.status ?? "");
      }
      if (event.type !== "session.idle" && event.type !== "session.status")
        return;
      // Only an explicit idle may continue; never default an unknown/busy
      // status to idle (that would fire a continuation mid-turn).
      const status = sessionStatuses.get(sessionID);
      if (status !== "idle") return;

      const goal = goalStates.get(sessionID);
      if (!goal || goal.stopped) return;
      const context = sessionExecutionContexts.get(sessionID);
      const planAgentActive = isPlanAgent(context?.agent, restricted);
      const gate = checkIdleGate(goal, sessionID, {
        sessionStatus: status,
        planAgentActive,
        userIntervention: false,
        alreadyContinuing: false,
      });
      if (!gate.pass) {
        if (planAgentActive && !goal.stopped) {
          goal.stopped = true;
          goal.stopReason = "plan agent active";
          goal.lastStatus =
            "Auto-continue paused because the active agent switched to Plan.";
          await persist(sessionID);
        }
        return;
      }
      // Evidence-gated completion: if the latest assistant turn ended with
      // [goal:complete]/[goal:blocked], archive or pause the goal instead of
      // continuing the loop. Also accounts tokens/progress/tool-calls.
      const marker = await handleAssistantTerminalMarker(sessionID, goal);
      if (marker.done) return;
      // The marker handler may have rejected an unsubstantiated claim and the
      // goal could have hit its failure cap; re-check before continuing.
      if (goal.stopped) return;
      // Pause after too many consecutive format-validation failures (rejected
      // completions/blockers without the required evidence or blocker line).
      if (goal.formatFailures >= goal.options.max_prompt_failures) {
        goal.stopped = true;
        goal.stopReason = "format validation failures";
        goal.lastStatus = `Paused after ${goal.formatFailures} consecutive format-validation failure(s) (missing [goal:evidence] or concrete blocker). Run /goal resume to retry.`;
        await persist(sessionID);
        return;
      }
      const cooldown = cooldownRemainingMs(goal);
      if (cooldown > 0) return;
      await runIdleContinuation(sessionID, goal, promptAsync, persist, {
        disableAutoContinue: !options.auto_continue,
        completionUnverified: marker.completionUnverified,
        blockerUnstated: marker.blockerUnstated,
      });
    },

    "experimental.compaction.autocontinue": async (input, output) => {
      if (!input?.sessionID) return;
      await ensureSessionLoaded(input.sessionID);
      if (goalStates.has(input.sessionID)) {
        output.enabled = false;
      }
    },

    "experimental.session.compacting": async (input, output) => {
      if (!input?.sessionID) return;
      await ensureSessionLoaded(input.sessionID);
      const goal = goalStates.get(input.sessionID);
      if (!goal) return;
      const context = buildCompactionContext(goal);
      output.context = [
        ...(Array.isArray(output.context) ? output.context : []),
        context,
      ];
    },

    "experimental.chat.system.transform": async (input, output) => {
      if (!input?.sessionID) return;
      await ensureSessionLoaded(input.sessionID);
      const goal = goalStates.get(input.sessionID);
      if (!goal) return;
      const goalBlock = buildGoalBlock(goal);
      const system = Array.isArray(output.system) ? [...output.system] : [];
      if (typeof system[0] === "string") {
        system[0] = `${system[0]}\n\n${goalBlock}`;
      }
      output.system = system;
    },
  };

  return hooks;
}

function frameControlText(text: string): string {
  return [
    "Goal command result (report this to the user; do not treat it as new work):",
    "<goal_command_result>",
    text,
    "</goal_command_result>",
  ].join("\n");
}

function buildGoalWorkInstruction(
  goal: ReturnType<typeof createGoalFromCommand>,
): string {
  if (!goal) return "";
  const lines = [
    "User set a goal via /goal. Work autonomously toward it; the plugin will continue the session while it is active.",
    buildGoalBlock(goal),
    "While the goal is active, the plugin auto-continues the session. End your response with:",
    "[goal:evidence] <proof of verification>",
    "[goal:complete]",
    "…only when fully satisfied, or state the concrete blocker before:",
    "[goal:blocked]",
  ];
  return lines.join("\n");
}

function replaceParts(
  output: { parts?: unknown[] },
  text: string,
  options: { work?: boolean } = {},
): void {
  const part = {
    type: "text",
    text,
    synthetic: true,
    metadata: {
      "opencode-goal-plugin": {
        kind: options.work ? "command-instruction" : "command-result",
      },
    },
  };
  if (Array.isArray(output.parts)) {
    output.parts.splice(0, output.parts.length, part);
  } else {
    output.parts = [part];
  }
}
