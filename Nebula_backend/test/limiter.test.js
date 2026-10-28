import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../app.js";
import { createIpRateLimiter, createJobLimiter } from "../services/limiter.js";
import { NebulaError } from "../services/errors.js";
import { config } from "../services/config.js";
import {
  clearRepositoryDirectory,
  flushIdsMap,
  getAnalysis,
  initializeStore,
  pruneRepositoryStore,
  startStoreMaintenance,
  stopStoreMaintenance,
  storeAnalysis,
} from "../services/store.js";
import { repoIdFor } from "../services/ingest.js";

test("job semaphore queues up to its limit and rejects further reservations", async () => {
  const limiter = createJobLimiter({ maxConcurrent: 2, maxQueue: 4 });
  const releases = [];
  const active = [0, 1].map((index) => limiter.run(() => new Promise((resolve) => {
    releases.push(() => resolve(index));
  })));
  await delay(0);
  const queuedStates = [];
  const queued = [2, 3, 4, 5].map((index) => limiter.run(
    () => index,
    { onQueued: () => queuedStates.push(index) },
  ));

  assert.deepEqual(limiter.getState(), { active: 2, queued: 4, reserved: 0 });
  assert.deepEqual(queuedStates, [2, 3, 4, 5]);
  assert.throws(() => limiter.reserve(), (error) =>
    error instanceof NebulaError
    && error.code === "BUSY"
    && error.retryAfter === 15,
  );

  releases[0]();
  releases[1]();
  assert.deepEqual(await Promise.all([...active, ...queued]), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(limiter.getState(), { active: 0, queued: 0, reserved: 0 });
});

test("IP limiter returns Retry-After for the first request above its limit", () => {
  let now = 10_000;
  const middleware = createIpRateLimiter({ maxRequests: 2, windowMs: 30_000, now: () => now });
  const next = (ip) => {
    let error = null;
    middleware({ ip }, {}, (value) => { error = value ?? null; });
    return error;
  };

  assert.equal(next("203.0.113.1"), null);
  assert.equal(next("203.0.113.1"), null);
  const limited = next("203.0.113.1");
  assert.equal(limited.code, "RATE_LIMITED");
  assert.equal(limited.retryAfter, 30);
  assert.equal(next("203.0.113.2"), null);
  now += 30_001;
  assert.equal(next("203.0.113.1"), null);
});

test("async analysis queues jobs and returns BUSY when active and waiting capacity is full", async () => {
  const jobLimiter = createJobLimiter({ maxConcurrent: 2, maxQueue: 4 });
  const analyses = new Map();
  const app = createApp({
    jobLimiter,
    rateLimitMax: 20,
    errorLogger: () => {},
    getRemoteShaImpl: async () => { await delay(1000); return null; },
    cloneRepoImpl: async (url) => {
      await delay(700);
      return { id: repoIdFor(url), dir: "/fixture", sha: "queue-fixture" };
    },
    listFilesImpl: async () => ["src/file.js"],
    buildGraphImpl: async () => ({
      graph: { repo: "fixture", sha: "queue-fixture", nodes: [], edges: [], cycles: [], warnings: [] },
      analysis: { files: {}, reverseIndex: new Map() },
    }),
    saveAnalysisCacheImpl: async () => true,
    getAnalysisImpl: (id) => analyses.get(id) ?? null,
    storeAnalysisImpl: (entry) => {
      const current = analyses.get(entry.id) ?? {};
      const stored = {
        ...current,
        ...entry,
        job: entry.job ?? current.job ?? { status: "ready", error: null, progress: { done: 0, total: 0 } },
      };
      analyses.set(entry.id, stored);
      return stored;
    },
    updateAnalysisJobImpl: (id, job) => {
      const entry = analyses.get(id);
      if (!entry) return null;
      entry.job = { ...entry.job, ...job };
      return entry.job;
    },
  });

  await withServer(app, async (baseUrl) => {
    const urls = Array.from({ length: 7 }, (_, index) => `https://github.com/nebula-queue/repo-${index}`);
    const responses = await Promise.all(urls.map((url) => postAnalyze(baseUrl, url)));
    assert.equal(responses.filter((response) => response.status === 202).length, 6);
    const busy = responses.find((response) => response.status === 503);
    assert.ok(busy);
    assert.equal(busy.headers.get("retry-after"), "15");
    assert.equal((await busy.json()).code, "BUSY");

    await delay(1100);
    const statuses = await Promise.all(urls.slice(0, 6).map(async (url) => {
      const response = await fetch(`${baseUrl}/api/analyze/${repoIdFor(url)}/status`);
      return (await response.json()).status;
    }));
    assert.equal(statuses.filter((status) => status === "queued").length, 4);
    assert.equal(statuses.filter((status) => status === "cloning").length, 2);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && [...analyses.values()].some((entry) => entry.job.status !== "ready")) {
      await delay(50);
    }
    assert.ok([...analyses.values()].every((entry) => entry.job.status === "ready"));
  });
});

test("the 13th analyze request from one client IP is rate limited", async () => {
  const app = createApp({ rateLimitMax: 12, rateLimitWindowMs: 60_000, errorLogger: () => {} });
  await withServer(app, async (baseUrl) => {
    let finalResponse;
    for (let index = 0; index < 13; index += 1) {
      finalResponse = await postAnalyze(baseUrl, "not-a-url", "198.51.100.18");
      if (index < 12) assert.equal(finalResponse.status, 400);
    }
    assert.equal(finalResponse.status, 429);
    assert.ok(Number(finalResponse.headers.get("retry-after")) > 0);
    assert.equal((await finalResponse.json()).code, "RATE_LIMITED");
  });
});

test("finished analyses bypass request and job limits", async () => {
  const url = "https://github.com/nebula-cache-bypass/repository";
  const id = repoIdFor(url);
  const jobLimiter = createJobLimiter({ maxConcurrent: 1, maxQueue: 0 });
  const dir = await mkdtemp(path.join(os.tmpdir(), "nebula-finished-"));
  try {
    storeAnalysis({ id, dir, url, graph: { nodes: [], edges: [] } });
    const app = createApp({
      jobLimiter,
      rateLimitMax: 1,
      errorLogger: () => {},
      cloneRepoImpl: async () => assert.fail("a stored analysis must be reused"),
    });

    await withServer(app, async (baseUrl) => {
      for (let index = 0; index < 13; index += 1) {
        const response = await postAnalyze(baseUrl, url);
        assert.equal(response.status, 202);
        assert.equal((await response.json()).status, "ready");
      }
    });
    assert.deepEqual(jobLimiter.getState(), { active: 0, queued: 0, reserved: 0 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("repository eviction removes the oldest clone but leaves cache files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nebula-lru-"));
  const cacheDir = path.join(root, "cache");
  try {
    await initializeStore({ cacheDir });
    await mkdir(cacheDir, { recursive: true });
    const entries = [];
    const accessBase = Date.now() - 10_000;
    for (let index = 0; index < 3; index += 1) {
      const dir = path.join(root, `repo-${index}`);
      await mkdir(dir);
      entries.push(storeAnalysis({
        id: `lru-${index}`,
        dir,
        url: `https://github.com/nebula-lru/repo-${index}`,
        sha: `sha-${index}`,
        graph: { sha: `sha-${index}` },
      }));
      entries[index].lastAccess = accessBase + index;
    }
    const cacheFile = path.join(cacheDir, "repo-cache.json");
    await writeFile(cacheFile, "keep");
    await pruneRepositoryStore({ maxRepos: 2, now: Date.now(), ttlMinutes: 1000 });

    assert.deepEqual(await readdir(root).then((names) => names.sort()), ["cache", "repo-1", "repo-2"]);
    assert.equal((await readdir(cacheDir)).includes("repo-cache.json"), true);
    assert.equal((await readdir(cacheDir)).includes("ids.json"), true);
  } finally {
    await flushIdsMap();
    await initializeStore({ cacheDir: config.CACHE_DIR });
    await rm(root, { recursive: true, force: true });
  }
});

test("stored ids survive restart and unknown ids include their previous URL", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nebula-ids-"));
  const cacheDir = path.join(root, "cache");
  try {
    await initializeStore({ cacheDir });
    const url = "https://github.com/nebula-ids/repository";
    const cloneDir = path.join(root, "clone");
    await mkdir(cloneDir);
    storeAnalysis({ id: "persisted-nebula-id", dir: cloneDir, url, sha: "persisted-sha" });
    await flushIdsMap();
    const script = `
      import { initializeStore, unknownIdError } from ${JSON.stringify(new URL("../services/store.js", import.meta.url).href)};
      await initializeStore({ cacheDir: process.argv[1] });
      const error = unknownIdError("persisted-nebula-id");
      process.stdout.write(JSON.stringify({ code: error.code, hint: error.hint, details: error.details }));
    `;
    const child = await import("node:child_process");
    const output = child.execFileSync(process.execPath, ["--input-type=module", "-e", script, cacheDir], { encoding: "utf8" });
    assert.deepEqual(JSON.parse(output), {
      code: "UNKNOWN_ID",
      hint: "Analyze the repository again",
      details: { url },
    });
    await pruneRepositoryStore({ maxRepos: 0, now: Date.now(), ttlMinutes: 1000 });
    assert.equal(getAnalysis("persisted-nebula-id"), null);
    await withServer(createApp({ errorLogger: () => {} }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/graph/persisted-nebula-id`);
      assert.equal(response.status, 404);
      assert.deepEqual((await response.json()).details, { url });
    });
  } finally {
    await flushIdsMap();
    await initializeStore({ cacheDir: config.CACHE_DIR });
    await rm(root, { recursive: true, force: true });
  }
});

test("startup cleanup removes prior clones and maintenance timer is unref-ed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nebula-restart-cleanup-"));
  try {
    await mkdir(path.join(root, "old-clone"));
    await writeFile(path.join(root, "old-clone", "source.js"), "old");
    await mkdir(path.join(root, "another-old-clone"));
    await clearRepositoryDirectory({ repoDir: root });
    assert.deepEqual(await readdir(root), []);
    const timer = startStoreMaintenance({ intervalMs: 100_000 });
    assert.equal(timer.hasRef(), false);
    stopStoreMaintenance();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function postAnalyze(baseUrl, url, forwardedFor) {
  return fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
    },
    body: JSON.stringify({ url, async: true }),
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withServer(app, callback) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
