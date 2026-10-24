// Case-insensitive search over a list of repository file paths.

export const MAX_SEARCH_RESULTS = 10;

/**
 * @param {string[]} files  repo-relative paths, e.g. ["src/index.js", ...]
 * @param {string} query    what the user typed
 * @param {number} limit    maximum number of results
 * @returns {{ type: "file", name: string, path: string, line: number }[]}
 */
export function searchFiles(files, query, limit = MAX_SEARCH_RESULTS) {
  const needle = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (needle === "" || !Array.isArray(files)) return [];

  const matches = [];
  for (const filePath of files) {
    const lowerPath = filePath.toLowerCase();
    if (!lowerPath.includes(needle)) continue;

    const name = filePath.split("/").at(-1);
    const lowerName = name.toLowerCase();
    const dot = lowerName.lastIndexOf(".");
    const stem = dot > 0 ? lowerName.slice(0, dot) : lowerName; // "api.js" -> "api"

    // Lower rank = better match: exact name (with or without extension), name starts with it,
    // name contains it, only the folder path contains it.
    let rank = 3;
    if (lowerName === needle || stem === needle) rank = 0;
    else if (lowerName.startsWith(needle)) rank = 1;
    else if (lowerName.includes(needle)) rank = 2;

    matches.push({
      rank,
      result: { type: "file", name, path: filePath, line: 1 },
    });
  }

  matches.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.result.path.length - b.result.path.length ||
      a.result.path.localeCompare(b.result.path),
  );

  return matches.slice(0, limit).map((match) => match.result);
}

/**
 * Case-insensitive symbol search, ranked by name match and then path.
 * Results use the same limit as file search and are intended to be appended
 * after file results by the route.
 */
export function searchSymbols(symbols, query, limit = MAX_SEARCH_RESULTS) {
  const needle = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (needle === "" || !Array.isArray(symbols)) return [];

  const matches = [];
  for (const symbol of symbols) {
    const name = typeof symbol?.name === "string" ? symbol.name : "";
    const lowerName = name.toLowerCase();
    const lowerPath =
      typeof symbol?.path === "string" ? symbol.path.toLowerCase() : "";
    if (!lowerName.includes(needle) && !lowerPath.includes(needle)) continue;

    const rank =
      lowerName === needle
        ? 0
        : lowerName.startsWith(needle)
          ? 1
          : lowerName.includes(needle)
            ? 2
            : 3;
    matches.push({
      rank,
      result: {
        type: "symbol",
        name,
        path: symbol.path,
        line: symbol.line,
        kind: symbol.kind,
      },
    });
  }

  matches.sort(
    (left, right) =>
      left.rank - right.rank ||
      left.result.path.localeCompare(right.result.path) ||
      left.result.line - right.result.line ||
      left.result.name.localeCompare(right.result.name),
  );
  return matches.slice(0, limit).map((match) => match.result);
}
