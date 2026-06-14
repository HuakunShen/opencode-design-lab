---
name: journal
description: Reviews recent changes and decisions, and documents them in a dated journal file.
---

# Journal Skill

I help maintain a project journal by documenting recent work, decisions, and architectural tradeoffs.

## What I do

1.  **Analyze**: I review recent git changes and conversation context to understand the scope of work and decisions made.
2.  **Summarize**: I synthesize a summary focusing on rationale and tradeoffs.
3.  **Document**: I append structured entries to dated journal files in `.journal/YYYY-MM-DD-HHMM.md`.
4.  **Report**: I provide the path to the journal entry for verification.

## When to use me

Use this skill to document:

- Significant feature completions.
- Architectural decisions or changes in direction.
- Resolution of complex bugs with specific rationale.
- Tradeoffs made during development.

## Entry Structure

Each entry I create follows this structure:

- **Timestamp**: The time of the entry.
- **Core Decision/Topic**: The primary focus.
- **Options Considered**: Alternatives that were discussed.
- **Final Decision & Rationale**: Why the specific path was chosen.
- **Key Changes Made**: Summary of modified files/logic.
- **Future Considerations**: Any remaining debt or follow-up items.

## Implementation Instructions (for the Agent)

When this skill is activated:

1.  Get the current datetime in `YYYY-MM-DD-HHMM` format.
2.  Run `git diff HEAD~1` (or appropriate range) to see recent changes.
3.  Review the recent conversation history for context on "why" decisions were made.
4.  Ensure the `.journal` directory exists in the project root.
5.  Read the existing `.journal/YYYY-MM-DD-HHMM.md` if it exists.
6.  Append the new entry using the structure above.
7.  Return a confirmation message with the filename.
