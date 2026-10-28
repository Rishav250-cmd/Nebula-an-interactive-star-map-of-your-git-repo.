import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { NebulaError } from "./errors.js";

const analyses = new Map();
const knownIds = new Map();
let idsCacheDir = config.CACHE_DIR;
let idsWriteQueue = Promise.resolve();
let maintenanceTimer = null;

export async function initializeStore({ cacheDir = config.CACHE_DIR } = {}) {
  idsCacheDir = cacheDir;
  try {
    const serialized = await readFile(path.join(cacheDir, "ids.json"), "utf8");
    const entries = JSON.parse(serialized);
    if (entries && typeof entries === "object" && !Array.isArray(entries)) {
      for (const [id, entry] of Object.entries(entries)) {
        if (typeof entry?.url !== "string") continue;
        knownIds.set(id, {
          url: entry.url,
          sha: typeof entry.sha === "string" ? entry.sha : null,
          at: Number(entry.at) || 0,
        });
      }
      trimKnownIds();
    }
  } catch (error) {
    if (error?.code !== "ENOENT") console.error("Could not load repository id map:", safeErrorMessage(error));
  }
}

export function storeAnalysis({
  id,
  dir,
  url,
  sha = null,
  graph = null,
  analysis: graphAnalysis = null,
  cloneInfo = null,
  job = null,
}) {
  const entry = analyses.get(id) ?? {};
  Object.assign(entry, {
    id,
    dir,
    url,
    sha: sha ?? graph?.sha ?? entry.sha ?? null,
    graph: graph ?? null,
    analysis: graphAnalysis ?? null,
    cloneInfo: cloneInfo ?? entry.cloneInfo ?? null,
    onboardingCache: null,
    lastAccess: Date.now(),
    job: job ?? entry.job ?? {
      status: "ready",
      error: null,
      progress: { done: 0, total: 0 },
    },
  });
  analyses.set(id, entry);
  if (typeof url === "string") {
    rememberId(id, url, entry.sha);
    queueIdsWrite();
  }
  queueRepositoryPrune();
  return entry;
}

export function getAnalysis(id) {
  const entry = analyses.get(id) ?? null;
  if (entry) entry.lastAccess = Date.now();
  return entry;
}

export function getRepositoryCount() {
  return analyses.size;
}

export function unknownIdError(id) {
  const stored = knownIds.get(id);
  return new NebulaError("UNKNOWN_ID", {
    hint: "Analyze the repository again",
    details: stored?.url ? { url: stored.url } : null,
  });
}

export function getKnownRepositoryId(id) {
  return knownIds.get(id) ?? null;
}

export function cacheAnalysisGraph(id, graph, graphAnalysis = null) {
  const entry = analyses.get(id);
  if (!entry) return null;
  entry.graph = graph;
  entry.analysis = graphAnalysis;
  entry.sha = graph?.sha ?? entry.sha ?? null;
  entry.lastAccess = Date.now();
  if (entry.url) {
    rememberId(id, entry.url, entry.sha);
    queueIdsWrite();
  }
  return entry;
}

export function updateAnalysisJob(id, job) {
  const analysis = analyses.get(id);
  if (!analysis) return null;
  analysis.job = {
    ...analysis.job,
    ...job,
    progress: job?.progress
      ? { ...job.progress }
      : { ...analysis.job.progress },
  };
  return analysis.job;
}

export async function flushIdsMap() {
  await idsWriteQueue;
}

export async function clearRepositoryDirectory({ repoDir = config.REPO_DIR } = {}) {
  await mkdir(repoDir, { recursive: true });
  const entries = await readdir(repoDir, { withFileTypes: true });
  await Promise.all(entries.map((entry) =>
    rm(path.join(repoDir, entry.name), { recursive: entry.isDirectory(), force: true }),
  ));
}

export async function pruneRepositoryStore({
  maxRepos = config.MAX_REPOS,
  now = Date.now(),
  ttlMinutes = config.REPO_TTL_MIN,
} = {}) {
  if (config.REPO_DIR_EXPLICIT) return;
  const expiry = ttlMinutes * 60 * 1000;
  const expired = [...analyses.values()].filter((entry) =>
    entry.dir && !isJobActive(entry) && now - (entry.lastAccess ?? 0) >= expiry,
  );
  for (const entry of expired) await removeAnalysis(entry);

  const withDirectories = [];
  for (const entry of analyses.values()) {
    if (!entry.dir) continue;
    try {
      const info = await stat(entry.dir);
      if (info.isDirectory()) withDirectories.push(entry);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  withDirectories.sort((left, right) => (left.lastAccess ?? 0) - (right.lastAccess ?? 0));
  let excess = withDirectories.length - maxRepos;
  for (const entry of withDirectories) {
    if (excess <= 0) break;
    if (isJobActive(entry)) continue;
    await removeAnalysis(entry);
    excess -= 1;
  }
}

export function startStoreMaintenance({ intervalMs = 60_000 } = {}) {
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  maintenanceTimer = setInterval(() => {
    pruneRepositoryStore().catch((error) => {
      console.error("Repository storage cleanup failed:", safeErrorMessage(error));
    });
  }, intervalMs);
  maintenanceTimer.unref?.();
  return maintenanceTimer;
}

export function stopStoreMaintenance() {
  if (!maintenanceTimer) return;
  clearInterval(maintenanceTimer);
  maintenanceTimer = null;
}

async function removeAnalysis(entry) {
  await rm(entry.dir, { recursive: true, force: true });
  if (analyses.get(entry.id) === entry) analyses.delete(entry.id);
}

function isJobActive(entry) {
  return ["cloning", "queued", "listing", "parsing", "graph"].includes(entry.job?.status);
}

function rememberId(id, url, sha) {
  knownIds.set(id, { url, sha: sha ?? null, at: Date.now() });
  trimKnownIds();
}

function trimKnownIds() {
  if (knownIds.size <= 200) return;
  const oldestFirst = [...knownIds.entries()].sort((left, right) => left[1].at - right[1].at);
  for (const [id] of oldestFirst.slice(0, knownIds.size - 200)) knownIds.delete(id);
}

function queueIdsWrite() {
  idsWriteQueue = idsWriteQueue
    .then(writeIdsMap)
    .catch((error) => console.error("Could not save repository id map:", safeErrorMessage(error)));
}

async function writeIdsMap() {
  await mkdir(idsCacheDir, { recursive: true });
  const entries = Object.fromEntries(knownIds);
  const destination = path.join(idsCacheDir, "ids.json");
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(entries), { flag: "wx" });
  try {
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function queueRepositoryPrune() {
  pruneRepositoryStore().catch((error) => {
    console.error("Repository storage cleanup failed:", safeErrorMessage(error));
  });
}

function safeErrorMessage(error) {
  const token = process.env.GITHUB_TOKEN;
  let message = error?.message ?? String(error);
  if (token) message = message.split(token).join("[REDACTED]");
  return message;
}
