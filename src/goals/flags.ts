import type { GoalOptions } from "./config";
import type { GoalMeta } from "./state";
import { MAX_GOAL_META_LENGTH, MAX_GOAL_OBJECTIVE_LENGTH } from "./state";

const GOAL_MODES = new Set(["normal", "ordered"]);
const GOAL_META_DEFAULTS: GoalMeta = {
  successCriteria: "",
  constraints: "",
  mode: "normal",
};
const MAX_COMMAND_ARGUMENT_LENGTH = 32 * 1024;

const NUMERIC_OPTION_KEYS = [
  "max_auto_turns",
  "max_duration_ms",
  "max_tokens",
  "min_delay_ms",
  "no_progress_token_threshold",
  "no_progress_turns_before_pause",
  "no_tool_call_turns_before_pause",
] as const;
type NumericOptionKey = (typeof NUMERIC_OPTION_KEYS)[number];

const STRING_META_KEYS = ["successCriteria", "constraints"] as const;
type StringMetaKey = (typeof STRING_META_KEYS)[number];

type FlagSpec =
  | { type?: undefined; optionKey: NumericOptionKey }
  | { type: "tokens"; optionKey: "max_tokens" }
  | { type: "string"; metaKey: StringMetaKey }
  | { type: "mode"; metaKey: "mode" };

const GOAL_FLAG_SPECS: Record<string, FlagSpec> = {
  "--max-turns": { optionKey: "max_auto_turns" },
  "--max-duration-ms": { optionKey: "max_duration_ms" },
  "--max-minutes": { optionKey: "max_duration_ms" },
  "--max-tokens": { optionKey: "max_tokens" },
  "--cooldown-ms": { optionKey: "min_delay_ms" },
  "--no-progress-threshold": { optionKey: "no_progress_token_threshold" },
  "--no-progress-turns": { optionKey: "no_progress_turns_before_pause" },
  "--budget": { type: "tokens", optionKey: "max_tokens" },
  "--success": { type: "string", metaKey: "successCriteria" },
  "--success-criteria": { type: "string", metaKey: "successCriteria" },
  "--constraints": { type: "string", metaKey: "constraints" },
  "--non-goals": { type: "string", metaKey: "constraints" },
  "--mode": { type: "mode", metaKey: "mode" },
  "--no-tool-turns": { optionKey: "no_tool_call_turns_before_pause" },
};

export function parsePositiveIntegerStrict(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseTokenBudget(value: string): number | null {
  const trimmed = value.trim().toLowerCase();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)([km])?$/);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base) || base <= 0) return null;
  const multiplier = match[2] === "k" ? 1000 : match[2] === "m" ? 1000000 : 1;
  const total = Math.floor(base * multiplier);
  return total > 0 ? total : null;
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export type ParsedGoalArguments = {
  condition: string;
  options: GoalOptions;
  meta: GoalMeta;
  errors: string[];
};

export function parseGoalArguments(
  args: string,
  defaults: GoalOptions,
): ParsedGoalArguments {
  const parts = args.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const condition: string[] = [];
  // Copy restricted_agents as a fresh mutable array so the mutable
  // GoalOptions type is satisfied when defaults is Readonly<GoalOptions>.
  const options: GoalOptions = {
    ...defaults,
    restricted_agents: [...defaults.restricted_agents],
  };
  const meta: GoalMeta = { ...GOAL_META_DEFAULTS };
  const errors: string[] = [];

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part.startsWith("--")) {
      condition.push(stripWrappingQuotes(part));
      continue;
    }
    const [flagName, inlineValue] = part.split(/=(.*)/s, 2);
    const flagSpec = GOAL_FLAG_SPECS[flagName];
    if (!flagSpec) {
      const next = parts[i + 1];
      if (
        inlineValue === undefined &&
        next !== undefined &&
        !next.startsWith("--")
      )
        i += 1;
      errors.push(`Unsupported flag: ${flagName}`);
      continue;
    }
    const next = parts[i + 1];
    const value =
      inlineValue ??
      (next !== undefined && !next.startsWith("--") ? next : undefined);
    if (inlineValue === undefined && value !== undefined) i += 1;
    if (value === undefined) {
      errors.push(`Missing value for ${flagName}`);
      continue;
    }
    const rawValue = stripWrappingQuotes(value);

    if (flagSpec.type === "tokens") {
      const budget = parseTokenBudget(rawValue);
      if (budget === null) {
        errors.push(
          `Invalid token budget for ${flagName}: ${value} (use a positive number, optionally with a k or m suffix)`,
        );
        continue;
      }
      if (flagSpec.optionKey) options[flagSpec.optionKey] = budget;
      continue;
    }
    if (flagSpec.type === "string") {
      const text = rawValue.trim();
      if (!text) {
        errors.push(`Missing value for ${flagName}`);
        continue;
      }
      if (flagSpec.metaKey) meta[flagSpec.metaKey] = text;
      continue;
    }
    if (flagSpec.type === "mode") {
      const mode = normalizeMode(rawValue);
      if (!mode) {
        errors.push(
          `Invalid mode for ${flagName}: ${value} (expected normal or ordered)`,
        );
        continue;
      }
      if (flagSpec.metaKey) meta[flagSpec.metaKey] = mode;
      continue;
    }
    const parsedValue = parsePositiveIntegerStrict(rawValue);
    if (parsedValue === null) {
      errors.push(`Invalid positive integer for ${flagName}: ${value}`);
      continue;
    }
    if (!flagSpec.optionKey) continue;
    if (
      flagSpec.optionKey === "max_duration_ms" &&
      flagName === "--max-minutes"
    ) {
      options[flagSpec.optionKey] = parsedValue * 60000;
    } else {
      options[flagSpec.optionKey] = parsedValue;
    }
  }

  const parsedCondition = condition.join(" ").trim();
  if (parsedCondition.length > MAX_GOAL_OBJECTIVE_LENGTH) {
    errors.push(
      `Goal objective must be ${MAX_GOAL_OBJECTIVE_LENGTH} characters or fewer`,
    );
  }
  for (const [field, value] of [
    ["success criteria", meta.successCriteria],
    ["constraints", meta.constraints],
  ] as const) {
    if (value.length > MAX_GOAL_META_LENGTH) {
      errors.push(
        `${field} must be ${MAX_GOAL_META_LENGTH} characters or fewer`,
      );
    }
  }
  return { condition: parsedCondition, options, meta, errors };
}

export function normalizeMode(value: unknown): GoalMeta["mode"] | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  if (normalized === "sisyphus") return "ordered";
  return GOAL_MODES.has(normalized) ? (normalized as GoalMeta["mode"]) : null;
}

export function formatArgumentErrors(errors: string[]): string {
  return [
    "Goal flags could not be parsed.",
    ...errors.map((error) => `- ${error}`),
    "",
    "Supported flags: --max-turns, --max-minutes, --max-duration-ms, --max-tokens, --budget, --cooldown-ms, --no-progress-threshold, --no-progress-turns, --no-tool-turns, --success, --constraints, --mode.",
    'You can pass them as `--flag value` or `--flag=value`. Quote multi-word values, e.g. --success "tests pass and docs updated".',
  ].join("\n");
}

export { MAX_COMMAND_ARGUMENT_LENGTH };
