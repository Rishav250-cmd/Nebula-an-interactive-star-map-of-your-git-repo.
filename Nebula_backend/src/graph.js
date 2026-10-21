import path from "node:path";

const SOURCE_EXTENSIONS = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"];
const SOURCE_EXTENSION_SET = new Set(SOURCE_EXTENSIONS);
const MAX_SOURCE_FILES = 200;
const MAX_SOURCE_FILE_BYTES = 512 * 1024;
const MAX_CONCURRENT_DOWNLOADS = 8;
const GITHUB_API = "https://api.github.com";

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

export async function buildRepositoryGraph(repoUrl, { fetchImpl = fetch } = {}) {
  const { owner, repository } = parseGitHubRepoUrl(repoUrl);
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
  const repoInfo = await fetchGitHubJson(`${GITHUB_API}${repoPath}`, fetchImpl);

  if (!repoInfo.default_branch) {
    throw new GraphError(502, "GitHub did not return a default branch for this repository.");
  }

  const branch = await fetchGitHubJson(
    `${GITHUB_API}${repoPath}/branches/${encodeURIComponent(repoInfo.default_branch)}`,
    fetchImpl,
  );
  const commitSha = branch.commit?.sha;
  const treeSha = branch.commit?.commit?.tree?.sha;

  if (!commitSha || !treeSha) {
    throw new GraphError(502, "GitHub did not return the repository's latest commit tree.");
  }

  const tree = await fetchGitHubJson(
    `${GITHUB_API}${repoPath}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`,
    fetchImpl,
  );

  if (tree.truncated) {
    throw new GraphError(413, "This repository is too large to analyze in one request.");
  }

  const sourceEntries = (tree.tree ?? []).filter(isSupportedSourceEntry);
  if (sourceEntries.length > MAX_SOURCE_FILES) {
    throw new GraphError(413, `This repository has more than ${MAX_SOURCE_FILES} JavaScript or TypeScript files to analyze.`);
  }

  const sourceFiles = await mapWithConcurrency(
    sourceEntries,
    MAX_CONCURRENT_DOWNLOADS,
    async (entry) => ({ path: entry.path, source: await fetchRawSource(owner, repository, commitSha, entry.path, fetchImpl) }),
  );
  const knownPaths = new Set(sourceFiles.map((file) => file.path));
  const nodes = sourceFiles
    .map(({ path: filePath }) => ({
      id: filePath,
      label: path.posix.basename(filePath),
      path: filePath,
      language: path.posix.extname(filePath).slice(1),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const edges = [];

  for (const { path: sourcePath, source } of sourceFiles) {
    for (const specifier of extractImportSpecifiers(source)) {
      const target = resolveRelativeImport(sourcePath, specifier, knownPaths);
      if (target) edges.push({ id: `${sourcePath}->${target}`, source: sourcePath, target });
    }
  }

  edges.sort((left, right) => left.id.localeCompare(right.id));

  return {
    repository: {
      name: repoInfo.full_name ?? `${owner}/${repository}`,
      url: repoInfo.html_url ?? `https://github.com/${owner}/${repository}`,
      defaultBranch: repoInfo.default_branch,
      commit: commitSha,
    },
    nodes,
    edges,
  };
}

function isSupportedSourceEntry(entry) {
  if (entry.type !== "blob" || !entry.path || (entry.size ?? 0) > MAX_SOURCE_FILE_BYTES) return false;
  if (!SOURCE_EXTENSION_SET.has(path.posix.extname(entry.path).toLowerCase())) return false;

  return !entry.path.split("/").some((segment) => [".git", "node_modules", "dist", "build", "coverage"].includes(segment));
}

async function fetchGitHubJson(url, fetchImpl) {
  const response = await fetchRemote(url, fetchImpl, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Nebula-backend",
    },
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new GraphError(502, "GitHub returned an invalid response.");
  }

  if (!response.ok) {
    const limited = response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0";
    if (limited) throw new GraphError(429, "GitHub's API rate limit was reached. Try again later.");
    if (response.status === 404) throw new GraphError(404, "Repository not found or not publicly accessible.");
    throw new GraphError(502, "GitHub could not provide repository metadata.");
  }

  return data;
}

async function fetchRawSource(owner, repository, commitSha, filePath, fetchImpl) {
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const url = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/${encodeURIComponent(commitSha)}/${encodedPath}`;
  const response = await fetchRemote(url, fetchImpl, {});

  if (!response.ok) throw new GraphError(502, "GitHub could not provide one of the repository source files.");

  return response.text();
}

async function fetchRemote(url, fetchImpl, options) {
  try {
    const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return response;
    return response;
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      throw new GraphError(504, "A request to GitHub timed out.");
    }
    throw new GraphError(502, "Could not connect to GitHub.");
  }
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
