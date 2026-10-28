import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, realpath, readdir, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { NebulaError } from "./errors.js";
import { config } from "./config.js";
import { parseGitHubRepo } from "./github.js";

const preflightCache = new Map();
const PREFLIGHT_TTL_MS = 10 * 60 * 1000;
const PREFLIGHT_TIMEOUT_MS = 5 * 1000;

const skippedDirectories = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
]);
const skippedExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".pdf",
  ".woff",
  ".woff2",
]);

export function cloneLocationForUrl(url) {
  const id = repoIdFor(url);
  const dir = path.join(config.REPO_DIR, id);
  return { id, dir };
}

export function repoIdFor(url) {
  return createHash("sha1").update(url).digest("hex").slice(0, 10);
}

export async function cloneRepo(url, {
  runGitImpl = runGit,
  fetchImpl = fetch,
  now = Date.now,
  repoDir = config.REPO_DIR,
  maxRepoMb = config.MAX_REPO_MB,
  maxCloneMb = config.MAX_CLONE_MB,
  timeoutMs = config.CLONE_TIMEOUT_MS,
  watchdogIntervalMs = 2_000,
} = {}) {
  const id = repoIdFor(url);
  const dir = path.join(repoDir, id);
  let cloned = false;

  try {
    await preflightRepository(url, { fetchImpl, now, maxRepoMb });
    await rm(dir, { recursive: true, force: true });
    await mkdir(path.dirname(dir), { recursive: true });
    await cloneWithLimits(url, dir, {
      runGitImpl,
      maxCloneMb,
      timeoutMs,
      watchdogIntervalMs,
    });

    let sha;
    try {
      sha = (await runGitImpl(["rev-parse", "--verify", "HEAD"], { cwd: dir })).stdout.trim();
    } catch {
      throw new NebulaError("EMPTY_REPO");
    }
    if (!sha || (await listFiles(dir)).length === 0)
      throw new NebulaError("EMPTY_REPO");

    let defaultBranch = null;
    let shallow = false;
    try {
      defaultBranch = (await runGitImpl(["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd: dir })).stdout.trim() || null;
    } catch {
      defaultBranch = null;
    }
    try {
      shallow = (await runGitImpl(["rev-parse", "--is-shallow-repository"], { cwd: dir })).stdout.trim() === "true";
    } catch {
      shallow = false;
    }
    cloned = true;
    return { id, dir, sha, defaultBranch, shallow };
  } catch (error) {
    throw translateCloneError(error);
  } finally {
    if (!cloned) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function listFiles(root) {
  const files = [];
  const rootReal = await realpath(root);

  async function visit(directory, relativeDirectory = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? path.posix.join(relativeDirectory, entry.name)
        : entry.name;

      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      const currentMetadata = await lstat(fullPath);
      if (currentMetadata.isSymbolicLink()) continue;

      if (currentMetadata.isDirectory()) {
        if (!shouldIgnoreEntry(relativePath, true)) {
          const realPath = await realpath(fullPath);
          if (isPathInside(rootReal, realPath)) await visit(realPath, relativePath);
        }
      } else if (currentMetadata.isFile() && !shouldIgnoreEntry(relativePath, false)) {
        const realPath = await realpath(fullPath);
        if (!isPathInside(rootReal, realPath)) continue;
        const metadata = await lstat(realPath);
        if (metadata.isFile()) files.push(relativePath);
      }
    }
  }

  await visit(root);
  return files;
}

async function preflightRepository(url, { fetchImpl, now, maxRepoMb }) {
  const repository = parseGitHubRepo(url);
  if (!repository) return;
  const key = `${repository.owner.toLowerCase()}/${repository.repo.toLowerCase()}`;
  const currentTime = now();
  const cached = preflightCache.get(key);
  if (cached && cached.expiresAt > currentTime) {
    if (cached.status === 404) throw new NebulaError("REPO_NOT_FOUND");
    if (cached.status === 200 && cached.size > maxRepoMb * 1024)
      throw repositoryTooLarge(cached.size, maxRepoMb);
    return;
  }
  preflightCache.delete(key);

  const controller = new AbortController();
  let timeoutId;
  try {
    const headers = {
      Accept: "application/vnd.github+json",
      "User-Agent": "Nebula-App",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const request = fetchImpl(
      `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`,
      { headers, signal: controller.signal },
    );
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error("GitHub repository preflight timed out"));
      }, PREFLIGHT_TIMEOUT_MS);
    });
    const response = await Promise.race([request, timeout]);
    if (response.status === 404) {
      preflightCache.set(key, { status: 404, expiresAt: currentTime + PREFLIGHT_TTL_MS });
      throw new NebulaError("REPO_NOT_FOUND");
    }
    if (response.status === 403 || response.status === 429 || !response.ok) return;
    const payload = await response.json();
    const size = Number(payload?.size);
    if (!Number.isFinite(size) || size < 0) return;
    preflightCache.set(key, { status: 200, size, expiresAt: currentTime + PREFLIGHT_TTL_MS });
    if (size > maxRepoMb * 1024) throw repositoryTooLarge(size, maxRepoMb);
  } catch (error) {
    if (error instanceof NebulaError) throw error;
    // API outages and timeouts should not prevent a clone; disk monitoring still applies.
  } finally {
    clearTimeout(timeoutId);
  }
}

function repositoryTooLarge(sizeKb, limitMb) {
  return new NebulaError("REPO_TOO_LARGE", {
    details: { sizeMb: Math.round((sizeKb / 1024) * 10) / 10, limitMb },
  });
}

async function cloneWithLimits(url, dir, {
  runGitImpl,
  maxCloneMb,
  timeoutMs,
  watchdogIntervalMs,
}) {
  const controller = new AbortController();
  let failure = null;
  let stopped = false;
  let rejectFailure;
  const failurePromise = new Promise((_, reject) => { rejectFailure = reject; });
  const abortWith = (error) => {
    if (failure) return;
    failure = error;
    controller.abort();
    rejectFailure(error);
  };
  const args = ["clone", "--depth", "100", "--single-branch", "--no-tags", "--quiet", url, dir];
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };
  const clonePromise = Promise.resolve().then(() => runGitImpl(args, {
    env,
    signal: controller.signal,
    timeoutMs,
  }));
  clonePromise.catch(() => {});

  const timeoutId = setTimeout(
    () => abortWith(new NebulaError("CLONE_TIMEOUT")),
    timeoutMs,
  );
  const watchdogId = setInterval(async () => {
    if (failure || stopped) return;
    try {
      const sizeBytes = await directorySize(dir);
      if (sizeBytes > maxCloneMb * 1024 * 1024) {
        abortWith(new NebulaError("REPO_TOO_LARGE", {
          details: { sizeMb: Math.round((sizeBytes / (1024 * 1024)) * 10) / 10, limitMb: maxCloneMb },
        }));
      }
    } catch (error) {
      abortWith(error instanceof NebulaError ? error : new NebulaError("INTERNAL"));
    }
  }, watchdogIntervalMs);

  try {
    await Promise.race([clonePromise, failurePromise]);
    const sizeBytes = await directorySize(dir);
    if (sizeBytes > maxCloneMb * 1024 * 1024) {
      throw new NebulaError("REPO_TOO_LARGE", {
        details: { sizeMb: Math.round((sizeBytes / (1024 * 1024)) * 10) / 10, limitMb: maxCloneMb },
      });
    }
  } catch (error) {
    throw failure ?? translateCloneError(error);
  } finally {
    stopped = true;
    clearTimeout(timeoutId);
    clearInterval(watchdogId);
    controller.abort();
    await clonePromise.catch(() => {});
  }
}

async function directorySize(root) {
  let total = 0;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) total += await directorySize(entryPath);
    else if (entry.isFile()) total += (await lstat(entryPath)).size;
  }
  return total;
}

function translateCloneError(error) {
  if (error instanceof NebulaError) return error;
  const stderr = String(error?.stderr ?? error?.message ?? error ?? "").toLowerCase();
  if (/repository not found|not found|authentication failed|could not read username/.test(stderr))
    return new NebulaError("REPO_NOT_FOUND", { cause: error });
  if (error?.code === "ETIMEDOUT" || error?.code === "CLONE_TIMEOUT")
    return new NebulaError("CLONE_TIMEOUT", { cause: error });
  return new NebulaError("CLONE_FAILED", { hint: "Try again later.", cause: error });
}

function runGit(args, { cwd, env, signal, timeoutMs = config.CLONE_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timeoutId;
    let killId;
    let pendingError = null;
    const terminate = (reason) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      pendingError ??= reason ?? new Error("Git command aborted");
      child.kill("SIGTERM");
      killId = setTimeout(() => child.kill("SIGKILL"), 1000);
    };
    if (signal) {
      if (signal.aborted) terminate(signal.reason ?? new Error("Git command aborted"));
      else signal.addEventListener("abort", () => terminate(signal.reason), { once: true });
    }
    if (timeoutMs > 0) timeoutId = setTimeout(() => {
      const timeoutError = new Error("Git command timed out");
      timeoutError.code = "ETIMEDOUT";
      terminate(timeoutError);
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => {
      clearTimeout(timeoutId);
      clearTimeout(killId);
      reject(pendingError ?? error);
    });
    child.once("close", (code) => {
      clearTimeout(timeoutId);
      clearTimeout(killId);
      if (pendingError) reject(pendingError);
      else if (code === 0) resolve({ stdout, stderr });
      else {
        const error = new Error(stderr.trim() || `git exited with status ${code}`);
        error.stderr = stderr;
        error.code = code;
        reject(error);
      }
    });
  });
}

function isPathInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function buildTree(files) {
  const tree = {};

  for (const file of files) {
    const parts = file.split("/").filter(Boolean);
    let current = tree;

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const isFile = index === parts.length - 1;

      if (!Object.hasOwn(current, part)) {
        Object.defineProperty(current, part, {
          value: isFile ? null : {},
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }

      if (!isFile) current = current[part];
    }
  }

  return tree;
}

export function shouldIgnoreEntry(relativePath, isDirectory = false) {
  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  const directoryParts = isDirectory ? parts : parts.slice(0, -1);
  if (directoryParts.some((part) => skippedDirectories.has(part))) return true;

  const filename = parts.at(-1) ?? "";
  const lowerName = filename.toLowerCase();
  const extension = path.extname(lowerName);

  return (
    !isDirectory &&
    (lowerName.endsWith(".lock") ||
      lowerName.endsWith("-lock.json") ||
      lowerName.endsWith(".min.js") ||
      skippedExtensions.has(extension))
  );
}
