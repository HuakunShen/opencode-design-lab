const MAX_SUMMARY_LENGTH = 500;
const MAX_CRITERIA = 20;
const MAX_CHECKS = 20;
const MAX_CHANGED_FILES = 100;
const MAX_LIMITATIONS = 20;
const MAX_CRITERION_LENGTH = 300;
const MAX_ITEM_LENGTH = 500;
const CHECK_RESULTS = new Set(["passed", "failed", "not-run"]);

export const MAX_LEGACY_EVIDENCE_LENGTH = 8000;
const MAX_GOAL_BLOCKER_LENGTH = 2000;

export function goalIsComplete(text: string): boolean {
  return /(^|\n)\s*(?:\[goal:complete\]|goal:complete)\s*$/i.test(String(text ?? "").trimEnd());
}

export function goalIsBlocked(text: string): boolean {
  return /(^|\n)\s*(?:\[goal:blocked\]|goal:blocked)\s*$/i.test(String(text ?? "").trimEnd());
}

export function extractCompletionEvidence(text: string): string {
  const lines = String(text ?? "").trimEnd().split("\n");
  const markerIndex = lines.findLastIndex((line) => {
    const trimmed = line.trim().toLowerCase();
    return trimmed === "[goal:complete]" || trimmed === "goal:complete";
  });
  if (markerIndex < 0) return "";
  const previous = markerIndex - 1;
  if (previous < 0) return "";
  const raw = lines[previous].trim();
  const inlineMatch = raw.match(/^\[?\s*goal:evidence\s*\]?[:\-\s]+(.+)$/i);
  if (inlineMatch) return inlineMatch[1].trim().slice(0, MAX_LEGACY_EVIDENCE_LENGTH);
  if (previous > 0 && /^\[?\s*goal:evidence\s*\]?:?$/i.test(lines[previous - 1].trim())) {
    return raw.slice(0, MAX_LEGACY_EVIDENCE_LENGTH);
  }
  return "";
}

export function extractBlockedReason(text: string): string {
  const lines = String(text ?? "").trimEnd().split("\n");
  const markerIndex = lines.findLastIndex((line) => {
    const trimmed = line.trim().toLowerCase();
    return trimmed === "[goal:blocked]" || trimmed === "goal:blocked";
  });
  if (markerIndex <= 0) return "";
  return lines[markerIndex - 1].trim().slice(0, MAX_GOAL_BLOCKER_LENGTH);
}

export type CompletionClaim = {
  summary: string;
  criteria?: { criterion: string; evidence: string[] }[];
  checks?: {
    command?: string;
    result: string;
    exitCode?: number;
    explanation?: string;
  }[];
  changedFiles?: string[];
  knownLimitations?: string[];
};

type ClaimResult =
  | { ok: true; evidence: string }
  | { ok: false; error: string };

function cleanStringList(
  values: unknown[],
  field: string,
): { ok: true; values: string[] } | { ok: false; error: string } {
  const cleaned = values.map((value) =>
    typeof value === "string" ? value.trim() : "",
  );
  return cleaned.every((value) => value && value.length <= MAX_ITEM_LENGTH)
    ? { ok: true, values: cleaned }
    : {
        ok: false,
        error: `${field} entries must be non-empty strings of ${MAX_ITEM_LENGTH} characters or fewer`,
      };
}

export function serializeCompletionClaim(raw: Record<string, unknown> = {}): ClaimResult {
  const claim = raw && typeof raw === "object" ? raw : {};
  const summary = typeof claim.summary === "string" ? claim.summary.trim() : "";
  if (!summary) return { ok: false, error: "summary must be a non-empty string" };
  if (summary.length > MAX_SUMMARY_LENGTH) {
    return { ok: false, error: `summary must be ${MAX_SUMMARY_LENGTH} characters or fewer` };
  }

  const criteria = claim.criteria === undefined ? [] : claim.criteria;
  const checks = claim.checks === undefined ? [] : claim.checks;
  const changedFiles = claim.changedFiles === undefined ? [] : claim.changedFiles;
  const knownLimitations = claim.knownLimitations === undefined ? [] : claim.knownLimitations;
  if (
    !Array.isArray(criteria) ||
    !Array.isArray(checks) ||
    !Array.isArray(changedFiles) ||
    !Array.isArray(knownLimitations)
  ) {
    return {
      ok: false,
      error: "criteria, checks, changedFiles, and knownLimitations must be arrays when provided",
    };
  }
  if (
    criteria.length > MAX_CRITERIA ||
    checks.length > MAX_CHECKS ||
    changedFiles.length > MAX_CHANGED_FILES ||
    knownLimitations.length > MAX_LIMITATIONS
  ) {
    return { ok: false, error: "completion claim exceeds item limits" };
  }

  const cleanCriteria: { criterion: string; evidence: string[] }[] = [];
  for (const item of criteria) {
    const record = (item ?? {}) as Record<string, unknown>;
    const criterion = typeof record.criterion === "string" ? record.criterion.trim() : "";
    const evidence = Array.isArray(record.evidence)
      ? record.evidence
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .filter(Boolean)
      : [];
    if (!criterion || evidence.length === 0) {
      return {
        ok: false,
        error: "each criterion requires a non-empty criterion and at least one evidence item",
      };
    }
    if (
      criterion.length > MAX_CRITERION_LENGTH ||
      evidence.some((value) => value.length > MAX_ITEM_LENGTH)
    ) {
      return {
        ok: false,
        error: `criterion must be ${MAX_CRITERION_LENGTH} characters or fewer and evidence items ${MAX_ITEM_LENGTH} or fewer`,
      };
    }
    cleanCriteria.push({ criterion, evidence });
  }

  const cleanChecks: { command: string; result: string; exitCode?: number; explanation: string }[] = [];
  for (const item of checks) {
    const record = (item ?? {}) as Record<string, unknown>;
    const result = typeof record.result === "string" ? record.result.trim() : "";
    if (!CHECK_RESULTS.has(result)) {
      return { ok: false, error: "each check result must be passed, failed, or not-run" };
    }
    if (result === "failed") {
      return { ok: false, error: "completion cannot include a failed check" };
    }
    const command = typeof record.command === "string" ? record.command.trim() : "";
    const explanation = typeof record.explanation === "string" ? record.explanation.trim() : "";
    const exitCode = record.exitCode;
    if (exitCode !== undefined && (!Number.isInteger(exitCode) || (exitCode as number) < 0)) {
      return { ok: false, error: "check exitCode must be a non-negative integer" };
    }
    if (!command && !explanation) {
      return { ok: false, error: "each check requires a command or explanation" };
    }
    if (command.length > MAX_ITEM_LENGTH || explanation.length > MAX_ITEM_LENGTH) {
      return {
        ok: false,
        error: `check command and explanation must be ${MAX_ITEM_LENGTH} characters or fewer`,
      };
    }
    cleanChecks.push({ command, result, exitCode: exitCode as number | undefined, explanation });
  }

  const files = cleanStringList(changedFiles, "changedFiles");
  if (!files.ok) return files;
  const limitations = cleanStringList(knownLimitations, "knownLimitations");
  if (!limitations.ok) return limitations;

  const lines = [`Summary: ${summary}`];
  cleanCriteria.forEach(({ criterion, evidence }) => {
    lines.push(`Criterion: ${criterion} | Evidence: ${evidence.join("; ")}`);
  });
  cleanChecks.forEach(({ command, result, exitCode, explanation }) => {
    const subject = command || "manual check";
    const details = [exitCode === undefined ? "" : `exit ${exitCode}`, explanation]
      .filter(Boolean)
      .join("; ");
    lines.push(`Check: ${subject} | ${result}${details ? ` | ${details}` : ""}`);
  });
  if (files.values.length) lines.push(`Changed files: ${files.values.join(", ")}`);
  if (limitations.values.length) {
    lines.push(`Known limitations: ${limitations.values.join("; ")}`);
  }
  return { ok: true, evidence: lines.join("\n") };
}
