# OpenCode Design Lab

An OpenCode plugin that enables multi-model design generation, systematic evaluation, and ranking of AI-generated design proposals.

## Features

- **Multi-model design generation**: Generate multiple independent design proposals using different AI models
- **Systematic evaluation**: Qualitative reviews and quantitative scoring across multiple dimensions
- **Design isolation**: Prevent cross-contamination between different design proposals
- **Ranking and comparison**: Aggregate scores from multiple models to rank designs objectively
- **Model-agnostic**: Works with any AI model supported by OpenCode

## Installation

Add the plugin to your OpenCode project:

```bash
npm install opencode-design-lab
```

Or if developing locally:

```bash
npm link
```

## Configuration

Create a `.opencode/design-lab.json` file in your project root:

```jsonc
{
  "plugins": ["opencode-design-lab"],
  "design_models": ["gpt-4", "claude-3-5-sonnet-20241022", "gemini-1.5-pro"],
  "review_models": ["gpt-4", "claude-3-5-sonnet-20241022"],
  "topic_generation_model": "gpt-4",
  "design": {
    "temperature": 0.7,
    "max_tokens": 2000
  },
  "review": {
    "qualitative": {
      "aspects": ["architecture", "security", "scalability", "maintainability"]
    },
    "quantitative": {
      "criteria": [
        {
          "name": "code_quality",
          "description": "Overall code quality and structure",
          "min": 1,
          "max": 10,
          "weight": 1.0
        },
        {
          "name": "performance",
          "description": "Expected performance characteristics",
          "min": 1,
          "max": 10,
          "weight": 1.0
        },
        {
          "name": "maintainability",
          "description": "Ease of maintenance and extension",
          "min": 1,
          "max": 10,
          "weight": 1.0
        }
      ]
    }
  },
  "hooks": {
    "design_isolation": {
      "enabled": true,
      "allowed_reads": ["requirements/", "constraints/", "docs/"]
    }
  },
  "output": {
    "base_dir": ".design-lab",
    "format": "json"
  }
}
```

### Configuration Options

- `design_models`: Array of models to use for generating design proposals (required)
- `review_models`: Array of models to use for reviewing and scoring (optional, defaults to design_models)
- `topic_generation_model`: Model to use for generating design topics (optional)
- `design`: Generation settings (temperature, max_tokens, etc.)
- `review.qualitative.aspects`: Aspects to evaluate in qualitative reviews
- `review.quantitative.criteria`: Scoring criteria with weights
- `hooks.design_isolation`: Isolation settings to prevent cross-design contamination
- `output.base_dir`: Output directory for generated artifacts

## Usage

The plugin provides the following tools:

### Generate Designs

Generate multiple independent design proposals:

```typescript
await ctx.client.callTool({
  name: "generate_designs",
  input: {
    task: "Design a REST API for a task management system",
    requirements: "Support CRUD operations for tasks, projects, and users",
    constraints: "Must use TypeScript, Express, and PostgreSQL",
    non_functional_requirements: "Should handle 1000+ requests per second",
    num_designs: 3,
    models: ["gpt-4", "claude-3-5-sonnet-20241022"],
  },
});
```

### Review Designs

Review and evaluate generated designs:

```typescript
await ctx.client.callTool({
  name: "review_designs",
  input: {
    design_ids: ["design-1", "design-2"],
    review_models: ["gpt-4"],
  },
});
```

### Score Designs

Score designs against defined criteria:

```typescript
await ctx.client.callTool({
  name: "score_designs",
  input: {
    design_ids: ["design-1", "design-2"],
    criteria: [
      {
        name: "code_quality",
        description: "Overall code quality",
        min: 1,
        max: 10,
        weight: 1.0,
      },
    ],
  },
});
```

### Rank Designs

Rank designs based on aggregated scores:

```typescript
await ctx.client.callTool({
  name: "rank_designs",
  input: {},
});
```

## Output Structure

Generated artifacts are saved to the configured output directory (default: `.design-lab/`):

```
.design-lab/
├── designs/
│   ├── design-1.json
│   ├── design-2.json
│   └── design-3.json
└── reviews/
    ├── design-1_gpt-4_review.json
    ├── design-1_gpt-4_score.json
    ├── design-2_gpt-4_review.json
    └── design-2_gpt-4_score.json
```

### Design Artifact Structure

```typescript
{
  "id": "design-1",
  "model": "gpt-4",
  "task": "Design a REST API for a task management system",
  "summary": "A modular REST API architecture...",
  "architecture": "Detailed architecture description...",
  "key_decisions": [
    "Decision 1",
    "Decision 2"
  ],
  "components": [
    {
      "name": "UserController",
      "description": "Handles user-related operations"
    }
  ],
  "tradeoffs": [
    {
      "decision": "Using PostgreSQL",
      "reasoning": "Strong data integrity requirements",
      "alternatives": ["MongoDB", "MySQL"]
    }
  ],
  "created_at": "2024-01-15T10:30:00Z"
}
```

### Review Artifact Structure

```typescript
{
  "design_id": "design-1",
  "model": "gpt-4",
  "aspects": {
    "architecture": {
      "score": 8,
      "feedback": "Well-structured architecture..."
    },
    "security": {
      "score": 7,
      "feedback": "Good security practices..."
    }
  },
  "overall_assessment": "Strong design with room for improvement...",
  "strengths": ["Strength 1", "Strength 2"],
  "weaknesses": ["Weakness 1"],
  "recommendations": ["Recommendation 1"]
}
```

## Design Isolation

The plugin implements design isolation to prevent cross-contamination between different design proposals:

- During design generation, agents cannot read from other design directories
- Write operations are restricted to the current design's directory
- Configurable allow-list for safe read paths (requirements, docs, etc.)

This ensures each design is generated independently without being influenced by other proposals.

## Workflow Example

```typescript
// 1. Generate multiple designs
await ctx.client.callTool({
  name: "generate_designs",
  input: {
    task: "Design a microservices architecture for an e-commerce platform",
    requirements: "Support product catalog, cart, checkout, and payment",
    num_designs: 3,
  },
});

// 2. Review all generated designs
await ctx.client.callTool({
  name: "review_designs",
  input: {},
});

// 3. Score designs against criteria
await ctx.client.callTool({
  name: "score_designs",
  input: {},
});

// 4. Rank designs
const result = await ctx.client.callTool({
  name: "rank_designs",
  input: {},
});

console.log(result.ranked_designs);
// Output: Designs ranked by aggregated score
```

## Development

### Build

```bash
npm run build
```

### Type Check

```bash
npm run typecheck
```

### Lint

```bash
npm run lint
```

## Architecture

The plugin is organized into the following modules:

- **src/config**: Configuration loading and validation using Zod schemas
- **src/agents**: Agent invocation for design generation, review, and scoring
- **src/orchestrator**: Parallel execution and coordination of multiple agents
- **src/reviews**: Review aggregation and management
- **src/hooks**: Design isolation enforcement
- **src/prompts**: Prompt templates with structured output requirements

See [DESIGN.md](./DESIGN.md) for detailed architectural documentation.

## License

MIT
