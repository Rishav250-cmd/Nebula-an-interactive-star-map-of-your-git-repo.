import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { countChurn } from "../utils/churn.js";

const execFile = promisify(execFileCallback);

/** How far back we look. The plan defines churn as "commits in the last 12 months". */
export const CHURN_WINDOW = "12.months.ago";

/**
 * Number of commits that touched each file in the last 12 months.
 *
 * Only commits that exist in the clone are counted (Nebula clones the most
 * recent 200 commits), and ZIP uploads have no history at all. In both cases
 * the answer is simply smaller, or empty, and never an error.
 *
 * @param {string} dir  folder of the cloned repository
 * @returns {Promise<Map<string, number>>}  file path -> commit count
 */
export async function getChurn(dir) {
  // ZIP uploads have no .git folder: skip git, and don't climb into a parent repo by accident.
  if (!existsSync(path.join(dir, ".git"))) return new Map();

  try {
    const { stdout } = await execFile(
      "git",
      [
        "-c",
        "core.quotepath=false", // print accented / non-ASCII file names as they are
        "log",
        `--since=${CHURN_WINDOW}`,
        "--name-only",
        "--pretty=format:",
      ],
      {
        cwd: dir,
        timeout: 30_000,
        maxBuffer: 64 * 1024 * 1024,
        encoding: "utf8",
      },
    );
    return countChurn(stdout);
  } catch (error) {
    console.warn("Could not compute churn:", error?.message ?? String(error));
    return new Map();
  }
}
