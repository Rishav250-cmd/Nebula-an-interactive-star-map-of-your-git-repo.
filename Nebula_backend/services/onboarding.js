import path from "node:path";

const MAX_ISSUE_TEXT = 4000;
const MAX_MATCHES = 3;
const COMMON_WORDS = new Set([
  "about",
  "after",
  "also",
  "could",
  "file",
  "files",
  "from",
  "have",
  "issue",
  "issues",
  "more",
  "need",
  "should",
  "that",
  "their",
  "there",
  "this",
  "those",
  "using",
  "want",
  "when",
  "where",
  "which",
  "will",
  "with",
]);

/** Rank files mentioned by issue text, combining independent mention signals. */
export function matchIssueToFiles(issue, nodes, symbols) {
  const text = `${issue?.title ?? ""}\n${issue?.body ?? ""}`.slice(
    0,
    MAX_ISSUE_TEXT,
  );
  const candidates = Array.isArray(nodes)
    ? nodes.filter((node) => typeof node?.id === "string")
    : [];
  if (!text || candidates.length === 0) return [];

  const matches = new Map();
  const add = (id, score, reason) => {
    const current = matches.get(id);
    if (!current) {
      matches.set(id, { id, score, reason, reasonScore: score });
    } else {
      current.score += score;
      if (score > current.reasonScore) {
        current.reason = reason;
        current.reasonScore = score;
      }
    }
  };

  for (const node of candidates) {
    const id = node.id;
    const parts = id.split("/");
    const mentionedPath = parts
      .slice(0, -1)
      .map((_part, index) => parts.slice(index).join("/"))
      .some((suffix) => containsLiteral(text, suffix));
    if (mentionedPath) add(id, 100, "Mentioned by path");
  }

  const filesByBasename = new Map();
  for (const node of candidates) {
    const basename = path.posix.basename(node.id);
    if (!/\.[A-Za-z0-9]+$/.test(basename)) continue;
    const key = basename.toLowerCase();
    const entries = filesByBasename.get(key) ?? [];
    entries.push({ id: node.id, basename });
    filesByBasename.set(key, entries);
  }
  for (const entries of filesByBasename.values()) {
    const mentioned = entries.find(({ basename }) => containsLiteral(text, basename));
    if (!mentioned) continue;
    const score = entries.length === 1 ? 80 : 40;
    for (const { id } of entries) add(id, score, "Mentioned by file name");
  }

  const backticked = new Set(
    [...text.matchAll(/`([^`]+)`/g)].map((match) =>
      match[1].trim().replace(/\(.*$/, "").replace(/[^\w$].*$/, ""),
    ),
  );
  const words = new Set(text.match(/[A-Za-z_$][\w$]*/g) ?? []);
  const filesBySymbol = new Map();
  for (const symbol of Array.isArray(symbols) ? symbols : []) {
    if (typeof symbol?.name !== "string" || typeof symbol.path !== "string")
      continue;
    const paths = filesBySymbol.get(symbol.name) ?? new Set();
    paths.add(symbol.path);
    filesBySymbol.set(symbol.name, paths);
  }
  for (const [name, paths] of filesBySymbol) {
    if (paths.size !== 1 || COMMON_WORDS.has(name.toLowerCase())) continue;
    const clearCaseWord = hasClearCamelOrPascalCase(name);
    if (!backticked.has(name) && !(clearCaseWord && words.has(name))) continue;
    add([...paths][0], 60, `Mentions function ${name}`);
  }

  const nodesByStem = new Map();
  for (const node of candidates) {
    const basename = path.posix.basename(node.id);
    const stem = basename.replace(/\.[^.]+$/, "");
    if (!stem || !/^[A-Z][A-Za-z0-9]*$/.test(stem)) continue;
    const entries = nodesByStem.get(stem) ?? [];
    entries.push(node.id);
    nodesByStem.set(stem, entries);
  }
  for (const [stem, ids] of nodesByStem) {
    if (stem.replace(/[^A-Za-z]/g, "").length < 5 || !words.has(stem)) continue;
    for (const id of ids) add(id, 40, `Mentions component ${stem}`);
  }

  const matched = [...matches.values()];
  const nonTests = matched.filter(({ id }) => !isTestPath(id));
  return (nonTests.length ? nonTests : matched)
    .sort(
      (left, right) =>
        right.score - left.score || left.id.localeCompare(right.id),
    )
    .slice(0, MAX_MATCHES)
    .map(({ id, score, reason }) => ({ id, score, reason }));
}

function containsLiteral(text, value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9_.-])${escaped}(?=$|[^A-Za-z0-9_.-])`, "i").test(
    text,
  );
}

function hasClearCamelOrPascalCase(value) {
  return (
    /^[a-z]+(?:[A-Z][A-Za-z0-9_$]*)+$/.test(value) ||
    /^[A-Z][a-z0-9]*(?:[A-Z][A-Za-z0-9_$]*)*$/.test(value)
  );
}

function isTestPath(filePath) {
  return (
    /\.(?:test|spec)\./i.test(filePath) ||
    /(?:^|\/)(?:__tests__|__mocks__|tests?)(?:\/|$)/i.test(filePath)
  );
}
