# OpenCode Design Lab - Technical Design Document

## Overview

This document provides the technical design for the OpenCode Design Lab plugin, which generates multiple independent design proposals using different AI models and systematically evaluates, compares, and ranks those designs.

## Architecture

### High-Level Flow

```
User Command
    ↓
Setup Phase
    ↓
Design Generation Phase (isolated agents)
    ↓
Review Phase (independent reviewers)
    ↓
Score Aggregation Phase
    ↓
Output Generation
```

### Core Components

1. **Plugin Controller** (`src/index.ts`)
   - Main orchestration logic
   - Coordinates all phases
   - Manages state and transitions

2. **Configuration System** (`src/config/`)
   - Schema validation with Zod
   - Multi-level config merging (user + project)
   - Model selection logic

3. **Agent System** (`src/agents/`)
   - Design generation agents
   - Review agents
   - Score aggregation agents

4. **Hook System** (`src/hooks/`)
   - Context isolation enforcement
   - File access control during design phase

5. **Schema System** (`src/schemas/`)
   - Design artifact schema
   - Review schema
   - Score schema

6. **File System** (`src/fs/`)
   - Directory creation and management
   - File I/O operations
   - Artifact storage

## Directory Structure

```
.opencode/
├── design-lab/                    # Base directory
│   ├── {date}-{topic}/           # Per-experiment directory
│   │   ├── task.json             # Original task input
│   │   ├── designs/              # Generated designs
│   │   │   ├── design-{model-x}.json
│   │   │   ├── design-{model-y}.json
│   │   │   └── design-{model-z}.json
│   │   ├── reviews/              # Reviews of designs
│   │   │   ├── review-{design-id}-{model-a}.json
│   │   │   └── review-{design-id}-{model-b}.json
│   │   ├── scores/               # Numeric scores
│   │   │   ├── score-{design-id}-{model-a}.json
│   │   │   └── score-{design-id}-{model-b}.json
│   │   └── results/              # Final rankings
│   │       └── ranking.json
├── plugins/
│   └── index.js                  # Main plugin entry
└── config/
    └── design-lab.json           # Project config
```

## Configuration System

### Config File Locations

Following oh-my-opencode pattern:

- **User-level**: `~/.config/opencode/design-lab.json`
- **Project-level**: `.opencode/design-lab.json`

### Configuration Schema

```typescript
interface DesignLabConfig {
  $schema?: string;

  // Model configuration
  design_models: string[]; // Models for design generation
  review_models?: string[]; // Models for review (optional)
  topic_generation_model?: string; // Model for topic generation

  // Design generation settings
  design: {
    agent_prompt?: string; // Override design prompt template
    temperature?: number; // 0-2
    top_p?: number; // 0-1
    max_tokens?: number;
  };

  // Review settings
  review: {
    qualitative?: {
      enabled: boolean;
      models?: string[]; // Override for qualitative review
    };
    quantitative?: {
      enabled: boolean;
      models?: string[]; // Override for quantitative review
      criteria: ScoringCriteria[];
    };
  };

  // Hook settings
  hooks: {
    design_isolation: {
      enabled: boolean;
      strict_mode?: boolean; // If true, any read attempt triggers error
    };
  };

  // Output settings
  output: {
    base_dir?: string; // Default: .design-lab
    format?: "json" | "jsonc";
  };
}

interface ScoringCriteria {
  name: string;
  description: string;
  min: number;
  max: number;
  weight?: number; // For weighted averages
}
```

### Default Scoring Criteria

If not specified in config:

```typescript
const DEFAULT_SCORING_CRITERIA = [
  {
    name: "clarity",
    description: "How clear and understandable is the design?",
    min: 0,
    max: 10,
    weight: 1.0,
  },
  {
    name: "feasibility",
    description: "How technically feasible is the design?",
    min: 0,
    max: 10,
    weight: 1.2,
  },
  {
    name: "scalability",
    description: "How well does the design scale?",
    min: 0,
    max: 10,
    weight: 1.0,
  },
  {
    name: "maintainability",
    description: "How maintainable is the design?",
    min: 0,
    max: 10,
    weight: 1.0,
  },
  {
    name: "innovation",
    description: "How innovative is the approach?",
    min: 0,
    max: 10,
    weight: 0.8,
  },
];
```

### Model Selection Logic

```typescript
function resolveReviewModels(config: DesignLabConfig): string[] {
  // If review_models explicitly set, use it
  if (config.review_models && config.review_models.length > 0) {
    return config.review_models;
  }

  // If review.qualitative.models or review.quantitative.models set, use those
  if (config.review?.qualitative?.models) {
    return config.review.qualitative.models;
  }
  if (config.review?.quantitative?.models) {
    return config.review.quantitative.models;
  }

  // Default: use all design models
  return config.design_models;
}
```

## Schema Definitions

### Design Artifact Schema

```typescript
interface DesignArtifact {
  title: string;
  summary: string;
  assumptions: string[];
  architecture_overview: string;
  components: Component[];
  data_flow: string;
  tradeoffs: Tradeoff[];
  risks: Risk[];
  open_questions: string[];
  additional_notes?: string;
}

interface Component {
  name: string;
  description: string;
  responsibilities: string[];
  interfaces?: string[];
}

interface Tradeoff {
  aspect: string;
  choice: string;
  rationale: string;
  alternatives: string[];
}

interface Risk {
  description: string;
  severity: "low" | "medium" | "high";
  mitigation?: string;
}
```

### Qualitative Review Schema

```typescript
interface QualitativeReview {
  design_id: string;
  reviewer_model: string;
  strengths: string[];
  weaknesses: string[];
  missing_considerations: string[];
  risk_assessment: "low" | "medium" | "high";
  overall_impression: string;
  suggested_improvements: string[];
}
```

### Quantitative Score Schema

```typescript
interface QuantitativeScore {
  design_id: string;
  scorer_model: string;
  scores: Record<string, number>;
  overall_score: number;
  justification: string;
}
```

### Final Ranking Schema

```typescript
interface RankingResult {
  experiment_id: string;
  topic: string;
  timestamp: string;
  designs: RankedDesign[];
  summary: {
    total_designs: number;
    total_reviewers: number;
    average_variance: number;
    consensus: "high" | "medium" | "low";
  };
}

interface RankedDesign {
  design_id: string;
  generating_model: string;
  rank: number;
  average_score: number;
  score_breakdown: Record<
    string,
    {
      average: number;
      min: number;
      max: number;
      variance: number;
    }
  >;
  qualitative_summary: {
    total_strengths: number;
    total_weaknesses: number;
    common_strengths: string[];
    common_weaknesses: string[];
  };
}
```

## Agent System

### Agent Types

1. **Topic Generation Agent**
   - Input: Raw requirements
   - Output: Concise topic string
   - Model: `topic_generation_model` (default: first design model)

2. **Design Generation Agents**
   - Run in parallel (one per model in `design_models`)
   - Isolated context (via hooks)
   - Output: Design artifact JSON

3. **Qualitative Review Agents**
   - Run in parallel (one per model in `review_models`)
   - See all designs (after design phase)
   - Don't see which model generated which design
   - Output: Qualitative review JSON

4. **Quantitative Scoring Agents**
   - Run in parallel (one per model in `review_models`)
   - See all designs (after design phase)
   - Don't see other scores
   - Output: Score JSON

### Agent Implementation Pattern

Following oh-my-opencode pattern:

```typescript
// src/agents/design-agent.ts
import type { ToolContext } from "@opencode-ai/plugin";
import { loadConfig } from "../config";

export async function createDesignAgent(
  ctx: ToolContext,
  model: string,
  config: DesignLabConfig,
) {
  return {
    model,
    prompt: config.design.agent_prompt || DEFAULT_DESIGN_PROMPT,
    temperature: config.design.temperature ?? 0.7,
    top_p: config.design.top_p ?? 0.9,
    max_tokens: config.design.max_tokens ?? 4000,
    tools: {
      // Only read/write tools, no network/external access
      read: true,
      write: true,
      bash: false,
      webfetch: false,
      task: false, // No subagent delegation
    },
  };
}
```

### Prompt Templates

#### Design Generation Prompt Template

```
You are an expert system architect. Generate a comprehensive design proposal for the following task.

TASK:
{{task_description}}

REQUIREMENTS:
{{requirements}}

CONSTRAINTS:
{{constraints}}

NON-FUNCTIONAL REQUIREMENTS:
{{non_functional_requirements}}

Generate a design following this schema:
{{design_schema}}

Your response must be valid JSON only, with no additional text or explanation.
```

#### Qualitative Review Prompt Template

```
You are an expert system architecture reviewer. Review the following design proposal.

DESIGN:
{{design_content}}

Provide a qualitative assessment following this schema:
{{qualitative_review_schema}}

Be objective and thorough. Identify both strengths and weaknesses.
Your response must be valid JSON only, with no additional text or explanation.
```

#### Quantitative Scoring Prompt Template

```
You are an expert system architecture evaluator. Score the following design proposal.

DESIGN:
{{design_content}}

SCORING CRITERIA:
{{scoring_criteria}}

Assign numeric scores for each criterion following this schema:
{{quantitative_score_schema}}

Be fair and consistent in your scoring.
Your response must be valid JSON only, with no additional text or explanation.
```

## Hook System

### Design Isolation Hook

```typescript
// src/hooks/design-isolation.ts
import type { HookContext } from "@opencode-ai/plugin";

export function createDesignIsolationHook(baseDir: string) {
  const designsDir = path.join(baseDir, "designs");

  return {
    name: "design-isolation",

    "tool.execute.before": async (input: { tool: string }, output: any) => {
      if (input.tool === "read") {
        const filePath = output.args?.path as string;

        if (filePath && filePath.startsWith(designsDir)) {
          throw new Error(
            "Design isolation violation: Cannot read other designs during design generation phase. " +
              "Each agent must work independently.",
          );
        }
      }
    },
  };
}
```

### Hook Phases

1. **Setup Phase**: No hooks active
2. **Design Phase**: `design-isolation` hook active
3. **Review Phase**: No hooks (reviewers need to see designs)
4. **Aggregation Phase**: No hooks

## Plugin Entry Point

```typescript
// src/index.ts
import type { Plugin } from "@opencode-ai/plugin";
import { loadConfig } from "./config";
import { runDesignLab } from "./orchestrator";
import { designLabCommand } from "./commands";

export default async function designLabPlugin(ctx) {
  const config = loadConfig(ctx.directory);

  return {
    tool: {
      design_lab: designLabCommand(ctx, config),
    },

    config: async (input: any, output: any) => {
      // Handle config changes
    },

    event: async (input: any) => {
      // Handle events
    },
  };
}
```

## Command Interface

### Main Command: `/design-lab`

```
/design-lab "Design a distributed task queue system with the following requirements..."
```

### Interactive Mode

```
/design-lab
> Enter task description: ...
> Enter constraints (optional): ...
> Enter non-functional requirements (optional): ...
```

### Command Options

```
/design-lab [options] "task description"

Options:
  --design-models <models>    Override design models (comma-separated)
  --review-models <models>   Override review models (comma-separated)
  --topic <topic>             Override auto-generated topic
  --output-dir <dir>          Custom output directory
  --no-qualitative           Skip qualitative review
  --no-quantitative          Skip quantitative review
  --strict-isolation          Enable strict design isolation mode
```

## Error Handling

### Retry Logic

```typescript
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // ms

async function withRetry<T>(fn: () => Promise<T>, context: string): Promise<T> {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === MAX_RETRIES - 1) throw err;
      log(`Retry ${i + 1}/${MAX_RETRIES} for ${context}`, { error: err });
      await sleep(RETRY_DELAY * (i + 1));
    }
  }
  throw new Error("Max retries exceeded");
}
```

### Validation

- Schema validation before saving any artifact
- JSON parsing with detailed error messages
- Required field validation
- Type checking

## Implementation Phases

### Phase 1: Core Infrastructure

- Configuration system (schema, loading, merging)
- File system utilities
- Schema definitions
- Basic plugin structure

### Phase 2: Design Generation

- Topic generation
- Design agent orchestration
- Design isolation hooks
- Parallel agent execution

### Phase 3: Review System

- Qualitative review agents
- Quantitative scoring agents
- Prompt templates
- Review orchestration

### Phase 4: Aggregation & Output

- Score aggregation logic
- Ranking algorithm
- Final report generation
- Summary statistics

### Phase 5: Polish

- Error handling & retries
- Progress notifications
- Command interface refinements
- Documentation

## Testing Strategy

### Unit Tests

- Schema validation
- Configuration merging
- Score aggregation logic
- File system operations

### Integration Tests

- Full workflow execution
- Hook behavior
- Agent orchestration
- Error recovery

### E2E Tests

- Sample design tasks
- Multiple model combinations
- Edge cases (empty responses, invalid JSON)

## Performance Considerations

- Parallel agent execution for speed
- Efficient file I/O (batch writes where possible)
- Memory-efficient JSON parsing (stream for large artifacts)
- Caching of model responses (optional)

## Security Considerations

- No external network access during design phase
- Strict file access control via hooks
- No code execution capabilities
- Validate all inputs against schemas
- Sanitize file paths

## Future Extensions (Out of Scope for v1)

- Iterative refinement loops
- Human-in-the-loop evaluation
- Visual comparison dashboards
- Design merging assistance
- Historical trend analysis
- Custom agent types (security reviewer, performance specialist, etc.)
