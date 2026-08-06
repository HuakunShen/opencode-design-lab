import { randomUUID } from "crypto";
import { DEFAULT_GOAL_OPTIONS } from "./config";
import type { GoalOptions } from "./config";

export const MAX_HISTORY_ENTRIES = 20;
export const MAX_CHECKPOINTS = 5;
export const MAX_ARCHIVED_PER_SESSION = 10;
export const MAX_GOAL_OBJECTIVE_LENGTH = 4000;
export const MAX_GOAL_META_LENGTH = 2000;
export const MAX_GOAL_BLOCKER_LENGTH = 2000;

export type GoalMeta = {
  successCriteria: string;
  constraints: string;
  mode: "normal" | "ordered";
};

export const GOAL_META_DEFAULTS: GoalMeta = {
  successCriteria: "",
  constraints: "",
  mode: "normal",
};

export type Usage = {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  costKnown: boolean;
};

export type HistoryEntry = {
  type: string;
  detail: string;
  timestamp: number;
};

export type Checkpoint = {
  summary: string;
  timestamp: number;
};

export type GoalState = {
  goalId: string;
  runId: string;
  condition: string;
  successCriteria: string;
  constraints: string;
  mode: GoalMeta["mode"];
  sessionID: string;
  turnCount: number;
  startedAt: number;
  pausedAt: number;
  totalTokens: number;
  usage: Usage;
  options: Readonly<GoalOptions>;
  lastStatus: string;
  lastAssistantText: string;
  lastAssistantMessageID: string;
  lastContinueAt: number;
  lastProgressAt: number;
  noProgressTurns: number;
  noToolCallTurns: number;
  blockedReason: string;
  budgetWrapupSent: boolean;
  stopped: boolean;
  stopReason: string;
  promptFailures: number;
  formatFailures: number;
  executionContext: Record<string, unknown> | null;
  continuationClaim: { runId: string; sourceAssistantMessageID: string } | null;
  messageIDs: Set<string>;
  history: HistoryEntry[];
  checkpoints: Checkpoint[];
  lastCheckpoint: Checkpoint | null;
  skipNextTerminalCheck: boolean;
};

export type GoalResult = {
  condition: string;
  state: string;
  reason: string;
  evidence: string;
  blockedReason: string;
  turnCount: number;
  totalTokens: number;
  usage: Usage;
  startedAt: number;
  finishedAt: number;
  lastStatus: string;
  lastCheckpoint: Checkpoint | null;
};

/** In-memory collections (per plugin process). */
export const goalStates = new Map<string, GoalState>();
export const sessionGoals = new Map<string, Map<string, GoalState>>();
export const sessionArchive = new Map<string, GoalResult[]>();
export const sessionOrdered = new Set<string>();
export const lastGoalResults = new Map<string, GoalResult>();
export const activeContinues = new Map<string, string>();
export const continuationControllers = new Map<string, AbortController>();
export const promptInFlightSessions = new Set<string>();
export const seenIdleEventIDs = new Set<string>();
export const sessionStatuses = new Map<string, string>();
export const sessionExecutionContexts = new Map<string, Record<string, unknown>>();

export function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    costKnown: false,
  };
}

export function buildGoalState(
  sessionID: string,
  condition: string,
  options: Readonly<GoalOptions> = DEFAULT_GOAL_OPTIONS,
  meta: Partial<GoalMeta> = {},
  lastStatus = "Goal set.",
): GoalState {
  return {
    goalId: randomUUID(),
    runId: randomUUID(),
    condition,
    successCriteria: meta.successCriteria ?? "",
    constraints: meta.constraints ?? "",
    mode: meta.mode ?? "normal",
    sessionID,
    turnCount: 0,
    startedAt: Date.now(),
    pausedAt: 0,
    totalTokens: 0,
    usage: emptyUsage(),
    options,
    lastStatus,
    lastAssistantText: "",
    lastAssistantMessageID: "",
    lastContinueAt: 0,
    lastProgressAt: 0,
    noProgressTurns: 0,
    noToolCallTurns: 0,
    blockedReason: "",
    budgetWrapupSent: false,
    stopped: false,
    stopReason: "",
    promptFailures: 0,
    formatFailures: 0,
    executionContext: null,
    continuationClaim: null,
    messageIDs: new Set(),
    history: [],
    checkpoints: [],
    lastCheckpoint: null,
    skipNextTerminalCheck: false,
  };
}

export function registerSessionGoal(goal: GoalState): void {
  let map = sessionGoals.get(goal.sessionID);
  if (!map) {
    map = new Map();
    sessionGoals.set(goal.sessionID, map);
  }
  map.set(goal.goalId, goal);
}

export function listSessionGoals(sessionID: string): GoalState[] {
  const map = sessionGoals.get(sessionID);
  return map ? [...map.values()] : [];
}

export function removeSessionGoal(sessionID: string, goalId: string): void {
  const map = sessionGoals.get(sessionID);
  if (!map) return;
  map.delete(goalId);
  if (map.size === 0) sessionGoals.delete(sessionID);
}

export function focusGoal(sessionID: string, goal: GoalState): void {
  goalStates.set(sessionID, goal);
}

export function activeGoal(
  sessionID: string,
  goalId?: string,
  runId?: string,
): GoalState | null {
  if (goalId) {
    const found = sessionGoals.get(sessionID)?.get(goalId) ?? null;
    if (found) {
      if (runId && found.runId !== runId) return null;
      return found;
    }
  }
  const goal = goalStates.get(sessionID) ?? null;
  if (!goal) return null;
  if (goalId && goal.goalId !== goalId) return null;
  if (runId && goal.runId !== runId) return null;
  return goal;
}

export function goalDisplayState(goal: GoalState): string {
  if (!goal.stopped) return "active";
  return goal.stopReason === "blocked" ? "blocked" : "paused";
}

export function pauseGoalClock(goal: GoalState, timestamp = Date.now()): void {
  if (!goal.pausedAt) goal.pausedAt = timestamp;
}

export function resumeGoalClock(goal: GoalState, timestamp = Date.now()): void {
  if (goal.pausedAt) {
    goal.startedAt += Math.max(0, timestamp - goal.pausedAt);
    goal.pausedAt = 0;
  }
}

export function pushHistoryEntry(
  goal: GoalState,
  type: string,
  detail: string,
  timestamp = Date.now(),
): HistoryEntry {
  const entry = { type, detail: summarizeText(detail, 400), timestamp };
  goal.history = [...goal.history, entry].slice(-MAX_HISTORY_ENTRIES);
  return entry;
}

export function recordCheckpoint(
  goal: GoalState,
  text: string,
  timestamp = Date.now(),
): void {
  const summary = summarizeText(text);
  if (!summary) return;
  if (goal.lastCheckpoint?.summary === summary) return;
  const checkpoint = { summary, timestamp };
  goal.lastCheckpoint = checkpoint;
  goal.checkpoints = [...goal.checkpoints, checkpoint].slice(-MAX_CHECKPOINTS);
}

export function summarizeText(text: string, limit = 280): string {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > limit
    ? `${normalized.slice(0, limit - 1)}…`
    : normalized;
}

export function cleanupGoal(sessionID: string): void {
  const goal = goalStates.get(sessionID);
  if (goal) {
    removeSessionGoal(sessionID, goal.goalId);
    goal.messageIDs.clear();
  }
  goalStates.delete(sessionID);
  activeContinues.delete(sessionID);
}

export function promoteNextOrderedGoal(sessionID: string): GoalState | null {
  const goals = listSessionGoals(sessionID);
  const current = goalStates.get(sessionID) ?? null;
  const currentIndex = current ? goals.indexOf(current) : -1;
  const next = currentIndex >= 0 ? goals[currentIndex + 1] ?? null : null;
  if (!next) {
    sessionOrdered.delete(sessionID);
    return null;
  }
  next.stopped = false;
  next.stopReason = "";
  next.blockedReason = "";
  resumeGoalClock(next);
  next.skipNextTerminalCheck = true;
  next.lastStatus = "Promoted as the next ordered goal.";
  pushHistoryEntry(next, "focused", "Auto-promoted as the next goal in the ordered sequence.");
  focusGoal(sessionID, next);
  return next;
}

export function rememberGoalResult(
  sessionID: string,
  goal: GoalState,
  state: string,
  reason = "",
  evidence = "",
): GoalResult {
  const result: GoalResult = {
    condition: goal.condition,
    state,
    reason,
    evidence,
    blockedReason: goal.blockedReason,
    turnCount: goal.turnCount,
    totalTokens: goal.totalTokens,
    usage: { ...goal.usage },
    startedAt: goal.startedAt,
    finishedAt: Date.now(),
    lastStatus: goal.lastStatus,
    lastCheckpoint: goal.lastCheckpoint ? { ...goal.lastCheckpoint } : null,
  };
  lastGoalResults.set(sessionID, result);
  const archive = sessionArchive.get(sessionID) ?? [];
  archive.push(result);
  sessionArchive.set(sessionID, archive.slice(-MAX_ARCHIVED_PER_SESSION));
  return result;
}

export function clearRuntimeState(): void {
  for (const controller of continuationControllers.values()) controller.abort();
  goalStates.clear();
  sessionGoals.clear();
  sessionArchive.clear();
  sessionOrdered.clear();
  lastGoalResults.clear();
  activeContinues.clear();
  continuationControllers.clear();
  promptInFlightSessions.clear();
  seenIdleEventIDs.clear();
  sessionStatuses.clear();
  sessionExecutionContexts.clear();
}
