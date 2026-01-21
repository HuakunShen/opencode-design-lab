# OpenCode Design Lab

An OpenCode plugin that generates multiple independent design proposals using different AI models, then systematically evaluates, compares, and ranks those designs in a reproducible and structured way.

## Overview

OpenCode Design Lab treats design as an experimental artifact, not a chat response. It enforces:

- **Isolation**: Each design agent works independently without seeing other designs
- **Structure**: All outputs follow predefined JSON schemas
- **Evaluation**: Multiple reviewers score designs across consistent dimensions
- **Reproducibility**: Given the same inputs and config, results are reproducible

## Installation

### From npm (Future)

```bash
npm install opencode-design-lab
```

### From Source

```bash
git clone https://github.com/HuakunShen/opencode-design-lab.git
cd opencode-design-lab
bun install
bun run build
```

Then add to your OpenCode config (`~/.config/opencode/opencode.json`):

```json
{
  "plugin": ["opencode-design-lab"]
}
```

## Configuration

Create a config file at `~/.config/opencode/design-lab.json` or `.opencode/design-lab.json`:

```json
{
  "design_models": ["claude-sonnet-4", "gpt-4o", "gemini-3-pro"],
  "review_models": ["claude-opus-4", "gpt-5-2"],
  "base_output_dir": ".design-lab",
  "design_agent_temperature": 0.7,
  "review_agent_temperature": 0.1
}
```

### Configuration Options

| Option                     | Type       | Default            | Description                                                               |
| -------------------------- | ---------- | ------------------ | ------------------------------------------------------------------------- |
| `design_models`            | `string[]` | **Required**       | Models to use for design generation (min 2)                               |
| `review_models`            | `string[]` | `design_models`    | Models to use for reviews. Defaults to all design models if not specified |
| `base_output_dir`          | `string`   | `.design-lab`      | Base directory for design lab outputs                                     |
| `design_agent_temperature` | `number`   | `0.7`              | Temperature for design agents (0-2)                                       |
| `review_agent_temperature` | `number`   | `0.1`              | Temperature for review agents (0-2)                                       |
| `topic_generator_model`    | `string`   | First design model | Model to use for generating topic names                                   |

## Usage

### 1. Generate Designs

```
Use the generate_designs tool with requirements:
"Design a real-time collaborative document editor with conflict resolution,
supporting rich text editing, multiple cursors, and offline mode."
```

This will:

- Create a directory `.design-lab/YYYY-MM-DD-{topic}/`
- Generate independent designs from each configured model
- Save designs as JSON in `designs/` directory
- Validate all designs against the schema

**Output:**

```
Design generation complete.

Lab Directory: .design-lab/2026-01-22-collaborative-editor/

Results: 3 successful, 0 failed

✅ claude-sonnet-4: Generated successfully
✅ gpt-4o: Generated successfully
✅ gemini-3-pro: Generated successfully

Next step: Run the review_designs tool to evaluate and compare the designs.
```

### 2. Review Designs

```
Use the review_designs tool
```

This will:

- Load all generated designs
- Send them to each review model
- Generate markdown reviews comparing all designs
- Extract structured scores (0-10) across dimensions:
  - Clarity
  - Feasibility
  - Scalability
  - Maintainability
  - Completeness
  - Overall

**Output:**

```
Review complete.

Lab Directory: .design-lab/2026-01-22-collaborative-editor/

Results: 2 successful, 0 failed

✅ claude-opus-4: Review generated
✅ gpt-5-2: Review generated

Reviews saved to: .design-lab/2026-01-22-collaborative-editor/reviews/
Scores saved to: .design-lab/2026-01-22-collaborative-editor/scores/

Next step: Run the aggregate_scores tool to generate final rankings.
```

### 3. Aggregate Scores

```
Use the aggregate_scores tool
```

This will:

- Parse all score files
- Calculate average scores per design
- Compute variance/disagreement metrics
- Generate final rankings
- Create `results.md` with comparative analysis

**Output:**

```
Aggregation complete.

Rankings saved to: .design-lab/2026-01-22-collaborative-editor/results/ranking.json
Results summary saved to: .design-lab/2026-01-22-collaborative-editor/results/results.md

Final Rankings

1. **gpt-4o** - Score: 8.4/10 (variance: 0.32)
2. **claude-sonnet-4** - Score: 8.1/10 (variance: 0.28)
3. **gemini-3-pro** - Score: 7.8/10 (variance: 0.45)
```

## Output Structure

Each design lab session creates a timestamped directory:

```
.design-lab/YYYY-MM-DD-{topic}/
├── task.json                 # Original requirements and config
├── designs/                  # Generated designs
│   ├── claude-sonnet-4.json
│   ├── gpt-4o.json
│   └── gemini-3-pro.json
├── reviews/                  # Markdown reviews
│   ├── review-claude-opus-4.md
│   └── review-gpt-5-2.md
├── scores/                   # Structured scores
│   ├── claude-sonnet-4-by-claude-opus-4.json
│   ├── claude-sonnet-4-by-gpt-5-2.json
│   ├── gpt-4o-by-claude-opus-4.json
│   └── ...
└── results/                  # Final aggregation
    ├── ranking.json          # Numeric rankings
    └── results.md            # Human-readable summary
```

## Design Artifact Schema

Each design must conform to this structure:

```typescript
{
  title: string;
  summary: string;
  assumptions: string[];
  architecture_overview: string;
  components: Array<{
    name: string;
    description: string;
    responsibilities: string[];
  }>;
  data_flow: string;
  tradeoffs: Array<{
    aspect: string;
    options: string[];
    chosen: string;
    rationale: string;
  }>;
  risks: Array<{
    risk: string;
    impact: "low" | "medium" | "high";
    mitigation: string;
  }>;
  open_questions: string[];
}
```

## Score Schema

Reviewers produce scores following this structure:

```typescript
{
  design_id: string;
  reviewer_model: string;
  scores: {
    clarity: number;         // 0-10
    feasibility: number;     // 0-10
    scalability: number;     // 0-10
    maintainability: number; // 0-10
    completeness: number;    // 0-10
    overall: number;         // 0-10
  };
  justification: string;
  strengths: string[];
  weaknesses: string[];
  missing_considerations: string[];
}
```

## How It Works

### Multi-Agent Architecture

Based on patterns from [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode), each agent runs in its own OpenCode session:

1. **Create Session**: `ctx.client.session.create({ ... })`
2. **Send Prompt**: `ctx.client.session.prompt({ agent: model, ... })`
3. **Poll Completion**: Check `session.status()` until idle
4. **Extract Output**: Parse `session.messages()` for JSON

### Sequential Execution

Design Lab v1 runs agents **sequentially** (one after another) rather than in parallel. This:

- Simplifies implementation
- Avoids overwhelming the session manager
- Still provides multiple independent perspectives

### Schema Validation

All outputs are validated using Zod schemas:

- Design artifacts validated before saving
- Scores validated during review
- JSON schemas auto-generated via `z.toJSONSchema()` (Zod v4)

## Development

### Build

```bash
bun run build
```

Output: `.opencode/plugins/design-lab.js`

### Generate JSON Schemas

```bash
bun src/utils/schema-export.ts
```

Output: `schemas/*.schema.json`

### Project Structure

```
src/
├── design-lab.ts           # Plugin entry point
├── agents/
│   └── index.ts            # Agent factory functions
├── config/
│   ├── schema.ts           # Zod schemas
│   ├── loader.ts           # Config loading
│   └── index.ts
├── tools/
│   ├── generate-designs.ts # Design generation orchestrator
│   ├── review-designs.ts   # Review orchestrator
│   ├── aggregate-scores.ts # Score aggregation
│   └── index.ts
└── utils/
    ├── session-helpers.ts  # OpenCode session utilities
    └── schema-export.ts    # Schema generator
```

## Examples

### Example: API Gateway Design

```
Use generate_designs with requirements:
"Design a high-performance API gateway for microservices.
Must support:
- Rate limiting and throttling
- Authentication and authorization
- Request/response transformation
- Service discovery
- Circuit breaking
- Monitoring and observability
Target: 100,000+ requests/second
Constraints: Cloud-native, Kubernetes deployment"
```

### Example: Deepwiki Clone

```
Use generate_designs with requirements:
"Design a DeepWiki clone - a service that indexes GitHub repositories
and provides AI-powered search and Q&A over the codebase.
Must support:
- Repository indexing and updates
- Vector search over code
- Multi-language support
- Usage tracking and analytics
- API rate limiting
Constraints: Open source, self-hostable"
```

## Design Philosophy

> The goal is not simply to pick the "best" design, but to extract the best practices and insights from each model's design, then merge them into a superior composite design. Each model contributes unique strengths that can be combined to create a more robust solution.

- **Multiple Perspectives**: Different models bring different strengths
- **Structured Comparison**: Objective scoring across consistent dimensions
- **Reproducible Process**: Same inputs → same structure (within model variance)
- **Design as Artifact**: Not a conversation, but a versioned document

## Roadmap (Future)

- [ ] Background execution with progress notifications
- [ ] Iterative refinement loops
- [ ] Pairwise ranking (Elo-style)
- [ ] Human-in-the-loop scoring
- [ ] Design isolation hook (prevent agents reading other designs)
- [ ] Visualization dashboard
- [ ] Design merging/synthesis tool

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT

## References

- [OpenCode](https://github.com/sst/opencode) - The extensible AI coding assistant
- [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) - Multi-agent patterns
- [PRD.md](PRD.md) - Full requirements specification
