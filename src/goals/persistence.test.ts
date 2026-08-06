import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createHash } from "crypto";
import type { GoalOptions } from "./config";
import { buildGoalState, goalStates, sessionGoals } from "./state";
import {
  loadPersistedSessionState,
  persistState,
  sessionPathsFor,
  writeGoalLedger,
} from "./persistence";
import { appendLedgerLine } from "./ledger";

const SESSION = "session-abc";
const OPTIONS: GoalOptions = {
  auto_continue: true,
  max_auto_turns: 10,
  max_duration_ms: 900000,
  max_tokens: 200000,
  min_delay_ms: 1500,
  no_progress_token_threshold: 50,
  no_progress_turns_before_pause: 2,
  no_tool_call_turns_before_pause: 2,
  budget_wrapup_ratio: 0.8,
  max_prompt_failures: 3,
  persist_state: true,
  state_dir: ".opencode/goals",
  restricted_agents: ["plan"],
  allow_goal_execution_from_plan: false,
};

function tmpPersistence() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "goal-persist-"));
  return { ...OPTIONS, state_dir: root };
}

describe("session persistence", () => {
  it("resolves per-session shard paths hashed by session id", () => {
    const opts = tmpPersistence();
    const paths = sessionPathsFor(opts, SESSION);
    const hash = createHash("sha256").update(SESSION).digest("hex");
    expect(paths.shardDir).toContain(hash);
    expect(paths.stateFilePath.endsWith("state.json")).toBe(true);
    expect(paths.ledgerFilePath.endsWith("state.json.ledger.jsonl")).toBe(true);
  });

  it("persists the focused goal and reloads it paused on restart", async () => {
    const opts = tmpPersistence();
    const goal = buildGoalState(SESSION, "fix tests", opts);
    goalStates.set(SESSION, goal);
    sessionGoals.set(SESSION, new Map([[goal.goalId, goal]]));
    const ok = await persistState(opts, SESSION);
    expect(ok).toBe(true);

    goalStates.delete(SESSION);
    sessionGoals.delete(SESSION);
    const status = await loadPersistedSessionState(opts, SESSION);
    expect(status).toBe("loaded");
    const recovered = goalStates.get(SESSION);
    expect(recovered?.condition).toBe("fix tests");
    expect(recovered?.stopped).toBe(true);
    expect(recovered?.stopReason).toBe("recovered after restart");
  });

  it("reconstructs from the ledger when the state file is missing", async () => {
    const opts = tmpPersistence();
    const goal = buildGoalState(SESSION, "write docs", opts);
    goalStates.set(SESSION, goal);
    sessionGoals.set(SESSION, new Map([[goal.goalId, goal]]));
    await persistState(opts, SESSION);
    // Seed the ledger (normal operation writes both state and ledger).
    const paths = sessionPathsFor(opts, SESSION);
    appendLedgerLine(paths.ledgerFilePath, {
      ts: Date.now(),
      sessionID: SESSION,
      goalId: goal.goalId,
      condition: "write docs",
      type: "set",
      snapshot: { stopped: false },
    });
    // Corrupt: delete the state file, keep the ledger.
    fs.rmSync(paths.stateFilePath, { force: true });
    goalStates.delete(SESSION);
    sessionGoals.delete(SESSION);
    const status = await loadPersistedSessionState(opts, SESSION);
    expect(status).toBe("reconstructed");
    expect(goalStates.get(SESSION)?.condition).toBe("write docs");
    expect(goalStates.get(SESSION)?.stopped).toBe(true);
  });

  it("returns missing when neither file nor ledger exist", async () => {
    const opts = tmpPersistence();
    const status = await loadPersistedSessionState(opts, SESSION);
    expect(status).toBe("missing");
  });

  it("round-trips usage and stopped state for non-focused goals", async () => {
    const opts = tmpPersistence();
    const goal = buildGoalState(SESSION, "fix tests", opts);
    goal.usage = {
      input: 100,
      output: 50,
      reasoning: 10,
      cacheRead: 200,
      cacheWrite: 40,
      cost: 0.5,
      costKnown: true,
    };
    goal.stopped = true;
    goal.stopReason = "blocked";
    goal.blockedReason = "need an API token";
    goalStates.set(SESSION, goal);
    sessionGoals.set(SESSION, new Map([[goal.goalId, goal]]));
    await persistState(opts, SESSION);

    goalStates.delete(SESSION);
    sessionGoals.delete(SESSION);
    const status = await loadPersistedSessionState(opts, SESSION);
    expect(status).toBe("loaded");
    const recovered = goalStates.get(SESSION);
    expect(recovered?.usage).toEqual({
      input: 100,
      output: 50,
      reasoning: 10,
      cacheRead: 200,
      cacheWrite: 40,
      cost: 0.5,
      costKnown: true,
    });
    // A goal that was already stopped stays in its stopped/blocked state
    // rather than being force-marked "recovered after restart".
    expect(recovered?.stopped).toBe(true);
    expect(recovered?.stopReason).toBe("blocked");
  });

  it("writeGoalLedger appends a recoverable lifecycle line", async () => {
    const opts = tmpPersistence();
    const goal = buildGoalState(SESSION, "fix tests", opts);
    const ok = writeGoalLedger(opts, SESSION, goal, "set", "created");
    expect(ok).toBe(true);
    const paths = sessionPathsFor(opts, SESSION);
    const lines = fs
      .readFileSync(paths.ledgerFilePath, "utf8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.type).toBe("set");
    expect(entry.sessionID).toBe(SESSION);
    expect(entry.goalId).toBe(goal.goalId);
    // The entry is reconstructable: a goal with no state file can be rebuilt.
    const { reconstructGoalsFromLedger } = await import("./ledger");
    const recovered = reconstructGoalsFromLedger([entry]);
    expect(recovered[0]?.condition).toBe("fix tests");
  });
});
