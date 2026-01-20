# OpenCode Design Lab PRD

**Requirements Specification (v1.0)**

## 1. Purpose & Scope

**OpenCode Design Lab** is an OpenCode plugin whose primary purpose is to:

> **Generate multiple independent design proposals using different AI agents/models, then systematically evaluate, compare, and rank those designs in a reproducible and structured way.**

The system is intended for:

- System design
- Architecture design
- API / data model / workflow design
- High-level technical planning

It is **not limited to code generation** and must treat “design” as a first-class artifact.

---

## 2. Core Design Principles

1. **Separation of concerns**
   - Plugins orchestrate and control execution.
   - Agents only _generate or evaluate content_.

2. **Isolation**
   - Each design agent runs in an isolated context.
   - No agent may see other agents’ outputs unless explicitly instructed during evaluation.

3. **Reproducibility**
   - Given the same inputs and configuration, results should be reproducible as much as the underlying models allow.
   - Outputs must be stored deterministically.

4. **Structured Outputs**
   - All generated designs and evaluations must conform to predefined schemas (JSON or structured Markdown).

5. **Model-agnostic**
   - The system must support multiple models/providers without special-case logic.

---

## 3. High-Level Architecture

```
OpenCode Design Lab (Plugin)
│
├── Setup Phase
│   ├── Generate topic from requirements (AI)
│   └── Create directory: .design-lab/YYYY-MM-DD-{topic}/
│
├── Design Phase (with Hook Enforcement)
│   ├── Design Agent A (Model X) → {model-x}.json
│   ├── Design Agent B (Model Y) → {model-y}.json
│   └── Design Agent C (Model Z) → {model-z}.json
│   (Hook: Agents cannot read other designs)
│
├── Review Phase
│   ├── Review Model A (reads all designs) → review-{model-a}.md
│   ├── Review Model B (reads all designs) → review-{model-b}.md
│   └── Review Model C (reads all designs) → review-{model-c}.md
│
├── Score Aggregation Phase
│   └── Plugin parses all review files → scores.json
│
└── Output Artifacts
    ├── .design-lab/YYYY-MM-DD-{topic}/
    │   ├── task.json
    │   ├── designs/
    │   ├── reviews/
    │   └── scores.json
```

The **plugin** is the system controller.
**Agents never orchestrate other agents.**
**Design agents are isolated from each other via hooks.**

---

## 4. Functional Requirements

### 4.1 Design Generation

The system **MUST**:

- Accept a **design task description** as input, including:
  - Problem statement
  - Constraints
  - Non-functional requirements (if any)

- Invoke **N design agents**, each configured with:
  - A specific model
  - A specific prompt template

- Ensure:
  - Each agent runs in a **clean context**
  - No shared memory or cross-pollination between agents

Each design agent **MUST** output a structured design artifact.

---

### 4.2 Design Artifact Format

Each design output **MUST** include at minimum:

```json
{
  "title": "...",
  "summary": "...",
  "assumptions": [],
  "architecture_overview": "...",
  "components": [],
  "data_flow": "...",
  "tradeoffs": [],
  "risks": [],
  "open_questions": []
}
```

- Exact fields may evolve, but **schema enforcement is required**.
- Free-form text is allowed _inside fields_, but not outside the schema.

---

### 4.3 Evaluation & Review

The system **MUST** support at least two evaluation modes:

#### 4.3.1 Qualitative Review

- One or more **review agents** analyze each design.
- Review agents:
  - May see **one design at a time**
  - Must not know which model produced the design

- Output must be structured, e.g.:

```json
{
  "strengths": [],
  "weaknesses": [],
  "missing_considerations": [],
  "risk_assessment": "low | medium | high"
}
```

---

#### 4.3.2 Quantitative Scoring

- One or more **scoring agents** assign numeric scores.
- Scores **MUST** be numeric and bounded.

Example:

```json
{
  "clarity": 0-10,
  "feasibility": 0-10,
  "scalability": 0-10,
  "maintainability": 0-10,
  "overall": 0-10,
  "justification": "..."
}
```

- Scoring agents must not see:
  - Other scores
  - Rankings
  - Agent identities

---

### 4.4 Aggregation & Ranking

Aggregation **MUST be performed by the plugin**, not by agents.

The plugin **MUST**:

- Aggregate scores across:
  - Multiple scoring agents (if configured)

- Produce:
  - Average scores
  - Rankings
  - Optional variance / disagreement metrics

Example aggregate output:

```json
{
  "design_id": "design-B",
  "rank": 1,
  "average_score": 8.4,
  "score_breakdown": {
    "clarity": 8.7,
    "feasibility": 8.2,
    "scalability": 8.5
  }
}
```

---

## 5. Plugin Responsibilities (Non-Negotiable)

The plugin **MUST** handle:

- Agent invocation
- Topic generation (using AI to generate meaningful topic from requirements)
- Directory creation (`.design-lab/YYYY-MM-DD-{topic}/`)
- Context isolation via hook mechanism
  - Intercept read operations during design phase
  - Reject any attempts to read files under `.design-lab/*/designs/` during design generation
- Prompt injection
- Schema validation
- File I/O
- Error handling
- Retry logic (optional but recommended)
- Score aggregation (parse review files and compute averages)

Agents **MUST NOT**:

- Decide filenames
- Decide directory layout
- Rank themselves
- Compare against other agents' outputs during design phase
- Read other designs during design generation (enforced by hook)

---

## 6. Output Structure

The system **MUST** persist all artifacts to disk.

Recommended layout:

```
design-lab/
├── input/
│   └── task.json
├── designs/
│   ├── design-A.json
│   ├── design-B.json
│   └── design-C.json
├── reviews/
│   ├── design-A.review.json
│   └── ...
├── scores/
│   ├── design-A.score.json
│   └── ...
└── results/
    └── ranking.json
```

---

## 7. Configuration Requirements

The system **MUST** allow configuration of:

- Number of design agents (minimum 2)
- Models per agent (design and review models can be the same or different)
- Prompt templates for design generation
- Scoring criteria (dimensions, scale, descriptions)
- Topic generation model (can use one of the configured models)
- Base output directory (default: `.design-lab/`)
- Hook enforcement for design isolation

The system **MUST** define a dedicated config file for model selection (similar to `~/.config/opencode/oh-my-opencode.json`) to store:

- Design models (used for design generation)
- Review models (used for qualitative and/or quantitative review)

The config file **MUST** explicitly support:

- `design_models`: array of model identifiers used for design generation
- `review_models`: optional array of model identifiers used for review

**Defaulting rule**:

- If `review_models` is not specified, **all design models** are used to review all designs.
- If `review_models` is specified, **only those models** are used for review.

**Implementation Note**:
- The system must support dynamic model selection at runtime based on the config file.
- Agent model specifications should be overridden from the config, not by dynamically generating agent files.
- Similar to oh-my-opencode's approach, the plugin should merge config-based model overrides with predefined agent configurations at runtime.

Configuration **MUST NOT** be hardcoded.

---

## 8. Non-Functional Requirements

### 8.1 Determinism

- Identical inputs should produce structurally identical outputs.

### 8.2 Extensibility

- New agent types (e.g., security reviewer) can be added without refactoring core logic.

### 8.3 Transparency

- All intermediate artifacts must be inspectable by humans.

---

## 9. Explicit Non-Goals

The system is **NOT required to**:

- Automatically merge designs
- Automatically choose a “correct” design
- Perform code generation
- Optimize prompts autonomously

---

## 10. Future Extensions (Out of Scope for v1)

- Iterative refinement loops
- Elo-style or pairwise ranking
- Human-in-the-loop scoring
- Visualization dashboards

---

## 11. Summary (Design Intent)

> **OpenCode Design Lab treats design as an experimental artifact, not a chat response.**
> It enforces isolation, structure, evaluation, and reproducibility so that multiple AI-generated designs can be compared rigorously rather than impressionistically.
>
> The goal is not simply to pick the "best" design, but to extract the best practices and insights from each model's design, then merge them into a superior composite design. Each model contributes unique strengths that can be combined to create a more robust solution.

## References

- https://github.com/code-yeongyu/oh-my-opencode
  - oh-my-opencode creates `oh-my-opencode.json` in `~/.config/opencode/` to store agent configs. We can learn from this.
- https://opencode.ai/docs/plugins/
- https://opencode.ai/docs/agents/
- https://opencode.ai/docs/sdk/
- https://github.com/zenobi-us/opencode-plugin-template
  - opencode-plugin-template is a template repository for creating OpenCode plugins. We can learn from this.
