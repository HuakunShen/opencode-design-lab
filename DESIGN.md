# OpenCode Design Lab - Design Document

**Version**: 1.0
**Date**: 2026-01-20
**Status**: Draft

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Plugin Structure](#2-plugin-structure)
3. [Configuration Schema](#3-configuration-schema)
4. [Agent System](#4-agent-system)
5. [Workflow Phases](#5-workflow-phases)
6. [Hook System](#6-hook-system)
7. [File Structure](#7-file-structure)
8. [Implementation Details](#8-implementation-details)
9. [Technical Decisions](#9-technical-decisions)
10. [Future Extensions](#10-future-extensions)

---

## 1. Architecture Overview

### 1.1 High-Level Design

OpenCode Design Lab is an OpenCode plugin that orchestrates multi-agent design generation and evaluation workflows. The plugin serves as the central controller, managing the lifecycle from task initialization through design generation, review, and score aggregation.

```
┌─────────────────────────────────────────────────────────────┐
│            OpenCode Design Lab Plugin                       │
│                    (Controller)                           │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Plugin Entry Point                                 │  │
│  │  - Load config                                     │  │
│  │  - Register hooks                                   │  │
│  │  - Provide slash command: /design-lab               │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Workflow Orchestrator                              │  │
│  │  - Manage phase transitions                         │  │
│  │  - Invoke agents with model overrides               │  │
│  │  - Enforce isolation via hooks                     │  │
│  │  - Aggregate scores                                │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
            ▼              ▼              ▼
    ┌───────────┐  ┌───────────┐  ┌───────────┐
    │   Setup   │  │  Design   │  │  Review   │
    │   Phase   │  │   Phase   │  │   Phase   │
    └───────────┘  └───────────┘  └───────────┘
                                     │
                                     ▼
                              ┌──────────────┐
                              │ Aggregation  │
                              │   Phase     │
                              └──────────────┘
```

### 1.2 Core Principles

1. **Plugin-First Architecture**: The plugin orchestrates everything. Agents are pure generators/evaluators.
2. **Runtime Config Merging**: Model configurations are read from config and merged with predefined agent configs at runtime.
3. **No Dynamic Agent Generation**: Agent files are not generated. Config overrides are applied via plugin hooks.
4. **Hook-Based Isolation**: File read interception ensures design agents cannot see each other's outputs.
5. **Schema Enforcement**: All outputs are validated against JSON schemas.

---

## 2. Plugin Structure

### 2.1 Plugin Entry Point

**File**: `src/index.ts`

```typescript
import type { Plugin } from "@opencode-ai/plugin";

export const DesignLabPlugin: Plugin = async ({ client, $, project, directory }) => {
  // Load configuration
  const config = await loadConfig();

  return {
    // Register slash command
    command: {
      design_lab: async ({ input }) => {
        return await handleDesignLabCommand(input, config, client);
      }
    },

    // Register hooks for isolation
    tool: {
      execute: {
        before: async ({ input }) => {
          return await enforceIsolation(input, config);
        }
      }
    },

    // Session hooks for workflow state management
    session: {
      init: async () => {
        await initializeWorkflowState();
      }
    }
  };
};
```

### 2.2 Key Components

| Component | Responsibility |
|-----------|---------------|
| `ConfigLoader` | Load and validate configuration from `~/.config/opencode/design-lab.json` |
| `WorkflowOrchestrator` | Manage phase transitions and agent invocations |
| `AgentInvoker` | Invoke agents with runtime model overrides |
| `IsolationEnforcer` | Hook implementation to enforce context isolation |
| `SchemaValidator` | Validate design and review outputs against schemas |
| `ScoreAggregator` | Parse review files and compute aggregated scores |
| `FileManager` | Create directories and manage artifact files |

---

## 3. Configuration Schema

### 3.1 Configuration File Location

**Default**: `~/.config/opencode/design-lab.json`

**Alternative**: `.opencode/design-lab.json` (project-level, takes precedence)

### 3.2 Complete Schema

```json
{
  "$schema": "https://raw.githubusercontent.com/yourorg/opencode-design-lab/main/assets/design-lab.schema.json",

  "design_models": [
    {
      "id": "model-1",
      "name": "Claude Opus 4.5",
      "model_id": "anthropic/claude-opus-4-20241022",
      "temperature": 0.7,
      "prompt_template": "You are a system designer. Create a comprehensive design..."
    },
    {
      "id": "model-2",
      "name": "GPT-5.1 Codex",
      "model_id": "openai/gpt-5.1-codex",
      "temperature": 0.6,
      "prompt_template": "You are an architecture expert. Design a solution..."
    }
  ],

  "review_models": [
    {
      "id": "reviewer-1",
      "name": "GPT-5.2",
      "model_id": "openai/gpt-5.2",
      "temperature": 0.3,
      "evaluation_criteria": {
        "qualitative": true,
        "quantitative": true
      }
    }
  ],

  "output_directory": ".design-lab",

  "scoring_criteria": {
    "dimensions": [
      {
        "name": "clarity",
        "description": "How clear and understandable is the design?",
        "min": 0,
        "max": 10
      },
      {
        "name": "feasibility",
        "description": "How feasible is this design to implement?",
        "min": 0,
        "max": 10
      },
      {
        "name": "scalability",
        "description": "How well does this design scale?",
        "min": 0,
        "max": 10
      },
      {
        "name": "maintainability",
        "description": "How easy is this to maintain?",
        "min": 0,
        "max": 10
      }
    ],
    "require_justification": true
  },

  "isolation": {
    "enforce_design_isolation": true,
    "blocked_patterns": [".design-lab/*/designs/"]
  }
}
```

### 3.3 Config Merging Strategy

1. **Load Order** (priority high to low):
   - Project config (`.opencode/design-lab.json`)
   - Global config (`~/.config/opencode/design-lab.json`)
   - Default config (embedded in plugin)

2. **Deep Merge**: Nested objects are merged recursively. Later configs override earlier ones.

3. **Validation**: Config is validated against JSON schema before use.

### 3.4 Review Models Default Behavior

```typescript
function resolveReviewModels(config: Config): ModelConfig[] {
  if (config.review_models && config.review_models.length > 0) {
    // Explicitly specified review models
    return config.review_models;
  }

  // Default: all design models review all designs
  return config.design_models;
}
```

---

## 4. Agent System

### 4.1 Agent Definition Strategy

**Key Decision**: We do NOT generate agent files dynamically. Instead, we use OpenCode's built-in agent configuration system with runtime overrides.

### 4.2 Two Approaches

#### Approach A: Config-Based Agent Registration (Recommended)

Agents are defined in plugin config and registered with OpenCode's agent system:

```typescript
// src/agents/registration.ts
import type { Agent } from "@opencode-ai/plugin";

export function registerDesignLabAgents(config: Config) {
  const agents: Record<string, Agent.Info> = {};

  // Register design agents
  for (const model of config.design_models) {
    agents[`design-lab-design-${model.id}`] = {
      description: `Design agent using ${model.name}`,
      mode: "subagent",
      model: model.model_id,
      temperature: model.temperature,
      prompt: model.prompt_template,
      tools: {
        read: true,
        write: false,
        edit: false
      }
    };
  }

  // Register review agents
  for (const model of resolveReviewModels(config)) {
    agents[`design-lab-review-${model.id}`] = {
      description: `Review agent using ${model.name}`,
      mode: "subagent",
      model: model.model_id,
      temperature: model.temperature,
      tools: {
        read: true,
        write: false,
        edit: false
      }
    };
  }

  return agents;
}
```

#### Approach B: Runtime Model Override via SDK

Use the SDK to invoke agents with explicit model specification:

```typescript
// src/agents/invoker.ts
import { createOpencodeClient } from "@opencode-ai/sdk";

export async function invokeDesignAgent(
  modelConfig: ModelConfig,
  task: DesignTask,
  client: OpencodeClient
): Promise<DesignOutput> {
  const result = await client.messages.create({
    model: modelConfig.model_id,
    temperature: modelConfig.temperature,
    system: modelConfig.prompt_template,
    messages: [
      {
        role: "user",
        content: `Design a solution for: ${JSON.stringify(task)}`
      }
    ]
  });

  return JSON.parse(result.content);
}
```

**Recommendation**: Use Approach A (Config-Based Registration) as it:
- Integrates better with OpenCode's agent system
- Allows users to see and manage agents in the UI
- Simpler implementation
- Consistent with oh-my-opencode's approach

### 4.3 Agent Naming Convention

```
design-lab-design-{model-id}  # Design generation agents
design-lab-review-{model-id}  # Review agents
```

Examples:
- `design-lab-design-claude-opus-4-5`
- `design-lab-review-gpt-5-2`

### 4.4 Agent Invocation Flow

```
Plugin reads config
    │
    ▼
Register agents with model overrides
    │
    ▼
User invokes /design-lab
    │
    ▼
Workflow Orchestrator:
  1. Setup Phase
     - Generate topic from requirements
     - Create directory structure
  2. Design Phase
     - For each design model:
       - Invoke design agent
       - Save output to designs/
  3. Review Phase
     - For each review model:
       - Invoke review agent with all designs
       - Save output to reviews/
  4. Aggregation Phase
     - Parse all review files
     - Compute scores and rankings
     - Save to results/
```

---

## 5. Workflow Phases

### 5.1 Phase 0: Initialization

**Trigger**: `/design-lab` slash command

**Actions**:
1. Parse input (task description, constraints, non-functional requirements)
2. Validate configuration
3. Generate topic from requirements using AI
4. Create output directory: `{output_dir}/YYYY-MM-DD-{topic}/`

**Output**:
```
.design-lab/2026-01-20-user-auth-system/
├── task.json              # Original task
├── designs/              # Design outputs
├── reviews/              # Review outputs
└── results/              # Aggregated scores
```

### 5.2 Phase 1: Design Generation

**Actions**:
1. For each model in `design_models`:
   - Invoke design agent in isolated context
   - Agent generates design artifact
   - Validate output against schema
   - Save to `designs/design-{model-id}.json`

**Isolation Enforcement**:
- Hook: `tool.execute.before`
- Intercept `read` operations
- Block attempts to read files matching `.design-lab/*/designs/*`
- Allow reads from:
  - Project source files
  - Task definition (`task.json`)
  - Non-design artifacts

**Design Artifact Schema**:

```json
{
  "$schema": "../schemas/design.schema.json",
  "design_id": "design-claude-opus-4-5",
  "model": "anthropic/claude-opus-4-20241022",
  "title": "...",
  "summary": "...",
  "assumptions": ["..."],
  "architecture_overview": "...",
  "components": [
    {
      "name": "...",
      "responsibility": "...",
      "dependencies": ["..."]
    }
  ],
  "data_flow": "...",
  "tradeoffs": [
    {
      "choice": "...",
      "alternatives": ["..."],
      "rationale": "..."
    }
  ],
  "risks": [
    {
      "risk": "...",
      "mitigation": "...",
      "severity": "low|medium|high"
    }
  ],
  "open_questions": ["..."],
  "metadata": {
    "generated_at": "ISO8601",
    "model_version": "...",
    "temperature": 0.7
  }
}
```

### 5.3 Phase 2: Review and Evaluation

**Actions**:
1. For each model in `review_models` (or all design models if not specified):
   - Read all designs from `designs/`
   - Anonymize designs (remove model identifiers)
   - Invoke review agent
   - Agent generates qualitative and/or quantitative evaluation
   - Validate output against schema
   - Save to `reviews/review-{model-id}.json`

**Review Agent Input**:

```json
{
  "task": { /* original task.json */ },
  "designs": [
    {
      "design_id": "anonymous-1",
      "title": "...",
      "summary": "...",
      /* rest of design without model info */
    },
    {
      "design_id": "anonymous-2",
      "title": "...",
      "summary": "...",
      /* rest of design without model info */
    }
  ],
  "evaluation_criteria": { /* from config */ }
}
```

**Review Artifact Schema**:

```json
{
  "$schema": "../schemas/review.schema.json",
  "review_id": "review-gpt-5-2",
  "reviewer_model": "openai/gpt-5.2",
  "evaluations": [
    {
      "design_id": "anonymous-1",
      "qualitative": {
        "strengths": ["..."],
        "weaknesses": ["..."],
        "missing_considerations": ["..."],
        "risk_assessment": "low|medium|high"
      },
      "quantitative": {
        "clarity": 8,
        "feasibility": 7,
        "scalability": 9,
        "maintainability": 6,
        "overall": 7.5,
        "justification": "..."
      }
    }
  ],
  "metadata": {
    "generated_at": "ISO8601",
    "model_version": "...",
    "temperature": 0.3
  }
}
```

### 5.4 Phase 3: Score Aggregation

**Actions**:
1. Parse all review files from `reviews/`
2. Map anonymous design IDs back to actual design IDs
3. For each design:
   - Aggregate scores across all reviewers
   - Compute mean, median, and variance
   - Compute ranking
4. Generate ranking artifact

**Score Aggregation Schema**:

```json
{
  "$schema": "../schemas/results.schema.json",
  "rankings": [
    {
      "design_id": "design-claude-opus-4-5",
      "rank": 1,
      "average_score": 8.4,
      "median_score": 8.5,
      "score_variance": 0.3,
      "score_breakdown": {
        "clarity": {
          "mean": 8.7,
          "median": 8.5,
          "reviews": [8.5, 8.8, 8.8]
        },
        "feasibility": {
          "mean": 8.2,
          "median": 8.0,
          "reviews": [8.0, 8.3, 8.3]
        },
        "scalability": {
          "mean": 8.5,
          "median": 8.5,
          "reviews": [8.3, 8.7, 8.5]
        },
        "maintainability": {
          "mean": 8.2,
          "median": 8.3,
          "reviews": [8.0, 8.5, 8.1]
        }
      },
      "qualitative_summary": {
        "strengths": ["...", "..."],
        "weaknesses": ["...", "..."],
        "risks": ["...", "..."]
      }
    }
  ],
  "metadata": {
    "total_designs": 3,
    "total_reviewers": 2,
    "aggregation_method": "arithmetic_mean",
    "generated_at": "ISO8601"
  }
}
```

---

## 6. Hook System

### 6.1 Isolation Hook

**File**: `src/hooks/isolation.ts`

```typescript
import type { Plugin } from "@opencode-ai/plugin";

interface IsolationState {
  phase: "setup" | "design" | "review" | "aggregation" | "idle";
  workflowDir: string;
}

let isolationState: IsolationState = {
  phase: "idle",
  workflowDir: ""
};

export async function enforceIsolation(
  input: Plugin.ToolExecuteInput,
  config: Config
): Promise<Plugin.HookResult | void> {
  const { tool, args } = input;

  // Only enforce during design phase
  if (isolationState.phase !== "design") {
    return;
  }

  // Only intercept read operations
  if (tool !== "read") {
    return;
  }

  const filePath = args.filePath as string;

  // Check if trying to read from designs directory
  const designsPattern = `${isolationState.workflowDir}/designs/`;

  if (filePath.includes(designsPattern)) {
    return {
      error: {
        message: `Cannot read design artifacts during design phase. Design isolation is enforced.`,
        retryable: false
      }
    };
  }

  // Allow all other reads
  return;
}

export function setDesignPhase(workflowDir: string) {
  isolationState = {
    phase: "design",
    workflowDir
  };
}

export function clearIsolation() {
  isolationState = {
    phase: "idle",
    workflowDir: ""
  };
}
```

### 6.2 Workflow State Hook

**File**: `src/hooks/workflow-state.ts`

```typescript
import type { Plugin } from "@opencode-ai/plugin";

interface WorkflowState {
  currentPhase: string;
  workflowDir: string;
  task: DesignTask | null;
}

let state: WorkflowState = {
  currentPhase: "idle",
  workflowDir: "",
  task: null
};

export const workflowStateHook = {
  session: {
    init: async () => {
      state = {
        currentPhase: "idle",
        workflowDir: "",
        task: null
      };
    }
  }
};

export function setWorkflowPhase(phase: string, workflowDir: string, task?: DesignTask) {
  state = {
    currentPhase: phase,
    workflowDir,
    task: task || state.task
  };
}

export function getWorkflowState(): WorkflowState {
  return state;
}
```

### 6.3 Hook Registration

```typescript
// src/index.ts
import { enforceIsolation, setDesignPhase, clearIsolation } from "./hooks/isolation";
import { workflowStateHook } from "./hooks/workflow-state";

export const DesignLabPlugin: Plugin = async ({ client, config }) => {
  const labConfig = await loadConfig();

  return {
    // Workflow state management
    ...workflowStateHook,

    // Isolation enforcement
    tool: {
      execute: {
        before: async ({ input }) => {
          return await enforceIsolation(input, labConfig);
        }
      }
    },

    // Slash command
    command: {
      design_lab: async ({ input }) => {
        return await handleDesignLabCommand(input, labConfig, client);
      }
    }
  };
};
```

---

## 7. File Structure

```
opencode-design-lab/
├── assets/
│   ├── design-lab.schema.json          # Config JSON schema
│   ├── design.schema.json            # Design artifact schema
│   ├── review.schema.json            # Review artifact schema
│   └── results.schema.json          # Results schema
├── src/
│   ├── index.ts                     # Plugin entry point
│   ├── config/
│   │   ├── loader.ts               # Config loading and validation
│   │   ├── schema.ts              # TypeScript types for config
│   │   └── defaults.ts            # Default configuration
│   ├── agents/
│   │   ├── registration.ts         # Agent registration logic
│   │   ├── invoker.ts             # Agent invocation wrapper
│   │   └── prompts.ts            # Prompt templates
│   ├── workflow/
│   │   ├── orchestrator.ts         # Main workflow controller
│   │   ├── phases/
│   │   │   ├── setup.ts           # Phase 0: Initialization
│   │   │   ├── design.ts          # Phase 1: Design generation
│   │   │   ├── review.ts          # Phase 2: Review
│   │   │   └── aggregation.ts    # Phase 3: Score aggregation
│   │   └── state-manager.ts       # Workflow state management
│   ├── hooks/
│   │   ├── isolation.ts            # Isolation enforcement hook
│   │   └── workflow-state.ts      # Workflow state hook
│   ├── validation/
│   │   ├── schema-validator.ts     # JSON schema validation
│   │   └── design-validator.ts    # Design-specific validation
│   ├── aggregation/
│   │   ├── score-processor.ts      # Score aggregation logic
│   │   └── ranking-engine.ts      # Ranking computation
│   └── utils/
│       ├── file-manager.ts         # File I/O utilities
│       ├── topic-generator.ts      # AI topic generation
│       └── anonymizer.ts          # Design anonymization
├── prompts/
│   ├── design-system.md           # Design agent prompt
│   ├── design-architecture.md      # Architecture design prompt
│   ├── design-api.md              # API design prompt
│   ├── review-qualitative.md      # Qualitative review prompt
│   └── review-quantitative.md     # Quantitative review prompt
├── test/
│   ├── config/
│   │   └── loader.test.ts
│   ├── workflow/
│   │   └── orchestrator.test.ts
│   ├── validation/
│   │   └── schema-validator.test.ts
│   └── integration/
│       └── full-workflow.test.ts
├── package.json
├── tsconfig.json
├── README.md
└── DESIGN.md
```

---

## 8. Implementation Details

### 8.1 Configuration Loading

**File**: `src/config/loader.ts`

```typescript
import { promises as fs } from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import { ConfigSchema, type Config } from "./schema";
import { DEFAULT_CONFIG } from "./defaults";

const CONFIG_PATHS = [
  ".opencode/design-lab.json",
  path.join(process.env.HOME || "", ".config/opencode/design-lab.json")
];

export async function loadConfig(): Promise<Config> {
  let config: Partial<Config> = {};

  // Load and merge all configs
  for (const configPath of CONFIG_PATHS) {
    try {
      const content = await fs.readFile(configPath, "utf-8");
      const parsed = JSON.parse(content);
      config = deepMerge(config, parsed);
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.error(`Failed to load config from ${configPath}:`, error);
      }
    }
  }

  // Merge with defaults
  const finalConfig = deepMerge(DEFAULT_CONFIG, config);

  // Validate against schema
  const ajv = new Ajv();
  const validate = ajv.compile(ConfigSchema);
  const valid = validate(finalConfig);

  if (!valid) {
    throw new Error(`Config validation failed: ${JSON.stringify(validate.errors)}`);
  }

  return finalConfig;
}

function deepMerge(target: any, source: any): any {
  const output = { ...target };

  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] });
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }

  return output;
}

function isObject(item: any): boolean {
  return item && typeof item === "object" && !Array.isArray(item);
}
```

### 8.2 Agent Invocation

**File**: `src/agents/invoker.ts`

```typescript
import type { Client } from "@opencode-ai/sdk";
import type { ModelConfig, DesignTask, DesignOutput, ReviewOutput } from "../config/schema";

export class AgentInvoker {
  constructor(private client: Client) {}

  async invokeDesignAgent(
    model: ModelConfig,
    task: DesignTask
  ): Promise<DesignOutput> {
    const response = await this.client.messages.create({
      model: model.model_id,
      temperature: model.temperature,
      system: model.prompt_template,
      messages: [
        {
          role: "user",
          content: JSON.stringify(task, null, 2)
        }
      ],
      response_format: { type: "json_object" } // If supported
    });

    const output = JSON.parse(response.content[0].text);

    // Validate schema
    await validateDesignOutput(output);

    return output;
  }

  async invokeReviewAgent(
    model: ModelConfig,
    task: DesignTask,
    designs: DesignOutput[]
  ): Promise<ReviewOutput> {
    // Anonymize designs
    const anonymizedDesigns = designs.map((design, index) => ({
      ...design,
      design_id: `anonymous-${index}`,
      model: undefined, // Remove model identifier
      metadata: undefined // Remove metadata
    }));

    const response = await this.client.messages.create({
      model: model.model_id,
      temperature: model.temperature,
      system: model.prompt_template,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            task,
            designs: anonymizedDesigns,
            evaluation_criteria: model.evaluation_criteria
          }, null, 2)
        }
      ],
      response_format: { type: "json_object" }
    });

    const output = JSON.parse(response.content[0].text);

    // Validate schema
    await validateReviewOutput(output);

    return output;
  }
}
```

### 8.3 Workflow Orchestrator

**File**: `src/workflow/orchestrator.ts`

```typescript
import { AgentInvoker } from "../agents/invoker";
import { setupPhase } from "./phases/setup";
import { designPhase } from "./phases/design";
import { reviewPhase } from "./phases/review";
import { aggregationPhase } from "./phases/aggregation";
import { setDesignPhase, clearIsolation } from "../hooks/isolation";
import { setWorkflowPhase } from "../hooks/workflow-state";
import type { Config, DesignTask } from "../config/schema";

export class WorkflowOrchestrator {
  private agentInvoker: AgentInvoker;

  constructor(private client: any, private config: Config) {
    this.agentInvoker = new AgentInvoker(client);
  }

  async execute(taskInput: string): Promise<void> {
    console.log("Starting Design Lab workflow...");

    // Parse task input
    const task: DesignTask = this.parseTaskInput(taskInput);

    // Phase 0: Setup
    console.log("Phase 0: Setup");
    const workflowDir = await setupPhase(task, this.config);

    setWorkflowPhase("setup", workflowDir, task);

    // Phase 1: Design Generation
    console.log("Phase 1: Design Generation");
    setDesignPhase(workflowDir);
    const designs = await designPhase(
      this.config.design_models,
      task,
      this.agentInvoker,
      workflowDir
    );

    setWorkflowPhase("design", workflowDir, task);

    // Phase 2: Review
    console.log("Phase 2: Review");
    clearIsolation();
    const reviewModels = this.resolveReviewModels();
    const reviews = await reviewPhase(
      reviewModels,
      task,
      designs,
      this.agentInvoker,
      workflowDir
    );

    setWorkflowPhase("review", workflowDir, task);

    // Phase 3: Aggregation
    console.log("Phase 3: Aggregation");
    await aggregationPhase(reviews, designs, workflowDir);

    setWorkflowPhase("aggregation", workflowDir, task);

    console.log(`Design Lab workflow complete. Results: ${workflowDir}/results/ranking.json`);
  }

  private parseTaskInput(input: string): DesignTask {
    // Parse user input into structured task
    // This could be enhanced with AI parsing
    return {
      problem_statement: input,
      constraints: [],
      non_functional_requirements: []
    };
  }

  private resolveReviewModels() {
    if (this.config.review_models && this.config.review_models.length > 0) {
      return this.config.review_models;
    }
    return this.config.design_models;
  }
}
```

### 8.4 Schema Validation

**File**: `src/validation/schema-validator.ts`

```typescript
import Ajv from "ajv";
import * as designSchema from "../../assets/design.schema.json";
import * as reviewSchema from "../../assets/review.schema.json";
import * as resultsSchema from "../../assets/results.schema.json";

const ajv = new Ajv();

const validateDesign = ajv.compile(designSchema);
const validateReview = ajv.compile(reviewSchema);
const validateResults = ajv.compile(resultsSchema);

export async function validateDesignOutput(output: any): Promise<void> {
  const valid = validateDesign(output);
  if (!valid) {
    throw new Error(
      `Design output validation failed: ${JSON.stringify(validateDesign.errors)}`
    );
  }
}

export async function validateReviewOutput(output: any): Promise<void> {
  const valid = validateReview(output);
  if (!valid) {
    throw new Error(
      `Review output validation failed: ${JSON.stringify(validateReview.errors)}`
    );
  }
}

export async function validateResultsOutput(output: any): Promise<void> {
  const valid = validateResults(output);
  if (!valid) {
    throw new Error(
      `Results output validation failed: ${JSON.stringify(validateResults.errors)}`
    );
  }
}
```

### 8.5 Score Aggregation

**File**: `src/aggregation/score-processor.ts`

```typescript
import type { ReviewOutput, DesignOutput, AggregatedResults } from "../config/schema";

export function aggregateScores(
  designs: DesignOutput[],
  reviews: ReviewOutput[]
): AggregatedResults {
  const rankings = designs.map(design => {
    const designReviews = reviews
      .flatMap(review => review.evaluations)
      .filter(eval => eval.design_id === design.design_id);

    if (designReviews.length === 0) {
      throw new Error(`No reviews found for design ${design.design_id}`);
    }

    // Compute aggregated scores
    const scoreBreakdown: Record<string, any> = {};

    for (const criterion of ["clarity", "feasibility", "scalability", "maintainability"]) {
      const scores = designReviews
        .map(r => r.quantitative?.[criterion])
        .filter(s => s !== undefined);

      if (scores.length > 0) {
        scoreBreakdown[criterion] = {
          mean: calculateMean(scores),
          median: calculateMedian(scores),
          reviews: scores
        };
      }
    }

    const overallScores = designReviews
      .map(r => r.quantitative?.overall)
      .filter(s => s !== undefined);

    const averageScore = calculateMean(overallScores);
    const medianScore = calculateMedian(overallScores);
    const variance = calculateVariance(overallScores);

    // Aggregate qualitative feedback
    const qualitativeSummary = aggregateQualitative(designReviews);

    return {
      design_id: design.design_id,
      rank: 0, // Will be set after sorting
      average_score: averageScore,
      median_score: medianScore,
      score_variance: variance,
      score_breakdown: scoreBreakdown,
      qualitative_summary: qualitativeSummary
    };
  });

  // Sort by average score
  rankings.sort((a, b) => b.average_score - a.average_score);

  // Assign ranks
  rankings.forEach((r, index) => {
    r.rank = index + 1;
  });

  return {
    rankings,
    metadata: {
      total_designs: designs.length,
      total_reviewers: reviews.length,
      aggregation_method: "arithmetic_mean",
      generated_at: new Date().toISOString()
    }
  };
}

function calculateMean(scores: number[]): number {
  if (scores.length === 0) return 0;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function calculateMedian(scores: number[]): number {
  if (scores.length === 0) return 0;
  const sorted = [...scores].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function calculateVariance(scores: number[]): number {
  if (scores.length === 0) return 0;
  const mean = calculateMean(scores);
  return scores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / scores.length;
}

function aggregateQualitative(evaluations: any[]): any {
  const strengths = new Set<string>();
  const weaknesses = new Set<string>();
  const risks = new Set<string>();

  for (const eval of evaluations) {
    for (const strength of eval.qualitative?.strengths || []) {
      strengths.add(strength);
    }
    for (const weakness of eval.qualitative?.weaknesses || []) {
      weaknesses.add(weakness);
    }
    for (const risk of eval.qualitative?.risk_assessment ? [eval.qualitative.risk_assessment] : []) {
      risks.add(risk);
    }
  }

  return {
    strengths: Array.from(strengths),
    weaknesses: Array.from(weaknesses),
    risks: Array.from(risks)
  };
}
```

---

## 9. Technical Decisions

### 9.1 Why NOT Dynamic Agent Generation?

**Decision**: We will NOT dynamically generate agent files. Instead, we use runtime config merging.

**Rationale**:
1. **OpenCode's Agent System**: OpenCode expects agents to be registered with the agent system, not dynamically created.
2. **oh-my-opencode Pattern**: The established pattern is to merge config with predefined agent configurations.
3. **Simplicity**: Runtime merging is simpler and less error-prone than file generation.
4. **User Visibility**: Users can see and manage agents in the UI.
5. **Consistency**: Aligns with OpenCode's plugin architecture.

### 9.2 Config-Based Agent Registration

**Decision**: Register agents at plugin initialization with model overrides from config.

**Rationale**:
1. Integration with OpenCode's agent system
2. Allows users to invoke agents directly via `@design-lab-design-claude-opus-4-5`
3. Simpler implementation than SDK-based invocation
4. Better visibility in UI

### 9.3 Hook-Based Isolation

**Decision**: Use `tool.execute.before` hook to enforce design isolation.

**Rationale**:
1. Clean separation: Plugin enforces isolation, not agents
2. Flexible: Can be toggled via config
3. Reliable: Intercepts all read operations at the tool level
4. Consistent with OpenCode's hook system

### 9.4 Schema Validation

**Decision**: Validate all outputs against JSON schemas using Ajv.

**Rationale**:
1. Ensures structure compliance
2. Catches errors early
3. Self-documenting: Schema serves as documentation
4. Extensible: Easy to add new fields

### 9.5 Review Models Default

**Decision**: If review_models not specified, use all design_models for review.

**Rationale**:
1. Sensible default: Design models should also review their peers
2. Consistency: Same models generate and evaluate
3. Flexibility: Users can override with custom reviewers

---

## 10. Future Extensions

### 10.1 Iterative Refinement (v2)

Allow designs to be refined based on review feedback:

```
Design Phase → Review Phase → Refinement Phase → Re-Review
```

### 10.2 Pairwise Ranking (v2)

Implement Elo-style or Bradley-Terry pairwise ranking:

```
For each pair (A, B):
  Ask reviewer: "Which design is better: A or B?"
Compute global ranking from pairwise comparisons
```

### 10.3 Human-in-the-Loop (v3)

Allow human reviewers to participate in the evaluation:

```json
{
  "review_models": [
    { "model_id": "human", "name": "Human Reviewer" }
  ]
}
```

### 10.4 Visualization Dashboard (v3)

Generate interactive dashboard to visualize rankings, scores, and qualitative feedback.

### 10.5 Design Merging Assistant (v3)

AI agent that helps merge the best aspects from multiple designs:

```
"Merge these designs: A (best scalability), B (best clarity), C (best feasibility)"
```

---

## Appendix A: Example Config File

```json
{
  "$schema": "https://raw.githubusercontent.com/yourorg/opencode-design-lab/main/assets/design-lab.schema.json",

  "design_models": [
    {
      "id": "claude-opus",
      "name": "Claude Opus 4.5",
      "model_id": "anthropic/claude-opus-4-20241022",
      "temperature": 0.7,
      "prompt_template": "{file:./prompts/design-system.md}"
    },
    {
      "id": "gpt-codex",
      "name": "GPT-5.1 Codex",
      "model_id": "openai/gpt-5.1-codex",
      "temperature": 0.6,
      "prompt_template": "{file:./prompts/design-architecture.md}"
    },
    {
      "id": "gemini-pro",
      "name": "Gemini 3 Pro",
      "model_id": "google/gemini-3-pro",
      "temperature": 0.65,
      "prompt_template": "{file:./prompts/design-api.md}"
    }
  ],

  "review_models": [
    {
      "id": "gpt-5-2",
      "name": "GPT-5.2",
      "model_id": "openai/gpt-5.2",
      "temperature": 0.3,
      "evaluation_criteria": {
        "qualitative": true,
        "quantitative": true
      }
    }
    // If review_models is omitted, all design_models will review
  ],

  "output_directory": ".design-lab",

  "scoring_criteria": {
    "dimensions": [
      {
        "name": "clarity",
        "description": "How clear and understandable is the design?",
        "min": 0,
        "max": 10
      },
      {
        "name": "feasibility",
        "description": "How feasible is this design to implement?",
        "min": 0,
        "max": 10
      },
      {
        "name": "scalability",
        "description": "How well does this design scale?",
        "min": 0,
        "max": 10
      },
      {
        "name": "maintainability",
        "description": "How easy is this to maintain?",
        "min": 0,
        "max": 10
      }
    ],
    "require_justification": true
  },

  "isolation": {
    "enforce_design_isolation": true,
    "blocked_patterns": [".design-lab/*/designs/"]
  }
}
```

---

## Appendix B: Slash Command Usage

```bash
# Start design lab workflow
/design-lab

# Provide task interactively
Task: Design a user authentication system with JWT tokens and OAuth 2.0 support
Constraints: Must support refresh tokens, be stateless, and handle token revocation
Non-functional requirements: High performance, secure, scalable to 1M users

# Plugin creates:
# .design-lab/2026-01-20-user-authentication-system/
# ├── task.json
# ├── designs/
# │   ├── design-claude-opus.json
# │   ├── design-gpt-codex.json
# │   └── design-gemini-pro.json
# ├── reviews/
# │   └── review-gpt-5-2.json
# └── results/
#     └── ranking.json
```

---

## Appendix C: Agent Invocation Examples

### Direct Invocation

```bash
# Users can invoke design agents directly
@design-lab-design-claude-opus Create a design for payment processing

# Users can invoke review agents directly
@design-lab-review-gpt-5-2 Review this design: {design content}
```

### Via Plugin Workflow

```bash
# Plugin orchestrates all phases
/design-lab

# Plugin internally invokes:
# @design-lab-design-claude-opus
# @design-lab-design-gpt-codex
# @design-lab-design-gemini-pro
# @design-lab-review-gpt-5-2
```

---

**End of Design Document**
