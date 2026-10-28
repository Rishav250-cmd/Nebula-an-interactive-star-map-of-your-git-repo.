import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ANALYSIS_VERSION = 3;
export const MAX_CACHE_BYTES = 50 * 1024 * 1024;
export const MAX_CACHE_FILES = 30;

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const ANALYSIS_CACHE_DIR = path.resolve(moduleDirectory, "../.cache");

export function getAnalysisCachePath(
  repo,
  sha,
  { cacheDir = ANALYSIS_CACHE_DIR } = {},
) {
  const [owner, repository] = repositoryParts(repo);
  const filename = `${safeName(owner)}__${safeName(repository)}__${safeName(sha)}.json`;
  return path.join(cacheDir, filename);
}

export async function loadAnalysisCache(repo, sha, options = {}) {
  const cachePath = getAnalysisCachePath(repo, sha, options);
  let contents;
  try {
    contents = await readFile(cachePath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") logCacheError("read", error);
    return null;
  }

  try {
    const entry = JSON.parse(contents, mapReviver);
    if (
      entry?.version !== ANALYSIS_VERSION ||
      entry.repo !== repo ||
      entry.sha !== sha ||
      !entry.graph ||
      !entry.analysis
    ) {
      return null;
    }
    return entry;
  } catch (error) {
    logCacheError("parse", error);
    return null;
  }
}

export async function saveAnalysisCache(
  { repo, sha, graph, analysis },
  { cacheDir = ANALYSIS_CACHE_DIR } = {},
) {
  let temporaryPath;
  try {
    const entry = {
      version: ANALYSIS_VERSION,
      repo,
      sha,
      createdAt: new Date().toISOString(),
      graph,
      analysis,
    };
    const contents = JSON.stringify(entry, mapReplacer);
    if (Buffer.byteLength(contents, "utf8") > MAX_CACHE_BYTES) return false;

    await mkdir(cacheDir, { recursive: true });
    const cachePath = getAnalysisCachePath(repo, sha, { cacheDir });
    temporaryPath = `${cachePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, contents, { flag: "wx" });
    await rename(temporaryPath, cachePath);
    temporaryPath = null;
    await pruneAnalysisCache({ cacheDir });
    return true;
  } catch (error) {
    logCacheError("write", error);
    if (temporaryPath) {
      try {
        await rm(temporaryPath, { force: true });
      } catch (cleanupError) {
        logCacheError("temporary file cleanup", cleanupError);
      }
    }
    return false;
  }
}

export async function pruneAnalysisCache({
  cacheDir = ANALYSIS_CACHE_DIR,
} = {}) {
  try {
    const entries = await readdir(cacheDir, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          const filePath = path.join(cacheDir, entry.name);
          try {
            const metadata = await stat(filePath);
            return { filePath, modified: metadata.mtimeMs };
          } catch (error) {
            logCacheError("stat", error);
            return null;
          }
        }),
    );
    const sortedFiles = files
      .filter(Boolean)
      .sort(
        (left, right) =>
          right.modified - left.modified ||
          left.filePath.localeCompare(right.filePath),
      );

    await Promise.all(
      sortedFiles.slice(MAX_CACHE_FILES).map(async ({ filePath }) => {
        try {
          await rm(filePath, { force: true });
        } catch (error) {
          logCacheError("prune", error);
        }
      }),
    );
  } catch (error) {
    if (error?.code !== "ENOENT") logCacheError("prune", error);
  }
}

function repositoryParts(repo) {
  try {
    const parsed = new URL(repo);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const repository = (parts.at(-1) ?? "repository").replace(/\.git$/i, "");
    return [parts.at(-2) ?? parsed.hostname, repository];
  } catch {
    const parts = String(repo ?? "repository")
      .split(/[\\/]/)
      .filter(Boolean);
    return [
      parts.at(-2) ?? "owner",
      (parts.at(-1) ?? "repository").replace(/\.git$/i, ""),
    ];
  }
}

function safeName(value) {
  return String(value ?? "unknown").replace(/[^a-z\d._-]/gi, "_") || "unknown";
}

function mapReplacer(_key, value) {
  if (value instanceof Map) {
    return { __nebulaCacheType: "Map", entries: [...value.entries()] };
  }
  return value;
}

function mapReviver(_key, value) {
  if (value?.__nebulaCacheType === "Map" && Array.isArray(value.entries)) {
    return new Map(value.entries);
  }
  return value;
}

function logCacheError(action, error) {
  console.error(
    `Analysis cache ${action} failed:`,
    error?.message ?? String(error),
  );
}
