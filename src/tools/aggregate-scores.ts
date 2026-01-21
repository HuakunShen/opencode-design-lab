import {
  tool,
  type PluginInput,
  type ToolDefinition,
} from "@opencode-ai/plugin";
import * as fs from "fs";
import * as path from "path";
import { type DesignLabConfig, type Score, type Ranking } from "../config";

interface AggregateScoresArgs {
  lab_path?: string;
}

/**
 * Create the aggregate_scores tool
 */
export function createAggregateScoresTool(
  ctx: PluginInput,
  config: DesignLabConfig,
): ToolDefinition {
  return tool({
    description: `Aggregate scores from all reviewers and generate final rankings.

This tool:
1. Reads all score files from the reviews
2. Calculates average scores per design
3. Computes variance/disagreement metrics
4. Generates a final ranking with results.md

Use this after review_designs to get the final comparison.`,
    args: {
      lab_path: tool.schema
        .string()
        .describe(
          `Path to the design lab directory. If not provided, uses the most recent lab.`,
        )
        .optional(),
    },
    async execute(args: AggregateScoresArgs) {
      // Find lab directory
      const labDir = args.lab_path
        ? path.resolve(ctx.directory, args.lab_path)
        : findMostRecentLab(ctx.directory, config.base_output_dir);

      if (!labDir) {
        return "Error: No design lab found. Run generate_designs first.";
      }

      const scoresDir = path.join(labDir, "scores");
      const resultsDir = path.join(labDir, "results");

      if (!fs.existsSync(scoresDir)) {
        return "Error: No scores directory found. Run review_designs first.";
      }

      fs.mkdirSync(resultsDir, { recursive: true });

      // Load all score files
      const scoreFiles = fs
        .readdirSync(scoresDir)
        .filter((f) => f.endsWith(".json"));
      if (scoreFiles.length === 0) {
        return "Error: No score files found. Run review_designs first.";
      }

      const allScores: Score[] = [];
      for (const file of scoreFiles) {
        const content = fs.readFileSync(path.join(scoresDir, file), "utf-8");
        allScores.push(JSON.parse(content) as Score);
      }

      // Group scores by design
      const scoresByDesign: Record<string, Score[]> = {};
      for (const score of allScores) {
        if (!scoresByDesign[score.design_id]) {
          scoresByDesign[score.design_id] = [];
        }
        scoresByDesign[score.design_id].push(score);
      }

      // Calculate rankings
      const rankings: Ranking[] = [];
      for (const [designId, scores] of Object.entries(scoresByDesign)) {
        const overallScores = scores.map((s) => s.scores.overall);
        const avgOverall =
          overallScores.reduce((a, b) => a + b, 0) / overallScores.length;

        // Calculate variance
        const variance =
          overallScores.reduce(
            (sum, s) => sum + Math.pow(s - avgOverall, 2),
            0,
          ) / overallScores.length;

        // Calculate score breakdown averages
        const dimensions = [
          "clarity",
          "feasibility",
          "scalability",
          "maintainability",
          "completeness",
          "overall",
        ] as const;
        const scoreBreakdown: Record<string, number> = {};
        for (const dim of dimensions) {
          const dimScores = scores.map((s) => s.scores[dim]);
          scoreBreakdown[dim] =
            dimScores.reduce((a, b) => a + b, 0) / dimScores.length;
        }

        rankings.push({
          design_id: designId,
          rank: 0, // Will be set after sorting
          average_score: avgOverall,
          score_breakdown: scoreBreakdown,
          variance,
          reviewer_count: scores.length,
        });
      }

      // Sort by average score (descending) and assign ranks
      rankings.sort((a, b) => b.average_score - a.average_score);
      rankings.forEach((r, i) => {
        r.rank = i + 1;
      });

      // Save rankings JSON
      fs.writeFileSync(
        path.join(resultsDir, "ranking.json"),
        JSON.stringify(rankings, null, 2),
      );

      // Generate results.md
      const resultsMarkdown = generateResultsMarkdown(rankings, allScores);
      fs.writeFileSync(path.join(resultsDir, "results.md"), resultsMarkdown);

      return `Aggregation complete.

**Rankings saved to**: ${path.join(resultsDir, "ranking.json")}
**Results summary saved to**: ${path.join(resultsDir, "results.md")}

## Final Rankings

${rankings
  .map(
    (r) =>
      `${r.rank}. **${r.design_id}** - Score: ${r.average_score.toFixed(1)}/10 (variance: ${r.variance.toFixed(2)})`,
  )
  .join("\n")}

View the full results in ${path.join(resultsDir, "results.md")}`;
    },
  });
}

/**
 * Find the most recent design lab directory
 */
function findMostRecentLab(projectDir: string, baseDir: string): string | null {
  const labBaseDir = path.join(projectDir, baseDir);
  if (!fs.existsSync(labBaseDir)) {
    return null;
  }

  const labs = fs
    .readdirSync(labBaseDir)
    .filter((d) => fs.statSync(path.join(labBaseDir, d)).isDirectory())
    .sort()
    .reverse();

  if (labs.length === 0) {
    return null;
  }

  return path.join(labBaseDir, labs[0]);
}

/**
 * Generate the results markdown file
 */
function generateResultsMarkdown(
  rankings: Ranking[],
  allScores: Score[],
): string {
  const dimensions = [
    "clarity",
    "feasibility",
    "scalability",
    "maintainability",
    "completeness",
    "overall",
  ] as const;

  // Group scores by reviewer
  const reviewers = [...new Set(allScores.map((s) => s.reviewer_model))];

  let md = `# Design Lab Results

Generated: ${new Date().toISOString()}

## Summary

| Rank | Design | Avg Score | Variance | Reviewers |
|------|--------|-----------|----------|-----------|
${rankings.map((r) => `| ${r.rank} | ${r.design_id} | ${r.average_score.toFixed(1)} | ${r.variance.toFixed(2)} | ${r.reviewer_count} |`).join("\n")}

## Detailed Score Breakdown

### Average Scores by Dimension

| Design | ${dimensions.join(" | ")} |
|--------|${"---|".repeat(dimensions.length)}
${rankings
  .map(
    (r) =>
      `| ${r.design_id} | ${dimensions.map((d) => r.score_breakdown[d].toFixed(1)).join(" | ")} |`,
  )
  .join("\n")}

## Reviewer × Design Matrix

### Overall Scores

| Reviewer | ${rankings.map((r) => r.design_id).join(" | ")} |
|----------|${"---|".repeat(rankings.length)}
${reviewers
  .map((reviewer) => {
    const scores = rankings.map((r) => {
      const score = allScores.find(
        (s) => s.design_id === r.design_id && s.reviewer_model === reviewer,
      );
      return score ? score.scores.overall.toFixed(1) : "N/A";
    });
    return `| ${reviewer} | ${scores.join(" | ")} |`;
  })
  .join("\n")}

## Key Observations

`;

  // Add top design summary
  const topDesign = rankings[0];
  md += `### Winner: ${topDesign.design_id}

- **Average Score**: ${topDesign.average_score.toFixed(1)}/10
- **Variance**: ${topDesign.variance.toFixed(2)} (${topDesign.variance < 1 ? "high consensus" : topDesign.variance < 2 ? "moderate consensus" : "low consensus"})

`;

  // Add strength/weakness summary for top designs
  md += `### Strengths and Weaknesses\n\n`;
  for (const ranking of rankings.slice(0, 3)) {
    const designScores = allScores.filter(
      (s) => s.design_id === ranking.design_id,
    );
    const strengths = [
      ...new Set(designScores.flatMap((s) => s.strengths)),
    ].slice(0, 3);
    const weaknesses = [
      ...new Set(designScores.flatMap((s) => s.weaknesses)),
    ].slice(0, 3);

    md += `#### ${ranking.rank}. ${ranking.design_id}\n\n`;
    md += `**Strengths**:\n${strengths.map((s) => `- ${s}`).join("\n")}\n\n`;
    md += `**Weaknesses**:\n${weaknesses.map((w) => `- ${w}`).join("\n")}\n\n`;
  }

  return md;
}
