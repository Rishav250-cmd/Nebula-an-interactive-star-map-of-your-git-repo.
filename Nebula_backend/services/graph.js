import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { simpleGit } from "simple-git";
import { getChurn } from "./churn.js";
import { buildReverseIndex, computeBlast } from "./blast.js";
import { findCycles } from "./cycles.js";
import { parseFile } from "./parser.js";
import { loadAliases, resolveImport } from "./resolver.js";
import { config } from "./config.js";
import { NebulaError } from "./errors.js";
import { elapsedMs, logTiming, startTimer } from "./timing.js";

const CODE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);
const TIER_TWO_NAMES = new Set([
  "test", "tests", "__tests__", "spec", "example", "examples", "docs", "doc",
  "benchmark", "benchmarks", "fixtures", "e2e", "cypress", "stories", "__mocks__",
  "mocks", "scripts",
]);
const ALWAYS_EXCLUDED_NAMES = new Set([
  "vendor", "third_party", "node_modules", "dist", "build", "out", "target",
  "coverage", ".next", "bower_components",
]);
const TOKEN_PATTERN = /[A-Za-z_$][\w$]*|\d+|[^\s\w]/g;

export async function buildGraph({
  id,
  dir,
  files,
  repoUrl,
  parseFileImpl = parseFile,
  getChurnImpl = getChurn,
  onProgress,
  onTiming,
}) {
  const startedAt = Date.now();
  const snapshot = await getHistory(dir, repoUrl, id);
  const history = snapshot.history;
  const filePaths = [...new Set(Array.isArray(files) ? files : [])]
    .filter((file) => typeof file === "string" && !isAlwaysExcluded(file));
  const languages = countExtensions(filePaths);
  const sortedCodeFiles = filePaths
    .filter((file) => CODE_EXTENSIONS.has(path.posix.extname(file).toLowerCase()))
    .sort((left, right) => tierFor(left) - tierFor(right) || left.localeCompare(right));

  if (sortedCodeFiles.length === 0) {
    throw new NebulaError("NO_SUPPORTED_FILES", {
      hint: "Nebula currently analyzes JavaScript and TypeScript",
      details: { languages: languages.slice(0, 5) },
    });
  }

  const skipped = { large: 0, generated: 0, binary: 0 };
  const warnings = [];
  const sizedFiles = [];
  for (const file of sortedCodeFiles) {
    const metadata = await stat(path.join(dir, ...file.split("/")));
    if (metadata.size > config.MAX_FILE_BYTES) {
      skipped.large += 1;
      warnings.push({ file, message: "Skipped file larger than 1 MB." });
      continue;
    }
    sizedFiles.push({ file, size: metadata.size });
  }

  const selectedFiles = [];
  const maxSourceBytes = config.MAX_SOURCE_MB * 1024 * 1024;
  let totalSourceBytes = 0;
  let truncatedReason = null;
  for (let index = 0; index < sizedFiles.length; index += 1) {
    if (selectedFiles.length >= config.MAX_CODE_FILES) {
      if (index < sizedFiles.length) truncatedReason = "file-cap";
      break;
    }
    const candidate = sizedFiles[index];
    if (totalSourceBytes + candidate.size > maxSourceBytes) {
      truncatedReason = "source-size";
      break;
    }
    selectedFiles.push(candidate.file);
    totalSourceBytes += candidate.size;
  }
  if (truncatedReason === "file-cap") {
    warnings.push({
      file: sizedFiles[selectedFiles.length]?.file ?? sortedCodeFiles[selectedFiles.length],
      message: `Repository has more than ${config.MAX_CODE_FILES} code files; only the first ${config.MAX_CODE_FILES} sorted paths were analyzed.`,
    });
  }

  onProgress?.({ status: "parsing", progress: { done: 0, total: selectedFiles.length } });

  const churnStartedAt = startTimer();
  const churnMap = await getChurnImpl(dir);
  reportTiming("churn", elapsedMs(churnStartedAt));
  const aliases = await loadAliases(dir);
  const parsedFiles = [];
  const analysis = { files: {}, aliases, churn: churnMap };
  let processedCount = 0;
  let memoryLimited = false;

  const parseStartedAt = startTimer();
  for (let offset = 0; offset < selectedFiles.length; offset += config.PARSE_BATCH_SIZE) {
    const batch = selectedFiles.slice(offset, offset + config.PARSE_BATCH_SIZE);
    const results = await Promise.all(
      batch.map((file) => readAndParseFile(dir, file, parseFileImpl)),
    );

    for (const result of results) {
      processedCount += 1;
      if (result.skip === "large") {
        skipped.large += 1;
        warnings.push({ file: result.path, message: "Skipped file larger than 1 MB." });
        continue;
      }
      if (result.skip === "generated") {
        skipped.generated += 1;
        continue;
      }
      if (result.skip === "binary") {
        skipped.binary += 1;
        continue;
      }
      if (result.error) warnings.push({ file: result.path, message: result.error });
      analysis.files[result.path] = {
        functions: result.functions,
        calls: result.calls,
        bindings: result.bindings,
        complexity: result.complexity,
      };
      parsedFiles.push(result);
    }
    onProgress?.({
      status: "parsing",
      progress: { done: processedCount, total: selectedFiles.length },
    });

    if (
      processedCount < selectedFiles.length
      && process.memoryUsage().rss > config.MAX_RSS_MB * 1024 * 1024
    ) {
      memoryLimited = true;
      break;
    }
  }
  reportTiming("parse", elapsedMs(parseStartedAt), { files: processedCount });

  if (memoryLimited) truncatedReason = "memory";
  onProgress?.({
    status: "graph",
    progress: { done: processedCount, total: selectedFiles.length },
  });

  const complexityStartedAt = startTimer();
  const nodes = parsedFiles.map(({ path: filePath, source }) => ({
    id: filePath,
    folder: filePath.includes("/") ? filePath.split("/")[0] : ".",
    loc: countNonEmptyLines(source),
    tokens: source.match(TOKEN_PATTERN)?.length ?? 0,
    complexity: analysis.files[filePath].complexity,
    functionCount: analysis.files[filePath].functions.filter(
      (fn) => fn.kind !== "class",
    ).length,
    churn: churnMap.get(filePath) ?? 0,
    healthScore: null,
    isGodFile: false,
    inCycle: false,
    fanIn: 0,
    fanOut: 0,
  }));
  reportTiming("complexity", elapsedMs(complexityStartedAt), { files: nodes.length });
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const nodeIds = new Set(nodesById.keys());
  const edgeKeys = new Set();
  const edges = [];

  const importsStartedAt = startTimer();
  for (const { path: sourcePath, imports } of parsedFiles) {
    for (const { specifier } of imports) {
      const targetPath = resolveImport(specifier, sourcePath, nodeIds, { aliases });
      if (!targetPath) continue;
      const edgeKey = `${sourcePath}\0${targetPath}`;
      if (edgeKeys.has(edgeKey)) continue;
      edgeKeys.add(edgeKey);
      edges.push({ source: sourcePath, target: targetPath, type: "import" });
    }
  }

  edges.sort(
    (left, right) => left.source.localeCompare(right.source) || left.target.localeCompare(right.target),
  );
  reportTiming("import resolution", elapsedMs(importsStartedAt), { edges: edges.length });
  const cyclesStartedAt = startTimer();
  const cycles = findCycles(nodes, edges);
  const cycleByFile = new Map();
  cycles.forEach((cycle, cycleIndex) => {
    for (const file of cycle) {
      cycleByFile.set(file, cycleIndex);
      nodesById.get(file).inCycle = true;
    }
  });
  for (const edge of edges) {
    const sourceCycle = cycleByFile.get(edge.source);
    const targetCycle = cycleByFile.get(edge.target);
    edge.inCycle = sourceCycle !== undefined && sourceCycle === targetCycle;
    nodesById.get(edge.source).fanOut += 1;
    nodesById.get(edge.target).fanIn += 1;
  }
  reportTiming("cycles", elapsedMs(cyclesStartedAt), { cycles: cycles.length });

  const reverseIndex = buildReverseIndex(edges);
  for (const node of nodes) {
    node.blastRadius = computeBlast(reverseIndex, node.id, {
      maxDepth: 4,
      cap: Number.POSITIVE_INFINITY,
    }).count;
  }
  analysis.reverseIndex = reverseIndex;

  const parsedPaths = new Set(parsedFiles.map(({ path: filePath }) => filePath));
  const excludedTests = sortedCodeFiles.filter(
    (file) => tierFor(file) === 2 && !parsedPaths.has(file),
  ).length;
  const meta = {
    totalCodeFiles: sortedCodeFiles.length,
    analyzedFiles: nodes.length,
    truncated: truncatedReason !== null,
    truncatedReason,
    excludedTests,
    skipped,
    languages,
    noEdges: nodes.length > 0 && edges.length === 0,
    churnAvailable: history.depth > 0 && !history.shallow,
    history,
    stale: false,
    analysisMs: Date.now() - startedAt,
  };

  function reportTiming(stage, durationMs, extra) {
    if (onTiming) onTiming(stage, durationMs, extra);
    else logTiming(id, stage, durationMs, extra);
  }

  return {
    graph: { repo: repoUrl, sha: snapshot.sha, nodes, edges, cycles, warnings, meta },
    analysis,
  };
}

async function getHistory(dir, repoUrl, id) {
  try {
    const git = simpleGit(dir);
    const [sha, shallowValue, depthValue] = await Promise.all([
      git.revparse(["HEAD"]),
      git.raw(["rev-parse", "--is-shallow-repository"]),
      git.raw(["rev-list", "--count", "HEAD"]),
    ]);
    return {
      sha: sha.trim(),
      history: {
        shallow: shallowValue.trim().toLowerCase() === "true",
        depth: Number.parseInt(depthValue.trim(), 10) || 0,
      },
    };
  } catch (error) {
    if (typeof repoUrl === "string" && repoUrl.toLowerCase().endsWith(".zip")) {
      return { sha: id, history: { shallow: false, depth: 0 } };
    }
    throw error;
  }
}

async function readAndParseFile(dir, filePath, parseFileImpl) {
  const diskPath = path.join(dir, ...filePath.split("/"));
  const metadata = await stat(diskPath);
  if (metadata.size > config.MAX_FILE_BYTES) return { path: filePath, skip: "large" };

  const buffer = await readFile(diskPath);
  if (buffer.subarray(0, 1000).includes(0)) return { path: filePath, skip: "binary" };
  const source = buffer.toString("utf8").replace(/^\uFEFF/, "");
  if (isGeneratedSource(source)) return { path: filePath, skip: "generated" };

  const parsed = parseFileImpl(source, filePath);
  return {
    path: filePath,
    source,
    imports: parsed.imports,
    bindings: parsed.bindings,
    functions: parsed.functions,
    calls: parsed.calls,
    complexity: parsed.complexity,
    error: parsed.error,
  };
}

function isGeneratedSource(source) {
  if (/@generated|DO NOT EDIT/i.test(source.slice(0, 300))) return true;
  const lines = source.split(/\r\n|\r|\n/);
  if (lines.some((line) => line.length > 5000)) return true;
  const averageLineLength = lines.reduce((sum, line) => sum + line.length, 0) / Math.max(lines.length, 1);
  return averageLineLength > 400;
}

function tierFor(filePath) {
  const segments = filePath.replaceAll("\\", "/").split("/").map((segment) => segment.toLowerCase());
  const fileName = segments.at(-1) ?? "";
  const stem = fileName.replace(/\.[^.]+$/, "");
  if (segments.some((segment) => TIER_TWO_NAMES.has(segment))) return 2;
  if (TIER_TWO_NAMES.has(stem)) return 2;
  if (stem.split(/[._-]+/).some((part) => TIER_TWO_NAMES.has(part))) return 2;
  if (/\.(?:test|spec|example|benchmark|fixture|stories|mock|e2e|cypress)\./i.test(fileName)) return 2;
  return 1;
}

function isAlwaysExcluded(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  const segments = normalized.split("/").filter(Boolean).map((segment) => segment.toLowerCase());
  const name = segments.at(-1) ?? "";
  return segments.some((segment) => ALWAYS_EXCLUDED_NAMES.has(segment))
    || /\.(?:min|bundle|chunk)(?:\.[^.]+)?$/i.test(name);
}

function countExtensions(filePaths) {
  const counts = new Map();
  for (const file of filePaths) {
    const ext = path.posix.extname(file).toLowerCase() || "(no extension)";
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  return topExtensions(counts, Number.POSITIVE_INFINITY);
}

function topExtensions(counts, limit) {
  return [...counts.entries()]
    .map(([ext, count]) => ({ ext, count }))
    .sort((left, right) => right.count - left.count || left.ext.localeCompare(right.ext))
    .slice(0, limit);
}

function countNonEmptyLines(source) {
  return source.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0).length;
}
