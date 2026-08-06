import { emptyUsage } from "./state";
import type { GoalState, Usage } from "./state";

const TOOL_PART_TYPES = new Set([
  "tool",
  "tool-invocation",
  "subtask",
  "tool_use",
  "function_call",
  "tool-call",
]);

const USAGE_TOKEN_FIELDS = ["input", "output", "reasoning", "cacheRead", "cacheWrite"] as const;

export function toNonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

export function messageHasToolCall(message: unknown): boolean {
  const parts = Array.isArray((message as { parts?: unknown })?.parts)
    ? ((message as { parts: unknown[] }).parts as unknown[])
    : [];
  return parts.some(
    (part) =>
      part &&
      typeof part === "object" &&
      TOOL_PART_TYPES.has((part as { type?: string }).type ?? ""),
  );
}

export function stopReason(goal: GoalState): string | null {
  if (goal.turnCount >= goal.options.max_auto_turns) {
    return `max turns reached (${goal.options.max_auto_turns})`;
  }
  if (Date.now() - goal.startedAt >= goal.options.max_duration_ms) {
    return `max duration reached (${Math.round(goal.options.max_duration_ms / 1000)}s)`;
  }
  if (goal.totalTokens >= goal.options.max_tokens) {
    return `max context tokens reached (${goal.options.max_tokens.toLocaleString()})`;
  }
  return null;
}

export function budgetWrapupNeeded(goal: GoalState): boolean {
  return (
    !goal.budgetWrapupSent &&
    goal.totalTokens >=
      Math.floor(goal.options.max_tokens * goal.options.budget_wrapup_ratio)
  );
}

export function buildLimitWarning(goal: GoalState): string {
  const remainingTurns = goal.options.max_auto_turns - goal.turnCount;
  const remainingMs = goal.options.max_duration_ms - (Date.now() - goal.startedAt);
  const remainingTokens = goal.options.max_tokens - goal.totalTokens;
  const warnings: string[] = [];
  if (remainingTurns <= 3) {
    warnings.push(`${Math.max(0, remainingTurns)} auto-continue turn(s) remaining`);
  }
  if (remainingMs <= 60 * 1000) {
    warnings.push(`${Math.max(0, Math.round(remainingMs / 1000))}s remaining`);
  }
  if (remainingTokens <= 25000) {
    warnings.push(`${Math.max(0, remainingTokens).toLocaleString()} context token(s) remaining`);
  }
  return warnings.length ? ` Limits are near: ${warnings.join(", ")}.` : "";
}

export function messageTokens(message: unknown): Record<string, unknown> {
  const info = (message as { info?: Record<string, unknown> })?.info;
  const tokens = info?.tokens ?? (message as { tokens?: unknown })?.tokens;
  return tokens && typeof tokens === "object" ? (tokens as Record<string, unknown>) : {};
}

export function normalizeMessageUsage(message: unknown): Usage {
  const tokens = messageTokens(message);
  const cache = tokens.cache && typeof tokens.cache === "object"
    ? (tokens.cache as Record<string, unknown>)
    : {};
  const info = (message as { info?: Record<string, unknown> })?.info;
  const rawCost = info?.cost ?? (message as { cost?: unknown })?.cost;
  const cost = Number.isFinite(Number(rawCost)) && Number(rawCost) >= 0 ? Number(rawCost) : 0;
  return {
    input: toNonNegativeInteger(tokens.input),
    output: toNonNegativeInteger(tokens.output),
    reasoning: toNonNegativeInteger(tokens.reasoning),
    cacheRead: toNonNegativeInteger(cache.read ?? tokens.cacheRead ?? tokens.cache_read),
    cacheWrite: toNonNegativeInteger(cache.write ?? tokens.cacheWrite ?? tokens.cache_write),
    cost,
    costKnown: rawCost !== undefined && Number.isFinite(Number(rawCost)) && Number(rawCost) >= 0,
  };
}

export function normalizeUsage(value: Partial<Usage> | null | undefined): Usage {
  const source = value && typeof value === "object" ? value : {};
  const usage = emptyUsage();
  for (const field of USAGE_TOKEN_FIELDS) usage[field] = toNonNegativeInteger(source[field]);
  usage.cost =
    Number.isFinite(Number(source.cost)) && Number(source.cost) >= 0
      ? Number(source.cost)
      : 0;
  usage.costKnown = source.costKnown === true || usage.cost > 0;
  return usage;
}

export function cacheTokensForMessage(tokens: Record<string, unknown>): number {
  const cache = tokens.cache && typeof tokens.cache === "object"
    ? (tokens.cache as Record<string, unknown>)
    : {};
  // Support both nested (cache: { read, write }) and flat
  // (cacheRead / cache_write) provider shapes.
  return (
    toNonNegativeInteger(cache.read ?? tokens.cacheRead ?? tokens.cache_read) +
    toNonNegativeInteger(cache.write ?? tokens.cacheWrite ?? tokens.cache_write)
  );
}

export function totalTokensForMessage(message: unknown): number {
  const tokens = messageTokens(message);
  const reportedTotal = toNonNegativeInteger(tokens.total);
  if (reportedTotal > 0) return reportedTotal;
  return (
    toNonNegativeInteger(tokens.input) +
    toNonNegativeInteger(tokens.output) +
    toNonNegativeInteger(tokens.reasoning) +
    cacheTokensForMessage(tokens)
  );
}

export function outputTokensForMessage(message: unknown): number {
  return toNonNegativeInteger(messageTokens(message).output);
}
