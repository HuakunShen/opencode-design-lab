# Agent Orchestration

<cite>
**Referenced Files in This Document**
- [src/agents/index.ts](file://src/agents/index.ts)
- [src/design-lab.ts](file://src/design-lab.ts)
- [src/commands/index.ts](file://src/commands/index.ts)
- [src/agents/index.test.ts](file://src/agents/index.test.ts)
- [src/design-lab.test.ts](file://src/design-lab.test.ts)
- [.journal/2026-05-03-1706.md](file://.journal/2026-05-03-1706.md)
- [.journal/2026-05-05.md](file://.journal/2026-05-05.md)
</cite>

## Table of Contents

1. [Designer Workflow](#designer-workflow)
2. [Double-Blind Review](#double-blind-review)
3. [General Multi-Model Ask](#general-multi-model-ask)
4. [Failure Handling](#failure-handling)
5. [Permissions and Tool Contracts](#permissions-and-tool-contracts)

## Designer Workflow

The `designer` primary agent receives design, review, and synthesis command
templates. Its generated prompt contains the design subagent list, review
subagent list, blind mapping table, delegate_task usage contract, directory
layout, error handling rules, and iterative revision workflow.

For design generation, the primary creates a dated run directory, creates
`designs/`, `reviews/`, and `blinds/designs-blind/`, delegates all design tasks,
checks the results, and then creates anonymous copies for review. For review, it
delegates comparative reviews against blind copies. For synthesis, it reads
`blinds/mapping.json`, review files, and score files, then writes
`final-report.md` with real model names.

**Section sources**

- [src/agents/index.ts](file://src/agents/index.ts#L274-L487)
- [src/commands/index.ts](file://src/commands/index.ts#L101-L245)
- [src/design-lab.ts](file://src/design-lab.ts#L82-L117)

## Double-Blind Review

The blind review system is prompt-enforced. Only the primary agent has the
blind-to-real mapping. Review subagents read anonymous files named `design-a.md`,
`design-b.md`, and so on, and their prompts explicitly prohibit guessing the
producer model. The mapping supports more than 26 designs by switching from
single-letter labels to base-26 labels such as `design-aa`.

```mermaid
flowchart LR
    Designs[designs/{model}.md] --> Strip[Strip model identity]
    Strip --> Blind[blinds/designs-blind/design-a.md]
    Strip --> Mapping[blinds/mapping.json]
    Blind --> Reviewers[review subagents]
    Reviewers --> Reviews[reviews/review-{model}.md]
    Mapping --> Final[final-report.md with real names]
    Reviews --> Final
```

**Diagram sources**

- [src/agents/index.ts](file://src/agents/index.ts#L293-L336)
- [src/agents/index.ts](file://src/agents/index.ts#L413-L461)
- [.journal/2026-05-05.md](file://.journal/2026-05-05.md#L11-L33)

**Section sources**

- [src/agents/index.ts](file://src/agents/index.ts#L293-L336)
- [src/agents/index.ts](file://src/agents/index.ts#L413-L461)
- [src/agents/index.ts](file://src/agents/index.ts#L536-L570)
- [.journal/2026-05-05.md](file://.journal/2026-05-05.md#L5-L33)

## General Multi-Model Ask

The general ask workflow is separate from design/review. The `multi_model`
primary uses `ask_models` if configured, otherwise `design_models`. It creates a
run directory, writes the original prompt to `prompt.md`, delegates the same
prompt to every `multi_model_*` subagent, verifies response files, reads all
successful responses, and writes `summary.md` with consensus, disagreements,
model-by-model notes, final recommendation, and failures.

Subagents in this family are general-purpose answer writers. They write one
Markdown response to the exact output path supplied by the primary agent and must
not compare themselves to other models.

**Section sources**

- [src/agents/index.ts](file://src/agents/index.ts#L128-L186)
- [src/agents/index.ts](file://src/agents/index.ts#L188-L271)
- [src/design-lab.ts](file://src/design-lab.ts#L58-L64)
- [src/design-lab.ts](file://src/design-lab.ts#L88-L109)
- [src/commands/index.ts](file://src/commands/index.ts#L71-L99)
- [src/agents/index.test.ts](file://src/agents/index.test.ts#L9-L55)
- [src/design-lab.test.ts](file://src/design-lab.test.ts#L23-L40)

## Failure Handling

Failure handling is encoded in prompts rather than enforced by a runtime hook.
The primary agent must inspect every `delegate_task` result, classify failure
signals, retry rate-limit and timeout cases once, skip payment/auth failures, and
stop if all subagents fail. Subagents are instructed to start errors with
`FAILED:` and to use consistent failure messages for missing parameters,
payment/model access, rate limits, tool errors, read failures, and timeouts.

**Section sources**

- [src/agents/index.ts](file://src/agents/index.ts#L367-L390)
- [src/agents/index.ts](file://src/agents/index.ts#L504-L516)
- [.journal/2026-05-03-1706.md](file://.journal/2026-05-03-1706.md#L28-L34)
- [.journal/2026-05-03-1706.md](file://.journal/2026-05-03-1706.md#L43-L48)

## Permissions and Tool Contracts

Primary agents allow reading, writing, bash, and `delegate_task` while disabling
the plain `task` tool. The `designer` primary has the edit tool listed but edit
permission denied. The `multi_model` primary allows edit permission in the
current implementation, although its prompt does not require source edits.

Subagents allow read/write and deny bash, task, and delegate_task. Their edit tool
flag is false while edit permission is set to allow. Tests assert the current
generic multi-model permission behavior, so permission changes should be made
intentionally and with test updates.

**Section sources**

- [src/agents/index.ts](file://src/agents/index.ts#L78-L96)
- [src/agents/index.ts](file://src/agents/index.ts#L106-L125)
- [src/agents/index.ts](file://src/agents/index.ts#L135-L155)
- [src/agents/index.ts](file://src/agents/index.ts#L166-L185)
- [src/agents/index.test.ts](file://src/agents/index.test.ts#L16-L55)
