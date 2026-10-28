import path from "node:path";

const MAX_ISSUE_TEXT = 4000;
const MAX_MATCHES = 3;
const CODE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);
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
    const mentioned = entries.find(({ basename }) =>
      containsLiteral(text, basename),
    );
    if (!mentioned) continue;
    const score = entries.length === 1 ? 80 : 40;
    for (const { id } of entries) add(id, score, "Mentioned by file name");
  }

  const backticked = new Set(
    [...text.matchAll(/`([^`]+)`/g)].map((match) =>
      match[1]
        .trim()
        .replace(/\(.*$/, "")
        .replace(/[^\w$].*$/, ""),
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

export function buildOnboarding({ graph, analysis, issues = [] }) {
  const graphNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const nodesById = new Map(graphNodes.map((node) => [node.id, node]));
  const candidates = graphNodes.filter(isCandidate);
  const safetyById = calculateSafety(candidates);
  const candidatesById = new Map(candidates.map((node) => [node.id, node]));

  const entry = chooseEntry(candidates);
  const path = entry
    ? buildReadingPath(entry, graph?.edges ?? [], candidatesById, safetyById)
    : [];
  const safeStarters = chooseSafeStarters(candidates, safetyById);
  const symbols = symbolsFromAnalysis(analysis);
  const issueResults = (Array.isArray(issues) ? issues : []).map((issue) => {
    const files = matchIssueToFiles(issue, graphNodes, symbols);
    const matchedNodes = files
      .map(({ id }) => nodesById.get(id))
      .filter(Boolean);
    const blastRadius = matchedNodes.length
      ? Math.max(...matchedNodes.map((node) => metric(node.blastRadius)))
      : null;
    const maxComplexity = matchedNodes.length
      ? Math.max(...matchedNodes.map((node) => metric(node.complexity)))
      : null;
    const difficulty =
      blastRadius === null
        ? "unknown"
        : blastRadius <= 5 && maxComplexity <= 10
          ? "easy"
          : blastRadius <= 20
            ? "medium"
            : "hard";
    return {
      number: issue?.number ?? null,
      title: issue?.title ?? "",
      url: issue?.url ?? "",
      labels: Array.isArray(issue?.labels) ? issue.labels : [],
      files,
      blastRadius,
      difficulty,
    };
  });
  const difficultyRank = { easy: 0, medium: 1, hard: 2, unknown: 3 };
  issueResults.sort(
    (left, right) =>
      Number(right.files.length > 0) - Number(left.files.length > 0) ||
      difficultyRank[left.difficulty] - difficultyRank[right.difficulty] ||
      (left.number ?? Number.MAX_SAFE_INTEGER) -
        (right.number ?? Number.MAX_SAFE_INTEGER),
  );

  return { entry: entry?.id ?? null, path, safeStarters, issues: issueResults };
}

function isCandidate(node) {
  if (typeof node?.id !== "string") return false;
  const id = node.id;
  const segments = id.toLowerCase().split("/");
  return (
    CODE_EXTENSIONS.has(path.posix.extname(id).toLowerCase()) &&
    !/\.(?:test|spec)\./i.test(id) &&
    !/(?:^|\/)(?:__tests__|__mocks__|tests?)(?:\/|$)/i.test(id) &&
    !segments.some(
      (segment) =>
        segment === "dist" ||
        segment === "build" ||
        segment === "generated" ||
        segment.includes(".generated."),
    )
  );
}

function chooseEntry(candidates) {
  if (candidates.length === 0) return null;
  const roots = candidates.filter(
    (node) => metric(node.fanIn) === 0 && metric(node.fanOut) > 0,
  );
  const pool = roots.length ? roots : candidates;
  const preferred = (node) =>
    /^(?:index|main|app|server|cli)(?:\.[^.]+)?$/i.test(
      path.posix.basename(node.id),
    )
      ? 1
      : 0;
  return [...pool].sort(
    (left, right) =>
      preferred(right) - preferred(left) ||
      metric(right.fanOut) - metric(left.fanOut) ||
      left.id.localeCompare(right.id),
  )[0];
}

function buildReadingPath(entry, edges, candidatesById, safetyById) {
  const adjacency = new Map();
  for (const edge of Array.isArray(edges) ? edges : []) {
    if (typeof edge?.source !== "string" || typeof edge?.target !== "string")
      continue;
    const targets = adjacency.get(edge.source) ?? new Set();
    targets.add(edge.target);
    adjacency.set(edge.source, targets);
  }

  const steps = [];
  const visited = new Set([entry.id]);
  let currentLevel = [entry.id];
  let depth = 0;
  while (currentLevel.length > 0 && steps.length < 8) {
    const candidatesAtDepth = currentLevel
      .map((id) => candidatesById.get(id))
      .filter(Boolean)
      .sort(
        (left, right) =>
          (safetyById.get(right.id) ?? 0) - (safetyById.get(left.id) ?? 0) ||
          left.id.localeCompare(right.id),
      );
    for (const node of candidatesAtDepth) {
      steps.push({
        id: node.id,
        depth,
        reason:
          depth === 0
            ? `Entry point: imports ${metric(node.fanOut)} files`
            : `Low risk: ${metric(node.blastRadius)} files depend on it, complexity ${metric(node.complexity)}`,
        blastRadius: metric(node.blastRadius),
        complexity: metric(node.complexity),
        loc: metric(node.loc),
        safety: roundedSafety(safetyById.get(node.id) ?? 0),
      });
      if (steps.length >= 8) break;
    }

    const nextLevel = new Set();
    for (const id of currentLevel) {
      for (const target of adjacency.get(id) ?? []) {
        if (visited.has(target)) continue;
        visited.add(target);
        nextLevel.add(target);
      }
    }
    currentLevel = [...nextLevel].sort((left, right) =>
      left.localeCompare(right),
    );
    depth += 1;
  }
  return steps;
}

function chooseSafeStarters(candidates, safetyById) {
  const sorted = [...candidates].sort(
    (left, right) =>
      (safetyById.get(right.id) ?? 0) - (safetyById.get(left.id) ?? 0) ||
      left.id.localeCompare(right.id),
  );
  const withinBlastLimit = sorted.filter(
    (node) => metric(node.loc) >= 15 && metric(node.blastRadius) <= 5,
  );
  const selected = (
    withinBlastLimit.length >= 5
      ? withinBlastLimit
      : sorted.filter((node) => metric(node.loc) >= 15)
  ).slice(0, 5);
  return selected.map((node) => ({
    id: node.id,
    safety: roundedSafety(safetyById.get(node.id) ?? 0),
    reason: `Low risk: ${metric(node.blastRadius)} files depend on it, complexity ${metric(node.complexity)}`,
  }));
}

function calculateSafety(candidates) {
  const metrics = ["blastRadius", "complexity", "churn"];
  const ranks = new Map(
    metrics.map((key) => [key, percentileRanks(candidates, key)]),
  );
  const safety = new Map();
  for (const node of candidates) {
    const blastRank = ranks.get("blastRadius").get(node.id) ?? 0;
    const complexityRank = ranks.get("complexity").get(node.id) ?? 0;
    const churnRank = ranks.get("churn").get(node.id) ?? 0;
    const loc = metric(node.loc);
    const sizeFit =
      loc >= 20 && loc <= 250
        ? 1
        : loc < 20
          ? Math.max(0, loc / 20)
          : Math.max(0, (1000 - loc) / 750);
    const value =
      40 * (1 - blastRank) +
      25 * (1 - complexityRank) +
      15 * (1 - churnRank) +
      10 * sizeFit +
      10 * (metric(node.functionCount) > 0 ? 1 : 0);
    safety.set(node.id, value);
  }
  return safety;
}

function percentileRanks(nodes, key) {
  const values = nodes.map((node) => metric(node[key]));
  const uniqueValues = [...new Set(values)].sort((left, right) => left - right);
  const rankByValue = new Map(
    uniqueValues.map((value, index) => [
      value,
      uniqueValues.length <= 1 ? 0 : index / (uniqueValues.length - 1),
    ]),
  );
  return new Map(
    nodes.map((node) => [node.id, rankByValue.get(metric(node[key]))]),
  );
}

function symbolsFromAnalysis(analysis) {
  const symbols = [];
  for (const [filePath, fileAnalysis] of Object.entries(
    analysis?.files ?? {},
  )) {
    for (const symbol of fileAnalysis?.functions ?? []) {
      if (typeof symbol?.name !== "string") continue;
      symbols.push({ name: symbol.name, path: filePath });
    }
  }
  return symbols;
}

function metric(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function roundedSafety(value) {
  return Math.round(value * 10) / 10;
}

function containsLiteral(text, value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:^|[^A-Za-z0-9_.-])${escaped}(?=$|[^A-Za-z0-9_.-])`,
    "i",
  ).test(text);
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
