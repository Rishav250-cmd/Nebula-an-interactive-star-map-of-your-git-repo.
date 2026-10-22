import { readFile } from "node:fs/promises";
import path from "node:path";
import { listFiles } from "../services/ingest.js";
import { countLines } from "../utils/countLines.js";

const SOURCE_EXTENSIONS = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"];
const SOURCE_EXTENSION_SET = new Set(SOURCE_EXTENSIONS);
const MAX_CONCURRENT_READS = 8;
const TOKEN_PATTERN = /[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|===|!==|=>|==|!=|<=|>=|\+\+|--|&&|\|\||\?\?|\?\.|\*\*|[^\s]/g;

export class GraphError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "GraphError";
    this.statusCode = statusCode;
  }
}

export function parseGitHubRepoUrl(repoUrl) {
  let parsedUrl;

  try {
    parsedUrl = new URL(repoUrl);
  } catch {
    throw new GraphError(400, "repoUrl must be a valid public GitHub repository URL.");
  }

  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.hostname !== "github.com" ||
    parsedUrl.username ||
    parsedUrl.password
  ) {
    throw new GraphError(400, "repoUrl must be an HTTPS URL on github.com.");
  }

  const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
  if (pathParts.length !== 2) {
    throw new GraphError(400, "repoUrl must point to a repository, such as https://github.com/owner/repo.");
  }

  const [owner, rawRepository] = pathParts;
  const repository = rawRepository.replace(/\.git$/i, "");
  const validSegment = /^[A-Za-z0-9_.-]+$/;

  if (!validSegment.test(owner) || !validSegment.test(repository)) {
    throw new GraphError(400, "repoUrl contains an invalid owner or repository name.");
  }

  return { owner, repository };
}

export function extractImportSpecifiers(source) {
  const patterns = [
    /\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  const specifiers = new Set();

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      specifiers.add(match[1]);
    }
  }

  return [...specifiers];
}

// Keep syntax extraction behind one result shape so later analysis can add symbols and calls.
export function parseSourceFile(source) {
  return { imports: extractImportSpecifiers(source) };
}

export function resolveRelativeImport(sourcePath, specifier, knownPaths) {
  if (!specifier.startsWith(".")) return null;

  const basePath = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), specifier));
  if (basePath === ".." || basePath.startsWith("../") || path.posix.isAbsolute(basePath)) return null;

  const candidates = [basePath];
  const extension = path.posix.extname(basePath);

  if (extension) {
    const stem = basePath.slice(0, -extension.length);
    candidates.push(...SOURCE_EXTENSIONS.map((candidateExtension) => `${stem}${candidateExtension}`));
  } else {
    candidates.push(...SOURCE_EXTENSIONS.map((candidateExtension) => `${basePath}${candidateExtension}`));
    candidates.push(...SOURCE_EXTENSIONS.map((candidateExtension) => `${basePath}/index${candidateExtension}`));
  }

  return candidates.find((candidate) => knownPaths.has(candidate)) ?? null;
}

export async function buildRepositoryGraph(
  repoUrl,
  repositoryDir,
  { sha, listFilesImpl = listFiles, readFileImpl = readFile } = {},
) {
  const { owner, repository } = parseGitHubRepoUrl(repoUrl);
  if (typeof sha !== "string" || !sha.trim()) {
    throw new GraphError(500, "A cloned repository commit SHA is required to build its graph.");
  }

  const sourcePaths = (await listFilesImpl(repositoryDir))
    .filter((filePath) => SOURCE_EXTENSION_SET.has(path.posix.extname(filePath).toLowerCase()))
    .sort((left, right) => left.localeCompare(right));
  const knownPaths = new Set(sourcePaths);
  const parsedFiles = await mapWithConcurrency(sourcePaths, MAX_CONCURRENT_READS, async (filePath) => {
    const diskPath = path.join(repositoryDir, ...filePath.split("/"));
    const source = await readFileImpl(diskPath, "utf8");

    return {
      path: filePath,
      loc: countLines(source),
      tokens: countTokens(source),
      imports: parseSourceFile(source).imports,
    };
  });

  const nodes = parsedFiles.map(({ path: filePath, loc, tokens }) => ({
    id: filePath,
    folder: filePath.includes("/") ? filePath.split("/")[0] : ".",
    loc,
    tokens,
    complexity: 0,
    churn: 0,
    healthScore: null,
    isGodFile: false,
    inCycle: false,
    fanIn: 0,
    fanOut: 0,
  }));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const edgeKeys = new Set();
  const edges = [];

  for (const { path: sourcePath, imports } of parsedFiles) {
    for (const specifier of imports) {
      const targetPath = resolveRelativeImport(sourcePath, specifier, knownPaths);
      if (!targetPath) continue;

      const edgeKey = `${sourcePath}\0${targetPath}`;
      if (edgeKeys.has(edgeKey)) continue;
      edgeKeys.add(edgeKey);
      edges.push({ source: sourcePath, target: targetPath, type: "import" });
      nodesById.get(sourcePath).fanOut += 1;
      nodesById.get(targetPath).fanIn += 1;
    }
  }

  edges.sort((left, right) => left.source.localeCompare(right.source) || left.target.localeCompare(right.target));

  return {
    repo: `${owner}/${repository}`,
    sha: sha.trim(),
    nodes,
    edges,
    cycles: [],
  };
}

function countTokens(source) {
  return source.match(TOKEN_PATTERN)?.length ?? 0;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index]);
      }
    }),
  );

  return results;
}
