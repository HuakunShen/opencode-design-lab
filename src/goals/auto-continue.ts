import { randomUUID } from "crypto";
import { activeContinues, continuationControllers } from "./state";
import type { GoalState } from "./state";
import { budgetWrapupNeeded, stopReason } from "./limits";
import { buildContinueMessage } from "./prompts";

export type IdleGateInput = {
  sessionStatus: string;
  planAgentActive: boolean;
  userIntervention: boolean;
  alreadyContinuing: boolean;
};

export type IdleGateResult = {
  pass: boolean;
  reason: string;
};

export function checkIdleGate(
  goal: GoalState,
  sessionID: string,
  input: IdleGateInput,
): IdleGateResult {
  if (goal.stopped) return { pass: false, reason: "goal is stopped" };
  if (input.alreadyContinuing) {
    return { pass: false, reason: "a continuation is already in flight" };
  }
  if (input.planAgentActive) {
    return {
      pass: false,
      reason: "plan agent is active; auto-continue suppressed",
    };
  }
  if (input.userIntervention) {
    return {
      pass: false,
      reason: "a new user message arrived; latest instruction wins",
    };
  }
  if (input.sessionStatus !== "idle") {
    return {
      pass: false,
      reason: `session is not idle (${input.sessionStatus})`,
    };
  }
  return { pass: true, reason: "ready" };
}

export function cooldownRemainingMs(goal: GoalState): number {
  if (!goal.lastContinueAt) return 0;
  const elapsed = Date.now() - goal.lastContinueAt;
  const remaining = goal.options.min_delay_ms - elapsed;
  return remaining > 0 ? remaining : 0;
}

export function shouldContinue(
  goal: GoalState,
  sessionID: string,
  input: IdleGateInput & { lastContinueAt: number },
): boolean {
  const gate = checkIdleGate(goal, sessionID, input);
  if (!gate.pass) return false;
  return cooldownRemainingMs(goal) === 0;
}

export function buildContinuationCheck(
  goal: GoalState,
  sessionID: string,
  input: IdleGateInput,
): string {
  const gate = checkIdleGate(goal, sessionID, input);
  const cooldown = cooldownRemainingMs(goal);
  return gate.pass && cooldown === 0
    ? "READY: goal continuation may proceed"
    : `WAIT: ${gate.reason}${
        cooldown > 0 ? `; cooldown ${cooldown}ms remaining` : ""
      }`;
}

export async function runIdleContinuation(
  sessionID: string,
  goal: GoalState,
  promptAsync: (
    sessionID: string,
    parts: {
      type: "text";
      text: string;
      synthetic?: boolean;
      metadata?: Record<string, unknown>;
    }[],
    context?: Record<string, unknown>,
  ) => Promise<{ error?: { name?: string; message?: string } | null }>,
  persist: (sessionID: string) => Promise<boolean>,
  options: {
    disableAutoContinue?: boolean;
    completionUnverified?: boolean;
    blockerUnstated?: boolean;
  } = {},
): Promise<boolean> {
  if (options.disableAutoContinue || !goal.options.auto_continue) return false;
  if (activeContinues.has(sessionID)) return false;
  const limitReason = stopReason(goal);
  if (limitReason) return false;

  const continueToken = randomUUID();
  const controller = new AbortController();
  activeContinues.set(sessionID, continueToken);
  continuationControllers.set(sessionID, controller);
  const budgetWrapup = budgetWrapupNeeded(goal);

  try {
    goal.turnCount += 1;
    goal.lastContinueAt = Date.now();
    goal.lastStatus = budgetWrapup
      ? "Budget threshold reached; requested final handoff."
      : `Continuing after turn ${goal.turnCount}.`;
    const message = buildContinueMessage(goal, {
      budgetWrapup,
      completionUnverified: options.completionUnverified,
      blockerUnstated: options.blockerUnstated,
    });
    const response = await promptAsync(sessionID, [
      {
        type: "text",
        text: message,
        synthetic: true,
        metadata: {
          "opencode-goal-plugin": { kind: "continuation", id: continueToken },
        },
      },
    ]);
    const err = response?.error ?? null;
    if (err) {
      goal.promptFailures += 1;
      goal.lastStatus = `Auto-continue failed: ${err.name || "unknown error"}`;
      if (goal.promptFailures >= goal.options.max_prompt_failures) {
        goal.stopped = true;
        goal.stopReason = "auto-continue failures";
      }
    }
    await persist(sessionID);
    return true;
  } catch (error) {
    // A rejected promptAsync must still escalate like a returned error so a
    // flaky provider cannot retry forever without tripping the failure cap.
    const message = error instanceof Error ? error.message : String(error);
    goal.promptFailures += 1;
    goal.lastStatus = `Auto-continue failed: ${message}`;
    if (goal.promptFailures >= goal.options.max_prompt_failures) {
      goal.stopped = true;
      goal.stopReason = "auto-continue failures";
    }
    await persist(sessionID);
    return true;
  } finally {
    if (activeContinues.get(sessionID) === continueToken) {
      activeContinues.delete(sessionID);
    }
    if (continuationControllers.get(sessionID) === controller) {
      continuationControllers.delete(sessionID);
    }
  }
}
