// Counts how often each file changed, from the text printed by:
//   git log --since=12.months.ago --name-only --pretty=format:
//
// That command prints, for every commit, the paths of the files it touched
// (one path per line, with a blank line between commits). So a file that
// appears on 7 lines was changed by 7 commits.

/**
 * @param {string} logOutput  raw text from `git log --name-only --pretty=format:`
 * @returns {Map<string, number>}  file path -> number of commits that touched it
 */
export function countChurn(logOutput) {
  const counts = new Map();
  if (typeof logOutput !== "string" || logOutput === "") return counts;

  for (const rawLine of logOutput.split("\n")) {
    const filePath = rawLine.replace(/\r$/, "").trim();
    if (filePath === "") continue; // blank line between commits
    counts.set(filePath, (counts.get(filePath) ?? 0) + 1);
  }

  return counts;
}
