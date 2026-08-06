import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import type { GoalOptions } from "./config";
import {
  buildGoalState,
  goalStates,
  pushHistoryEntry,
  sessionGoals,
} from "./state";
import type { GoalState } from "./state";
import { readLedgerEntries, reconstructGoalsFromLedger, appendLedgerLine } from "./ledger";

const MAX_STATE_FILE_BYTES = 16 * 1024 * 1024;
const MAX_PERSISTED_ENTRIES = 2000;

export type PersistencePaths = {
  stateFilePath: string;
  ledgerFilePath: string;
  shardDir: string;
};

/**
 * Append a lifecycle event to the session's ledger. Returns true when durable.
 * Callers write the ledger line (before the state file for terminal events) so
 * crash recovery can reconstruct active goals even if the state write fails.
 */
export function writeGoalLedger(
  options: GoalOptions,
  sessionID: string,
  goal: GoalState | null,
  type: string,
  detail: string,
): boolean {
  if (!options.persist_state || !sessionID) return false;
  const paths = sessionPathsFor(options, sessionID);
  return appendLedgerLine(paths.ledgerFilePath, {
    ts: Date.now(),
    sessionID,
    goalId: goal?.goalId,
    condition: goal?.condition,
    snapshot: goal
      ? {
          successCriteria: goal.successCriteria,
          constraints: goal.constraints,
          mode: goal.mode,
          stopped: goal.stopped,
          stopReason: goal.stopReason,
          blockedReason: goal.blockedReason,
        }
      : {},
    type,
    detail,
  });
}

export function sessionPathsFor(
  options: GoalOptions,
  sessionID: string,
): PersistencePaths {
  const stateRoot = path.resolve(options.state_dir, "state.json");
  const hash = createHash("sha256").update(sessionID).digest("hex");
  const shardDir = path.join(`${stateRoot}.sessions`, hash);
  return {
    stateFilePath: path.join(shardDir, "state.json"),
    ledgerFilePath: path.join(shardDir, "state.json.ledger.jsonl"),
    shardDir,
  };
}

function serializeGoal(goal: GoalState) {
  return {
    goalId: goal.goalId,
    runId: goal.runId,
    condition: goal.condition,
    successCriteria: goal.successCriteria,
    constraints: goal.constraints,
    mode: goal.mode,
    sessionID: goal.sessionID,
    turnCount: goal.turnCount,
    startedAt: goal.startedAt,
    pausedAt: goal.pausedAt,
    totalTokens: goal.totalTokens,
    usage: goal.usage,
    options: goal.options,
    lastStatus: goal.lastStatus,
    lastAssistantText: goal.lastAssistantText,
    lastAssistantMessageID: goal.lastAssistantMessageID,
    lastContinueAt: goal.lastContinueAt,
    lastProgressAt: goal.lastProgressAt,
    noProgressTurns: goal.noProgressTurns,
    noToolCallTurns: goal.noToolCallTurns,
    blockedReason: goal.blockedReason,
    budgetWrapupSent: goal.budgetWrapupSent,
    stopped: goal.stopped,
    stopReason: goal.stopReason,
    promptFailures: goal.promptFailures,
    formatFailures: goal.formatFailures,
    executionContext: goal.executionContext,
    continuationClaim: goal.continuationClaim,
    messageIDs: [...goal.messageIDs],
    history: goal.history,
    checkpoints: goal.checkpoints,
    lastCheckpoint: goal.lastCheckpoint,
    skipNextTerminalCheck: goal.skipNextTerminalCheck,
  };
}

export async function persistState(
  options: GoalOptions,
  sessionID: string,
): Promise<boolean> {
  if (!options.persist_state || !sessionID) return false;
  try {
    const paths = sessionPathsFor(options, sessionID);
    fs.mkdirSync(paths.shardDir, { recursive: true, mode: 0o700 });
    const goal = goalStates.get(sessionID);
    const payload = {
      version: 1,
      focused: goal ? serializeGoal(goal) : null,
      goals: [...(sessionGoals.get(sessionID)?.values() ?? [])].map(
        serializeGoal,
      ),
      ordered: false,
      savedAt: Date.now(),
    };
    const json = JSON.stringify(payload, null, 2);
    if (Buffer.byteLength(json) > MAX_STATE_FILE_BYTES) return false;
    const tmp = `${paths.stateFilePath}.tmp`;
    // O_NOFOLLOW + O_EXCL guards against a pre-seeded symlink tmp file
    // (mirrors the ledger's symlink defense); 0o600 owner-only perms.
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    const handle = fs.openSync(
      tmp,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow,
      0o600,
    );
    try {
      fs.writeSync(handle, json);
      fs.fchmodSync(handle, 0o600);
    } finally {
      fs.closeSync(handle);
    }
    try {
      fs.renameSync(tmp, paths.stateFilePath);
    } catch (error) {
      fs.rmSync(tmp, { force: true });
      throw error;
    }
    fs.chmodSync(paths.stateFilePath, 0o600);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[goals] Failed to persist session state: ${message}`);
    return false;
  }
}

function hydrateGoal(raw: Record<string, unknown>): GoalState | null {
  if (!raw || typeof raw !== "object") return null;
  const condition = typeof raw.condition === "string" ? raw.condition : "";
  const sessionID = typeof raw.sessionID === "string" ? raw.sessionID : "";
  const options = raw.options as GoalOptions;
  if (!condition || !sessionID || !options || typeof options !== "object")
    return null;
  const goal = buildGoalState(sessionID, condition, options, {
    successCriteria:
      typeof raw.successCriteria === "string" ? raw.successCriteria : "",
    constraints: typeof raw.constraints === "string" ? raw.constraints : "",
    mode: raw.mode === "ordered" ? "ordered" : "normal",
  });
  goal.goalId = typeof raw.goalId === "string" ? raw.goalId : goal.goalId;
  goal.runId = typeof raw.runId === "string" ? raw.runId : goal.runId;
  goal.turnCount = typeof raw.turnCount === "number" ? raw.turnCount : 0;
  goal.startedAt =
    typeof raw.startedAt === "number" ? raw.startedAt : Date.now();
  goal.pausedAt = typeof raw.pausedAt === "number" ? raw.pausedAt : 0;
  goal.totalTokens = typeof raw.totalTokens === "number" ? raw.totalTokens : 0;
  goal.lastStatus =
    typeof raw.lastStatus === "string" ? raw.lastStatus : "Recovered.";
  goal.blockedReason =
    typeof raw.blockedReason === "string" ? raw.blockedReason : "";
  goal.budgetWrapupSent = raw.budgetWrapupSent === true;
  goal.promptFailures =
    typeof raw.promptFailures === "number" ? raw.promptFailures : 0;
  goal.formatFailures =
    typeof raw.formatFailures === "number" ? raw.formatFailures : 0;
  goal.noProgressTurns =
    typeof raw.noProgressTurns === "number" ? raw.noProgressTurns : 0;
  goal.noToolCallTurns =
    typeof raw.noToolCallTurns === "number" ? raw.noToolCallTurns : 0;
  goal.lastContinueAt =
    typeof raw.lastContinueAt === "number" ? raw.lastContinueAt : 0;
  goal.lastProgressAt =
    typeof raw.lastProgressAt === "number" ? raw.lastProgressAt : 0;
  goal.lastAssistantText =
    typeof raw.lastAssistantText === "string" ? raw.lastAssistantText : "";
  goal.lastAssistantMessageID =
    typeof raw.lastAssistantMessageID === "string"
      ? raw.lastAssistantMessageID
      : "";
  goal.skipNextTerminalCheck = raw.skipNextTerminalCheck === true;
  goal.history = Array.isArray(raw.history) ? raw.history.slice(0, 20) : [];
  goal.checkpoints = Array.isArray(raw.checkpoints)
    ? raw.checkpoints.slice(0, 5)
    : [];
  goal.lastCheckpoint =
    raw.lastCheckpoint && typeof raw.lastCheckpoint === "object"
      ? (raw.lastCheckpoint as GoalState["lastCheckpoint"])
      : null;
  // Round-trip restore terminal state so completed/paused goals do not
  // resurrect as active after a restart.
  goal.stopped = raw.stopped === true;
  goal.stopReason = typeof raw.stopReason === "string" ? raw.stopReason : "";
  // Round-trip restore usage so token/cost accounting survives a restart.
  if (raw.usage && typeof raw.usage === "object") {
    const u = raw.usage as Partial<GoalState["usage"]>;
    goal.usage = {
      input: typeof u.input === "number" ? u.input : 0,
      output: typeof u.output === "number" ? u.output : 0,
      reasoning: typeof u.reasoning === "number" ? u.reasoning : 0,
      cacheRead: typeof u.cacheRead === "number" ? u.cacheRead : 0,
      cacheWrite: typeof u.cacheWrite === "number" ? u.cacheWrite : 0,
      cost: typeof u.cost === "number" ? u.cost : 0,
      costKnown: u.costKnown === true || (typeof u.cost === "number" && u.cost > 0),
    };
  }
  if (Array.isArray(raw.messageIDs)) {
    goal.messageIDs = new Set(raw.messageIDs.slice(0, MAX_PERSISTED_ENTRIES));
  }
  if (raw.continuationClaim && typeof raw.continuationClaim === "object") {
    goal.continuationClaim =
      raw.continuationClaim as GoalState["continuationClaim"];
  }
  if (raw.executionContext && typeof raw.executionContext === "object") {
    goal.executionContext = raw.executionContext as Record<string, unknown>;
  }
  return goal;
}

export type LoadStatus = "missing" | "loaded" | "reconstructed" | "recovered";

export async function loadPersistedSessionState(
  options: GoalOptions,
  sessionID: string,
): Promise<LoadStatus> {
  if (!options.persist_state || !sessionID) return "missing";
  const paths = sessionPathsFor(options, sessionID);
  let raw: string | null = null;
  try {
    raw = fs.readFileSync(paths.stateFilePath, "utf8");
    if (Buffer.byteLength(raw) > MAX_STATE_FILE_BYTES) raw = null;
  } catch {
    raw = null;
  }

  if (raw) {
    try {
      const payload = JSON.parse(raw) as {
        focused?: Record<string, unknown> | null;
        goals?: Record<string, unknown>[];
      };
      const goals = Array.isArray(payload.goals)
        ? payload.goals
            .map(hydrateGoal)
            .filter((g): g is GoalState => g !== null)
        : [];
      const focused = payload.focused
        ? hydrateGoal(payload.focused)
        : (goals[0] ?? null);
      if (goals.length > 0) {
        sessionGoals.set(sessionID, new Map(goals.map((g) => [g.goalId, g])));
        if (focused) {
          const live = sessionGoals.get(sessionID)?.get(focused.goalId);
          if (live && !live.stopped) {
            live.stopped = true;
            live.stopReason = "recovered after restart";
            live.lastStatus =
              "Recovered after restart; run /goal resume to continue.";
            pushHistoryEntry(
              live,
              "recovered",
              "Recovered after a plugin restart; paused until resumed.",
            );
          }
          if (live) goalStates.set(sessionID, live);
        }
        return "loaded";
      }
    } catch {
      // Corrupt state file: fall through to ledger reconstruction.
    }
  }

  // Ledger reconstruction.
  const entries = readLedgerEntries(paths.ledgerFilePath);
  if (entries.length === 0) return "missing";
  const recovered = reconstructGoalsFromLedger(entries);
  const matching = recovered.filter((goal) => goal.sessionID === sessionID);
  if (matching.length === 0) return "missing";
  const first = matching[0];
  const goal = buildGoalState(sessionID, first.condition, options, {
    successCriteria: first.successCriteria,
    constraints: first.constraints,
    mode: first.mode,
  });
  goal.goalId = first.goalId;
  goal.runId = first.runId;
  goal.stopped = true;
  goal.stopReason = first.stopReason || "recovered after restart";
  goal.blockedReason = first.blockedReason;
  goal.history = first.history;
  goal.lastStatus =
    "Recovered from the lifecycle ledger after a state file failure.";
  goalStates.set(sessionID, goal);
  sessionGoals.set(sessionID, new Map([[goal.goalId, goal]]));
  return "reconstructed";
}
