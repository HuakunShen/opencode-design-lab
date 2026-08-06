# Goal Mode for OpenCode Design Lab

Date: 2026-08-06
Status: Approved

## Context

Codex and Claude both ship goal mode: set an objective, and the agent keeps working
toward it autonomously until it is complete, blocked, or a safety limit is reached.
OpenCode lacks this; two community plugins implement it:

- `willytop8/OpenCode-goal-plugin` (v0.7.0) — mature, 7k LOC core, tested against
  real OpenCode 1.17.15/1.18.11 with live providers. The stronger implementation.
- `prevalentWare/opencode-goal-plugin` (v0.1.1) — Codex-style, TS, adds plan-mode
  safety and a TUI indicator. Credits willytop8 for its core ideas.

Decision: port willytop8's architecture into opencode-design-lab as a TypeScript
rewrite, adopting prevalentWare's plan-mode safety. Skip cross-process lease
ownership.

## Scope

Included:

1. Core goal loop: `/goal` command with set/status/history/list/pause/resume/edit/
   clear/add/focus/sequence subcommands, flag parsing, auto-continue, safety limits,
   evidence-gated completion, project-local persistence, compaction injection.
2. Agent tools: `goal_status`, `goal_set`, `goal_pause`, `goal_resume`, `goal_block`,
   `goal_complete`.
3. Multi-goal and ordered sequences.
4. Append-only lifecycle ledger with crash recovery.
5. Plan-mode safety (from prevalentWare).

Excluded:

- Cross-process lease ownership / passive mode (629 lines in upstream).
- Legacy state migration from `~/.opencode-goal-plugin`.
- Completion auditor (child-session verifier) — evidence gate only.
- TUI sidebar indicator — design-lab has no TUI surface.

## Architecture

New module `src/goals/`, mounted from `src/design-lab.ts`:

```
src/goals/
├── schema.ts          # Zod: GoalConfig, GoalState, GoalMeta, LedgerEntry
├── config.ts          # Extract goals section from DesignLabConfig; defaults
├── state.ts           # In-memory state + per-session sharded persistence
├── ledger.ts          # Append-only lifecycle ledger + crash recovery
├── completion.ts      # Evidence gate: [goal:evidence]+[goal:complete] / [goal:blocked]
├── limits.ts          # Safety limits: turns/duration/tokens/no-progress/no-tool-call
├── command.ts         # /goal subcommand parsing + --flags
├── auto-continue.ts   # Idle-driven continuation loop
├── compaction.ts      # experimental.session.compacting injection + disable generic
├── plan-mode.ts       # Plan-mode safety
├── tools.ts           # Agent tools
└── index.ts           # Assemble hooks for design-lab.ts
```

## Core Goal Loop

### command.execute.before

Intercepts `/goal`. Control subcommands (status/history/list) write result text
directly into the turn. Goal-setting subcommands wrap the objective in
`<goal_objective>` tags with success criteria, constraints, and remaining budget,
replacing the raw argument text. Rejects unknown flags, missing flag values, and
non-positive integers with helpful errors.

### chat.message

Recognizes command turns and plugin-issued continuation turns (matched by nonce);
both are marked owned. Any other new human message pauses the active goal with
stop reason `user intervention` and aborts an accepted continuation.

### tool.execute.before

Rejects every tool call during a control turn so the model cannot treat status
text as new work.

### event hook

- `session.idle` / `session.status` (idle): if not passive, budget remains, no
  human message preempted, not plan-restricted, cooldown elapsed → send a
  continuation prompt with remaining budget and completion audit. Continuations
  pin the initiating agent/provider/model.
- `session.compacted`: inject a deterministic goal summary reconstructed from
  persisted state so the goal survives compaction.

### experimental.compaction.autocontinue

Disabled while a goal is active so OpenCode's generic post-compaction auto-continue
does not race the plugin's own continuation.

### Completion validation

Scan the latest assistant turn for markers at the end:

- `[goal:complete]` honored only when immediately preceded by a `[goal:evidence]`
  line with a non-empty summary.
- `[goal:blocked]` honored only when preceded by a concrete blocker statement.
- Unsubstantiated claims are rejected; the plugin re-prompts for missing evidence.

## Safety Limits (limits.ts)

Defaults from willytop8:

| Limit | Default |
|---|---|
| Auto-continue turns | 10 |
| Max duration | 15 min |
| Context tokens | 200,000 |
| Min delay between continues | 1.5 s |
| No-progress threshold | < 50 output tokens, after 2-turn grace |
| No-tool-call turns | 2 consecutive |
| Budget wrap-up threshold | 80% of token budget |
| Prompt failure pause | 3 consecutive |

On a hard limit, send one wrap-up prompt asking the assistant to summarize what is
done, what remains, and the next concrete step — not a silent stop.

## Persistence and Recovery (state.ts + ledger.ts)

- Project-local root `<cwd>/.opencode/goals/state.json`; per-session SHA-256
  shards at `state.json.sessions/<hash>/state.json`, written 0600.
- Append-only lifecycle ledger `<shard>/state.json.ledger.jsonl` (0600). Every
  lifecycle event is one JSON line. Terminal events are written to the ledger
  *before* the state write (fail-closed).
- On startup, if the state file is missing or corrupt, reconstruct still-active
  goals from the ledger in a paused recovery state.
- `persist_state: false` gives purely in-memory behavior (no ledger).

## Multi-Goal and Sequences

- `/goal <condition>` replaces the focused goal.
- `/goal add <condition>` backgrounds the current goal and focuses the new one.
- `/goal list` shows numbered live goals; `/goal focus <n>` switches focus.
- `/goal sequence a; b; c` creates a strict queue; completing one auto-promotes
  the next. Auto-promotion stops when the queue is exhausted.
- Only the focused goal is auto-continued.

## Agent Tools (tools.ts)

- `goal_status`, `goal_set`, `goal_pause`, `goal_resume`, `goal_block`,
  `goal_complete` — canonical narrow ops returning compact versioned JSON
  envelopes.
- `goal_set` is constrained to user-requested goals.
- `goal_complete` accepts a structured claim: required non-empty summary, plus
  optional criterion/evidence pairs, checks (passed/failed/not-run), changed
  files, known limitations.

## Plan-Mode Safety (from prevalentWare)

- Goals created via `goal_set`/`/goal` from a restricted agent (default
  `["plan"]`) are recorded `paused` with stop reason `plan mode`, never active.
- Auto-continue is suppressed while the last user prompt or latest assistant
  turn came from a restricted agent; an active goal idling under Plan mode is
  paused visibly.
- Resume/activation is refused from Plan mode (prevents repo prompt injection
  from self-escalating a planning session).
- Continuation prompts pin the agent recorded from the last user prompt.
- `allow_goal_execution_from_plan: true` opts out of all restrictions.

## Configuration

New optional `goals` section in `design-lab.json`; unset fields use built-in
defaults:

```jsonc
{
  "models": [...],
  "goals": {
    "auto_continue": true,
    "max_auto_turns": 10,
    "max_duration_ms": 900000,
    "max_tokens": 200000,
    "min_delay_ms": 1500,
    "no_progress_token_threshold": 50,
    "no_progress_turns_before_pause": 2,
    "no_tool_call_turns_before_pause": 2,
    "budget_wrapup_ratio": 0.8,
    "max_prompt_failures": 3,
    "persist_state": true,
    "state_dir": ".opencode/goals",
    "restricted_agents": ["plan"],
    "allow_goal_execution_from_plan": false
  }
}
```

Command name is `/goal` (registered in `config.command` alongside existing
design-lab commands).

## Error Handling and Logging

- All errors caught with context; thrown as `Error` with descriptive messages.
- pino logger with structured context (existing `src/utils/logger.ts`).
- Lifecycle transitions logged; no dumps of full objective/evidence to logs.

## Testing

- Unit: command parsing (incl. flags), evidence gate, limit accounting, ledger
  reconstruction, sharded state read/write, plan-mode determination.
- Hook-level: mock client verifying command.execute.before replacement,
  chat.message preemption pause, event idle continuation conditions.
- Runs under existing `bun run test` / `bun run typecheck` / `bun run build`.

## Out of Scope / Future

- Cross-process lease ownership.
- Independent completion auditor.
- TUI goal indicator.
- State migration from upstream plugin locations.
