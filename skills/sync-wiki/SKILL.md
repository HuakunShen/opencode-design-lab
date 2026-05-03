---
name: sync-wiki
description: Sync .repowiki documentation based on recent changes. Reads .journal entries, .reports experiment results, and git diff to update relevant wiki pages. Use when user mentions "sync wiki", "update repowiki", or after completing significant work.
license: MIT
metadata:
  author: polyquant
  domain: documentation
  tags:
    - wiki
    - documentation
    - changelog
    - knowledge-base
---

# Sync Wiki

Synchronize `.repowiki/` documentation with recent project changes by analyzing journals, reports, and code modifications.

## When to Use

- User explicitly asks to "sync wiki" or "update repowiki"
- After completing significant experiments or features
- Before major commits to ensure documentation is current
- When AGENTS.md references outdated information

## Core Concepts

### Information Sources

The skill synthesizes information from three sources:

| Source      | Purpose                                   | Location                         |
| ----------- | ----------------------------------------- | -------------------------------- |
| `.journal/` | Daily dev notes, decisions, rationale     | `.journal/YYYY-MM-DD*.md`        |
| `.reports/` | Experiment results, analysis, conclusions | `.reports/YYYY-MM-DD*/report.md` |
| Git changes | Code modifications, new files, refactors  | `git diff`, `git log`            |

### Wiki Structure

```
.repowiki/en/content/
├── System Overview.md           # High-level architecture
├── Architecture/                # Architectural decisions
│   └── Architecture.md
├── Services/                    # Major services/modules
│   ├── Inplay Model.md
│   ├── Backtesting Module.md
│   └── Live Inference Engine.md
├── Packages/                    # Package documentation
│   ├── Strategy Package/
│   └── Config Package/
└── Infrastructure/              # Infra components
    └── Live Data Pipeline.md
```

### Update Strategy

1. **Targeted updates**: Only modify pages affected by recent changes
2. **Preserve structure**: Keep existing sections, add/update content
3. **Timestamp markers**: Add "Updated: YYYY-MM-DD" for significant changes
4. **Cross-reference**: Link to relevant journal entries and reports

## Step-by-Step Instructions

### Phase 1: Discovery

**Mark "discovery" as in_progress.**

Gather information about recent changes:

```bash
# Recent git changes (last 7 days)
git log --oneline --since="7 days ago"

# Changed files
git diff --name-only HEAD~10

# Recent journal entries (last 7 days)
find .journal -name "*.md" -mtime -7 -type f

# Recent reports
find .reports -name "report.md" -mtime -7 -type f
```

### Phase 2: Analysis

**Mark "analysis" as in_progress.**

Read and analyze the gathered information:

1. **Journal entries**: Extract key decisions, rationale, and pending items
2. **Reports**: Extract experiment results, metrics, and conclusions
3. **Git changes**: Identify affected modules/services

Determine which wiki pages need updates:

| Change Type         | Wiki Pages to Update                       |
| ------------------- | ------------------------------------------ |
| New feature         | Relevant Service page, System Overview     |
| Experiment results  | Relevant Service page + experiment section |
| Architecture change | Architecture page, affected Services       |
| Bug fix             | Implementation Notes section               |
| Config change       | Config Package page, affected Services     |

### Phase 3: Update Wiki

**Mark "update" as in_progress.**

For each affected wiki page:

#### 3.1 Read Existing Content

```typescript
Read((filePath = ".repowiki/en/content/Services/Inplay Model.md"));
```

#### 3.2 Identify Update Points

Look for:

- **Results tables**: Update with latest experiment data
- **Implementation Notes**: Add new gotchas or patterns
- **Usage section**: Update CLI commands or API examples
- **Configuration**: Update default values or new options

#### 3.3 Apply Targeted Edits

Use `Edit` tool with precise replacements:

```typescript
// Example: Update results table
Edit(
  (filePath = ".repowiki/en/content/Services/Inplay Model.md"),
  (edits = [
    {
      op: "replace",
      pos: "LINE#ID", // Start of results table
      end: "LINE#ID", // End of results table
      lines: newTableContent,
    },
  ]),
);
```

#### 3.4 Add Update Marker (if significant)

For major changes, add timestamp at the top of the affected section:

```markdown
### Results

**Updated: 2026-02-28** — Feature pruning +6m data extension

| Symbol | Metric | Value |
...
```

### Phase 4: Update AGENTS.md (if needed)

**Mark "agents" as in_progress.**

If experiment results in AGENTS.md need updating:

1. Read current AGENTS.md
2. Find the relevant section (e.g., "EXPERIMENT RESULTS")
3. Update tables with new findings
4. Add new entries to "Key Experiment Findings" list

```typescript
Edit(
  (filePath = "AGENTS.md"),
  (edits = [
    {
      op: "replace",
      pos: "LINE#ID",
      end: "LINE#ID",
      lines: updatedExperimentResults,
    },
  ]),
);
```

### Phase 4.5: Update Metadata (MANDATORY)

**Every wiki sync MUST update `.repowiki/en/meta/repowiki-metadata.json`.**

This file is the wiki index used by external tools. If it's stale, the wiki appears incomplete.

1. Read current metadata: `Read(filePath=".repowiki/en/meta/repowiki-metadata.json")`
2. Update `version` to today's date (YYYY-MM-DD)
3. Update `last_commit` to current HEAD: `git rev-parse HEAD`
4. Ensure ALL wiki pages from `.repowiki/en/content/` are listed in `wiki_items`
5. Add/update `knowledge_relations` for new parent-child or reference relationships
6. Remove `gmt_create`/`gmt_modified` fields (not needed, clutter the file)

**Common patterns for new pages:**

```json
{
  "id": "unique-uuid",
  "title": "Page Title",
  "path": "content/Section/Page Title.md"
}
```

**Relation types:**

- `PARENT_CHILD`: Section → subpage (e.g., Services → Inplay Model)
- `REFERENCE`: Cross-link between pages (e.g., Strategy Lab → Inplay Model)

**Verification**: After updating, count `wiki_items` and compare with actual `.md` files in `content/`. They must match.

### Phase 5: Summary

**Mark "complete" as in_progress.**

Report what was updated:

```
=== Wiki Sync Complete ===

Sources analyzed:
  - Journal entries: 3
  - Reports: 2
  - Git commits: 12

Pages updated:
  [OK] .repowiki/en/content/Services/Inplay Model.md
       - Updated results table with 5s resolution data
       - Added feature pruning section
  [OK] AGENTS.md
       - Updated EXPERIMENT RESULTS section
       - Added finding #18 (feature pruning)

No changes needed:
  - .repowiki/en/content/Architecture/Architecture.md
  - .repowiki/en/content/Packages/Config Package/
```

## Update Patterns

### Pattern 1: Experiment Results Update

When a new report is published:

```markdown
### Results

**Latest Results (YYYY-MM-DD)**:

| Metric | Previous | Current | Δ   |
| ------ | -------- | ------- | --- |
| ...    | ...      | ...     | ... |

See `.reports/YYYY-MM-DD-experiment-name/` for full details.
```

### Pattern 2: Configuration Default Change

When default config values change:

````markdown
### Configuration

```python
config = TrainingConfig(
    new_field=default_value,  # Added YYYY-MM-DD: brief reason
)
```
````

````

### Pattern 3: New Feature Documentation

When a new feature is added:

```markdown
### New Feature Name

**Added: YYYY-MM-DD**

Brief description of what it does.

Usage:
```bash
command --new-flag
````

See `.journal/YYYY-MM-DD-entry.md` for design rationale.

````

### Pattern 4: Bug Fix Note

When a bug is fixed:

```markdown
### Implementation Notes

**Timestamp Safety (Critical)** — Fixed YYYY-MM-DD

Description of the bug and the fix.

```python
# BEFORE (buggy)
...

# AFTER (fixed)
...
````

```

## Content Guidelines

### DO

- Keep updates minimal and targeted
- Preserve existing section structure
- Add cross-references to sources (.journal, .reports)
- Include dates for significant changes
- Update tables in place rather than appending duplicates
- **Update `repowiki-metadata.json` on every sync** — version, last_commit, wiki_items, knowledge_relations

### DO NOT

- Rewrite entire wiki pages
- Remove historical context without reason
- Duplicate information across pages
- Add verbose explanations (link to reports instead)
- Update pages unrelated to recent changes

## Common Pitfalls

1. **Over-updating**: Only touch pages directly affected by changes
2. **Missing context**: Always include the "why" from journal entries
3. **Stale references**: Update file paths if code moved
4. **Duplicate content**: Check if information exists before adding
5. **Breaking links**: Verify internal wiki links after reorganization
6. **Forgetting metadata**: `repowiki-metadata.json` MUST be updated every sync — stale metadata makes wiki appear incomplete to external tools

## Example Session

User: "sync wiki based on recent changes"

```

1. Discovery: Found 5 journal entries, 2 reports, 15 git commits
2. Analysis: Changes affect Inplay Model and Backtesting Module
3. Update:
   - Inplay Model.md: Added 5s resolution results, feature pruning section
   - Backtesting Module.md: Updated entry timing strategies table
   - AGENTS.md: Added findings #17-18, updated experiment results
4. Summary: 3 pages updated, 0 created, 5 unchanged

```

## References

- Wiki structure: `.repowiki/en/content/`
- Journal format: `.journal/YYYY-MM-DD*.md`
- Report format: `.reports/YYYY-MM-DD*/report.md`
- AGENTS.md: Project root
```
