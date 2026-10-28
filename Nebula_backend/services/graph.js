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

const CODE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);
const MAX_FILE_SIZE = config.MAX_FILE_BYTES;
const MAX_CODE_FILES = config.MAX_CODE_FILES;
const BATCH_SIZE = config.PARSE_BATCH_SIZE;
const TOKEN_PATTERN = /[A-Za-z_$][\w$]*|\d+|[^\s\w]/g;

export async function buildGraph({
  id,
  dir,
  files,
  repoUrl,
  parseFileImpl = parseFile,
  getChurnImpl = getChurn,
  onProgress,
}) {
  let sha;
  try {
    sha = (await simpleGit(dir).revparse(["HEAD"])).trim();
  } catch (error) {
    // Archives have no Git metadata, so use their upload ID as a stable snapshot marker.
    if (typeof repoUrl !== "string" || !repoUrl.toLowerCase().endsWith(".zip"))
      throw error;
    sha = id;
  }
  const sortedCodeFiles = [...new Set(Array.isArray(files) ? files : [])]
    .filter(
      (file) =>
        typeof file === "string" &&
        CODE_EXTENSIONS.has(path.posix.extname(file).toLowerCase()),
    )
    .sort((left, right) => left.localeCompare(right));
  if (sortedCodeFiles.length === 0) throw new NebulaError("NO_SUPPORTED_FILES");
  const selectedFiles = sortedCodeFiles.slice(0, MAX_CODE_FILES);
  const warnings = [];

  let totalSourceBytes = 0;
  for (const file of selectedFiles) {
    const metadata = await stat(path.join(dir, ...file.split("/")));
    if (metadata.size <= MAX_FILE_SIZE) totalSourceBytes += metadata.size;
    if (totalSourceBytes > config.MAX_SOURCE_MB * 1024 * 1024) {
      throw new NebulaError("REPO_TOO_LARGE", {
        details: {
          sourceMb: Math.round((totalSourceBytes / (1024 * 1024)) * 10) / 10,
          limitMb: config.MAX_SOURCE_MB,
        },
      });
    }
  }

  onProgress?.({
    status: "parsing",
    progress: { done: 0, total: selectedFiles.length },
  });

  if (sortedCodeFiles.length > MAX_CODE_FILES) {
    warnings.push({
      file: sortedCodeFiles[MAX_CODE_FILES],
      message: `Repository has more than ${MAX_CODE_FILES} code files; only the first ${MAX_CODE_FILES} sorted paths were analyzed.`,
    });
  }

  const churnByFile = await getChurnImpl(dir);
  const aliases = await loadAliases(dir);
  const churnMap = await getChurn(dir);
  const parsedFiles = [];
  const analysis = { files: {}, aliases, churn: churnMap };

  for (let offset = 0; offset < selectedFiles.length; offset += BATCH_SIZE) {
    const batch = selectedFiles.slice(offset, offset + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((file) => readAndParseFile(dir, file, parseFileImpl)),
    );

    for (const result of results) {
      if (result.warning) {
        warnings.push(result.warning);
      } else {
        if (result.error)
          warnings.push({ file: result.path, message: result.error });
        analysis.files[result.path] = {
          functions: result.functions,
          calls: result.calls,
          bindings: result.bindings,
          complexity: result.complexity,
        };
        parsedFiles.push(result);
      }
    }
    onProgress?.({
      status: "parsing",
      progress: {
        done: Math.min(offset + batch.length, selectedFiles.length),
        total: selectedFiles.length,
      },
    });
  }

  onProgress?.({
    status: "graph",
    progress: { done: selectedFiles.length, total: selectedFiles.length },
  });

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
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const nodeIds = new Set(nodesById.keys());
  const edgeKeys = new Set();
  const edges = [];

  for (const { path: sourcePath, imports } of parsedFiles) {
    for (const { specifier } of imports) {
      const targetPath = resolveImport(specifier, sourcePath, nodeIds, {
        aliases,
      });
      if (!targetPath) continue;

      const edgeKey = `${sourcePath}\0${targetPath}`;
      if (edgeKeys.has(edgeKey)) continue;
      edgeKeys.add(edgeKey);
      edges.push({ source: sourcePath, target: targetPath, type: "import" });
    }
  }

  edges.sort(
    (left, right) =>
      left.source.localeCompare(right.source) ||
      left.target.localeCompare(right.target),
  );

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

  const reverseIndex = buildReverseIndex(edges);
  for (const node of nodes) {
    node.blastRadius = computeBlast(reverseIndex, node.id, {
      maxDepth: 4,
      cap: Number.POSITIVE_INFINITY,
    }).count;
  }
  analysis.reverseIndex = reverseIndex;

  return {
    graph: {
      repo: repoUrl,
      sha,
      nodes,
      edges,
      cycles,
      warnings,
    },
    analysis,
  };
}

async function readAndParseFile(dir, filePath, parseFileImpl) {
  const diskPath = path.join(dir, ...filePath.split("/"));
  const metadata = await stat(diskPath);

  if (metadata.size > MAX_FILE_SIZE) {
    return {
      path: filePath,
      warning: { file: filePath, message: "Skipped file larger than 1 MB." },
    };
  }

  const source = await readFile(diskPath, "utf8");
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

function countNonEmptyLines(source) {
  return source.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0)
    .length;
}
