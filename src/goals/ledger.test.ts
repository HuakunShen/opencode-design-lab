import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  appendLedgerLine,
  readLedgerEntries,
  reconstructGoalsFromLedger,
} from "./ledger";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "goal-ledger-"));
}

describe("goal lifecycle ledger", () => {
  it("appends JSON lines in order", () => {
    const dir = tmpDir();
    const file = path.join(dir, "state.json.ledger.jsonl");
    expect(
      appendLedgerLine(file, { ts: 1, sessionID: "s1", type: "set", detail: "a" }),
    ).toBe(true);
    expect(
      appendLedgerLine(file, { ts: 2, sessionID: "s1", type: "paused", detail: "b" }),
    ).toBe(true);
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]).type).toBe("paused");
  });

  it("reads back entries in append order", () => {
    const dir = tmpDir();
    const file = path.join(dir, "ledger.jsonl");
    appendLedgerLine(file, { ts: 1, sessionID: "s1", type: "set", detail: "x" });
    appendLedgerLine(file, { ts: 2, sessionID: "s1", type: "auto-continue", detail: "y" });
    const entries = readLedgerEntries(file);
    expect(entries.map((e) => e.type)).toEqual(["set", "auto-continue"]);
  });

  it("rotates to .1 and reads back across rotations", () => {
    const dir = tmpDir();
    const file = path.join(dir, "ledger.jsonl");
    // Force rotation by capping each file at 200 bytes (default is 2MB).
    const opts = { maxBytes: 200, retentionFiles: 2 };
    for (let i = 1; i <= 4; i += 1) {
      appendLedgerLine(file, { ts: i, sessionID: "s1", type: `evt${i}`, detail: `line-${i}` }, opts);
    }
    // Newest line must still live in the main file.
    const main = fs.readFileSync(file, "utf8");
    expect(main).toContain('"type":"evt4"');
    // A rotated generation must exist.
    expect(fs.existsSync(`${file}.1`)).toBe(true);
    // readLedgerEntries reconstructs all entries in append order across files.
    const entries = readLedgerEntries(file, opts);
    expect(entries.map((e) => e.type)).toEqual(["evt1", "evt2", "evt3", "evt4"]);
    // retentionFiles=2 keeps at most 2 generations; .2 must not exist.
    expect(fs.existsSync(`${file}.2`)).toBe(false);
  });

  it("skips malformed lines", () => {
    const dir = tmpDir();
    const file = path.join(dir, "ledger.jsonl");
    fs.writeFileSync(file, "{bad json}\n{\"ts\":1,\"sessionID\":\"s1\",\"type\":\"set\"}\n");
    const entries = readLedgerEntries(file);
    expect(entries).toHaveLength(1);
  });

  it("reconstructs active goals and skips terminal ones", () => {
    const entries = [
      { ts: 1, sessionID: "s1", goalId: "g1", condition: "fix tests", type: "set", snapshot: { stopped: false, stopReason: "" } },
      { ts: 2, sessionID: "s1", goalId: "g1", type: "completed", detail: "done", snapshot: { stopped: true, stopReason: "" } },
      { ts: 3, sessionID: "s2", goalId: "g2", condition: "write docs", type: "set", snapshot: { stopped: false } },
    ];
    const goals = reconstructGoalsFromLedger(entries);
    expect(goals).toHaveLength(1);
    expect(goals[0].sessionID).toBe("s2");
    expect(goals[0].condition).toBe("write docs");
    expect(goals[0].stopped).toBe(true);
    expect(goals[0].stopReason).toBe("recovered after restart");
  });
});
