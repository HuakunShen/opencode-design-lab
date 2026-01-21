#!/usr/bin/env bun
/**
 * Generate JSON Schema from Zod schemas
 * Run with: bun src/utils/schema-export.ts
 */

import { z } from "zod";
import {
  DesignLabConfigSchema,
  DesignArtifactSchema,
  ScoreSchema,
} from "../config/schema";
import * as fs from "fs";
import * as path from "path";

const schemasDir = path.join(process.cwd(), "schemas");

// Ensure schemas directory exists
if (!fs.existsSync(schemasDir)) {
  fs.mkdirSync(schemasDir, { recursive: true });
}

// Generate config schema using Zod v4's native toJSONSchema
const configSchema = z.toJSONSchema(DesignLabConfigSchema);
fs.writeFileSync(
  path.join(schemasDir, "design-lab-config.schema.json"),
  JSON.stringify(configSchema, null, 2),
);

// Generate design artifact schema
const designSchema = z.toJSONSchema(DesignArtifactSchema);
fs.writeFileSync(
  path.join(schemasDir, "design-artifact.schema.json"),
  JSON.stringify(designSchema, null, 2),
);

// Generate score schema
const scoreSchema = z.toJSONSchema(ScoreSchema);
fs.writeFileSync(
  path.join(schemasDir, "score.schema.json"),
  JSON.stringify(scoreSchema, null, 2),
);

console.log("✅ JSON schemas generated in schemas/ directory");
