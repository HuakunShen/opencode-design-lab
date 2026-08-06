import * as fs from "fs";
import * as path from "path";
import type { GoalState, HistoryEntry } from "./state";

export const DEFAULT_LEDGER_MAX_BYTES = 2 * 1024 * 1024;
export const DEFAULT_LEDGER_RETENTION_FILES = 3;
export const MAX_LEDGER_LINE_BYTES = 16 * 1024;

export type LedgerEntry = {
  ts?: number;
  sessionID: string;
  goalId?: string;
  condition?: string;
  snapshot?: Record<string, unknown>;
  type: string;
  detail?: string;
};

function rotateLedger(
  ledgerFilePath: string,
  retentionFiles: number,
): void {
  if (retentionFiles <= 0) {
    fs.rmSync(ledgerFilePath, { force: true });
    return;
  }
  fs.rmSync(`${ledgerFilePath}.${retentionFiles}`, { force: true });
  for (let index = retentionFiles - 1; index >= 1; index -= 1) {
    try {
      fs.renameSync(`${ledgerFilePath}.${index}`, `${ledgerFilePath}.${index + 1}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    }
  }
  try {
    fs.renameSync(ledgerFilePath, `${ledgerFilePath}.1`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
  }
}

export function appendLedgerLine(
  ledgerFilePath: string,
  entry: LedgerEntry,
  options: {
    maxBytes?: number;
    retentionFiles?: number;
  } = {},
): boolean {
  const maxBytes = options.maxBytes ?? DEFAULT_LEDGER_MAX_BYTES;
  const retentionFiles = options.retentionFiles ?? DEFAULT_LEDGER_RETENTION_FILES;
  try {
    fs.mkdirSync(path.dirname(ledgerFilePath), { recursive: true, mode: 0o700 });
    const line = `${JSON.stringify(entry)}\n`;
    if (Buffer.byteLength(line) > MAX_LEDGER_LINE_BYTES) return false;
    let currentBytes = 0;
    try {
      const info = fs.lstatSync(ledgerFilePath);
      if (info.isSymbolicLink() || !info.isFile()) return false;
      currentBytes = info.size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    }
    if (currentBytes + Buffer.byteLength(line) > maxBytes) {
      rotateLedger(ledgerFilePath, retentionFiles);
    }
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    const handle = fs.openSync(
      ledgerFilePath,
      fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | noFollow,
      0o600,
    );
    try {
      fs.writeSync(handle, line);
      fs.fchmodSync(handle, 0o600);
    } finally {
      fs.closeSync(handle);
    }
    return true;
  } catch {
    return false;
  }
}

export function readLedgerEntries(
  ledgerFilePath: string,
  options: {
    maxBytes?: number;
    retentionFiles?: number;
  } = {},
): LedgerEntry[] {
  const maxBytes = options.maxBytes ?? DEFAULT_LEDGER_MAX_BYTES;
  const retentionFiles = options.retentionFiles ?? DEFAULT_LEDGER_RETENTION_FILES;
  const entries: LedgerEntry[] = [];
  const paths = [
    ...Array.from(
      { length: retentionFiles },
      (_, index) => `${ledgerFilePath}.${retentionFiles - index}`,
    ),
    ledgerFilePath,
  ];
  for (const filePath of paths) {
    let raw = "";
    try {
      const handle = fs.openSync(filePath, "r");
      try {
        const { size } = fs.fstatSync(handle);
        const length = Math.min(size, maxBytes);
        const buffer = Buffer.alloc(length);
        fs.readSync(handle, buffer, 0, length, size - length);
        raw = buffer.toString("utf8");
        if (size > length) raw = raw.slice(raw.indexOf("\n") + 1);
      } finally {
        fs.closeSync(handle);
      }
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      if (Buffer.byteLength(line) > MAX_LEDGER_LINE_BYTES) continue;
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as LedgerEntry;
        if (parsed && typeof parsed === "object" && typeof parsed.sessionID === "string") {
          entries.push(parsed);
        }
      } catch {
        // Skip malformed lines so a partial write can't break recovery.
      }
    }
  }
  return entries;
}

const LEDGER_TERMINAL_TYPES = new Set(["completed", "cleared"]);

function normalizeTimestamp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export type RecoveredGoal = Omit<
  GoalState,
  | "goalId"
  | "runId"
  | "usage"
  | "options"
  | "messageIDs"
  | "checkpoints"
  | "lastCheckpoint"
  | "executionContext"
  | "continuationClaim"
  | "skipNextTerminalCheck"
  | "lastAssistantText"
  | "lastAssistantMessageID"
  | "lastProgressAt"
  | "lastContinueAt"
  | "noProgressTurns"
  | "noToolCallTurns"
  | "budgetWrapupSent"
  | "promptFailures"
  | "formatFailures"
  | "pausedAt"
  | "startedAt"
  | "lastStatus"
  | "turnCount"
  | "totalTokens"
> & {
  goalId: string;
  runId: string;
  history: HistoryEntry[];
};

export function reconstructGoalsFromLedger(entries: LedgerEntry[]): RecoveredGoal[] {
  const ordered = [...entries]
    .filter(
      (entry) =>
        entry && typeof entry.sessionID === "string" && entry.sessionID.length > 0,
    )
    .sort((a, b) => normalizeTimestamp(a.ts, 0) - normalizeTimestamp(b.ts, 0));

  const eventsByGoal = new Map<string, LedgerEntry[]>();
  for (const entry of ordered) {
    const goalId =
      typeof entry.goalId === "string" && entry.goalId
        ? entry.goalId
        : `${entry.sessionID}:unknown`;
    const key = `${entry.sessionID}\0${goalId}`;
    const list = eventsByGoal.get(key) ?? [];
    list.push(entry);
    eventsByGoal.set(key, list);
  }

  const reconstructed: RecoveredGoal[] = [];
  for (const [key, events] of eventsByGoal.entries()) {
    const separator = key.indexOf("\0");
    const sessionID = key.slice(0, separator);
    const goalId = key.slice(separator + 1);
    const terminal = events.some((event) => LEDGER_TERMINAL_TYPES.has(event.type));
    if (terminal) continue;
    const condition = [...events]
      .reverse()
      .find((event) => typeof event.condition === "string" && event.condition.trim())
      ?.condition?.trim();
    if (!condition) continue;
    const snapshot = [...events]
      .reverse()
      .find((event) => event.snapshot && typeof event.snapshot === "object")
      ?.snapshot ?? {};
    const latestBlocked = [...events].reverse().find((event) => event.type === "blocked");

    const history: HistoryEntry[] = events
      .map((event) => ({
        type:
          typeof event.type === "string" && event.type.trim()
            ? event.type.trim()
            : "event",
        detail: typeof event.detail === "string" ? event.detail : "",
        timestamp: normalizeTimestamp(event.ts, Date.now()),
      }))
      .slice(-20);

    reconstructed.push({
      sessionID,
      goalId,
      runId: goalId,
      condition,
      successCriteria: typeof snapshot.successCriteria === "string" ? snapshot.successCriteria : "",
      constraints: typeof snapshot.constraints === "string" ? snapshot.constraints : "",
      mode: snapshot.mode === "ordered" ? "ordered" : "normal",
      stopped: true,
      stopReason: "recovered after restart",
      blockedReason:
        typeof snapshot.blockedReason === "string"
          ? snapshot.blockedReason
          : snapshot.stopReason === "blocked" && typeof latestBlocked?.detail === "string"
            ? latestBlocked.detail
            : "",
      history,
    });
  }
  return reconstructed;
}
