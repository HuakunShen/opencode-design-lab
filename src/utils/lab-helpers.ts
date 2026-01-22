import * as fs from "fs";
import * as path from "path";

/**
 * Find the most recent design lab directory
 *
 * @param projectDir - The project root directory
 * @param baseDir - The base output directory (e.g., ".design-lab")
 * @returns The path to the most recent lab directory, or null if none found
 */
export function findMostRecentLab(
  projectDir: string,
  baseDir: string,
): string | null {
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
