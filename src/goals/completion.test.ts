import { describe, expect, it } from "vitest";
import {
  extractBlockedReason,
  extractCompletionEvidence,
  goalIsBlocked,
  goalIsComplete,
  serializeCompletionClaim,
} from "./completion";

describe("goal marker detection", () => {
  it("detects bracketed and bare completion markers at end of text", () => {
    expect(goalIsComplete("did work\n[goal:complete]")).toBe(true);
    expect(goalIsComplete("did work\ngoal:complete")).toBe(true);
    expect(goalIsComplete("did work")).toBe(false);
    expect(goalIsComplete("goal is complete now")).toBe(false);
  });

  it("detects blocked markers", () => {
    expect(goalIsBlocked("need a token\n[goal:blocked]")).toBe(true);
    expect(goalIsBlocked("need a token")).toBe(false);
  });

  it("extracts inline evidence immediately before completion", () => {
    const evidence = extractCompletionEvidence(
      "ran npm test (83 passing)\n[goal:evidence] tests pass\n[goal:complete]",
    );
    expect(evidence).toBe("tests pass");
  });

  it("supports the historical two-line evidence form", () => {
    const evidence = extractCompletionEvidence(
      "done\n[goal:evidence]\nran the suite\n[goal:complete]",
    );
    expect(evidence).toBe("ran the suite");
  });

  it("rejects completion without adjacent evidence", () => {
    expect(extractCompletionEvidence("done\n[goal:complete]")).toBe("");
  });

  it("extracts the concrete blocker line before the marker", () => {
    const reason = extractBlockedReason(
      "The deploy step needs a production API token I don't have.\n[goal:blocked]",
    );
    expect(reason).toContain("production API token");
  });

  it("rejects blocked without a preceding line", () => {
    expect(extractBlockedReason("[goal:blocked]")).toBe("");
  });
});

describe("serializeCompletionClaim", () => {
  it("requires a non-empty summary", () => {
    expect(serializeCompletionClaim({}).ok).toBe(false);
    expect(serializeCompletionClaim({ summary: "done" }).ok).toBe(true);
  });

  it("rejects failed checks", () => {
    const result = serializeCompletionClaim({
      summary: "done",
      checks: [{ command: "npm test", result: "failed" }],
    });
    expect(result.ok).toBe(false);
  });

  it("renders evidence lines from a valid claim", () => {
    const result = serializeCompletionClaim({
      summary: "migrated auth",
      criteria: [{ criterion: "tests pass", evidence: ["npm test ok"] }],
      changedFiles: ["src/auth.ts"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.evidence).toContain("Summary: migrated auth");
      expect(result.evidence).toContain("Criterion: tests pass");
    }
  });

  it("rejects invalid exitCode and missing check detail", () => {
    expect(
      serializeCompletionClaim({
        summary: "done",
        checks: [{ command: "npm test", result: "passed", exitCode: -1 }],
      }).ok,
    ).toBe(false);
    expect(
      serializeCompletionClaim({
        summary: "done",
        checks: [{ command: "npm test", result: "passed", exitCode: 1.5 }],
      }).ok,
    ).toBe(false);
    expect(
      serializeCompletionClaim({
        summary: "done",
        checks: [{ result: "passed" }],
      }).ok,
    ).toBe(false);
    expect(
      serializeCompletionClaim({
        summary: "done",
        checks: [{ command: "npm test", result: "passed", exitCode: 0 }],
      }).ok,
    ).toBe(true);
  });
});
