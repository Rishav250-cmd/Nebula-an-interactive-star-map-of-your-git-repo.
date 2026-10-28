// Counts how often each file changed, from the text printed by:
//   git log --since=12.months.ago --name-only --pretty=format:
//
// That command prints, for every commit, the paths of the files it touched
// (one path per line, with a blank line between commits). A file is counted
// once per commit even if its path appears more than once.

/**
 * @param {string} logOutput  raw text from `git log --name-only --pretty=format:`
 * @returns {Map<string, number>}  file path -> number of commits that touched it
 */
export function countChurn(logOutput) {
  const counts = new Map();
  if (typeof logOutput !== "string" || logOutput === "") return counts;

  let commitPaths = new Set();
  const countCommit = () => {
    for (const filePath of commitPaths) {
      counts.set(filePath, (counts.get(filePath) ?? 0) + 1);
    }
    commitPaths = new Set();
  };

  for (const rawLine of logOutput.split("\n")) {
    const filePath = rawLine.replace(/\r$/, "");
    if (filePath.trim() === "") countCommit();
    else commitPaths.add(filePath);
  }
  countCommit();

  return counts;
}
