import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const backendDirectory = path.resolve(moduleDirectory, "..");

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

let cpuCount = 2;
try {
  cpuCount = os.availableParallelism?.() ?? os.cpus().length;
} catch {
  // Keep parsing concurrency small on hosts that cannot report CPUs.
}
const defaultParserWorkers = Math.max(1, Math.min(cpuCount, 2));

export const config = Object.freeze({
  PORT: numberFromEnv("PORT", 5001),
  CORS_ORIGIN: process.env.CORS_ORIGIN || "*",
  REPO_DIR: path.resolve(process.env.REPO_DIR || path.join(os.tmpdir(), "nebula")),
  REPO_DIR_EXPLICIT: Boolean(process.env.REPO_DIR?.trim()),
  CACHE_DIR: path.resolve(process.env.CACHE_DIR || path.join(backendDirectory, ".cache")),
  MAX_CODE_FILES: numberFromEnv("MAX_CODE_FILES", 2000),
  PARSE_BATCH_SIZE: numberFromEnv("PARSE_BATCH_SIZE", 50),
  PARSER_WORKERS: numberFromEnv("PARSER_WORKERS", defaultParserWorkers),
  MAX_FILE_BYTES: numberFromEnv("MAX_FILE_BYTES", 1048576),
  MAX_ANALYSIS_FILE_BYTES: numberFromEnv("MAX_ANALYSIS_FILE_KB", 300) * 1024,
  MAX_SOURCE_MB: numberFromEnv("MAX_SOURCE_MB", 40),
  MAX_UPLOAD_MB: numberFromEnv("MAX_UPLOAD_MB", 50),
  MAX_ARCHIVE_ENTRIES: numberFromEnv("MAX_ARCHIVE_ENTRIES", 20000),
  MAX_UNCOMPRESSED_MB: numberFromEnv("MAX_UNCOMPRESSED_MB", 200),
  MAX_CACHE_MB: numberFromEnv("MAX_CACHE_MB", 50),
  MAX_CACHE_FILES: numberFromEnv("MAX_CACHE_REPOS", numberFromEnv("MAX_CACHE_FILES", 30)),
  MAX_CACHE_DISK_MB: numberFromEnv("MAX_CACHE_DISK_MB", 250),
  MAX_REPO_MB: numberFromEnv("MAX_REPO_MB", 250),
  MAX_CLONE_MB: numberFromEnv("MAX_CLONE_MB", 400),
  CLONE_TIMEOUT_MS: numberFromEnv("CLONE_TIMEOUT_MS", 90000),
  JOB_TIMEOUT_MS: numberFromEnv("JOB_TIMEOUT_MS", 180000),
  MAX_CONCURRENT_JOBS: numberFromEnv("MAX_CONCURRENT_JOBS", 2),
  MAX_QUEUE: numberFromEnv("MAX_QUEUE", 4),
  MAX_REPOS: numberFromEnv("MAX_REPOS", 4),
  REPO_TTL_MIN: numberFromEnv("REPO_TTL_MIN", 60),
  MAX_RSS_MB: numberFromEnv("MAX_RSS_MB", 420),
  MAX_HEAP_MB: numberFromEnv("MAX_HEAP_MB", 350),
  RATE_LIMIT_MAX: numberFromEnv("RATE_LIMIT_MAX", 12),
  RATE_LIMIT_WINDOW_MS: numberFromEnv("RATE_LIMIT_WINDOW_MS", 600000),
});
