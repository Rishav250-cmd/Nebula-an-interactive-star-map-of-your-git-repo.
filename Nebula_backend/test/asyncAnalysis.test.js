import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "../app.js";
import { repoIdFor } from "../services/ingest.js";
import { getAnalysis } from "../services/store.js";

const REPO_URL = "https://github.com/octocat/async-fixture";

test("async analysis returns immediately and status reaches ready", async () => {
  const options = makeOptions({ cloneDelay: 700 });
  await withServer(createApp(options), async (baseUrl) => {
    const startedAt = Date.now();
    const response = await postAnalyze(baseUrl, { url: REPO_URL, async: true });
    const elapsed = Date.now() - startedAt;
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      id: repoIdFor(REPO_URL),
      status: "cloning",
    });
    assert.ok(elapsed < 500, `async response took ${elapsed} ms`);

    const status = await waitForStatus(baseUrl, repoIdFor(REPO_URL));
    assert.equal(status.status, "ready");
    assert.deepEqual(status.progress, { done: 2, total: 2 });
    assert.equal(getAnalysis(repoIdFor(REPO_URL)).job.status, "ready");
  });
});

test("async analysis reuses an in-flight job for the same repository", async () => {
  const options = makeOptions({ cloneDelay: 500 });
  await withServer(createApp(options), async (baseUrl) => {
    const first = await postAnalyze(baseUrl, { url: REPO_URL, async: true });
    const second = await postAnalyze(baseUrl, { url: REPO_URL, async: true });
    assert.equal(first.status, 202);
    assert.equal(second.status, 202);
    assert.deepEqual(await second.json(), {
      id: repoIdFor(REPO_URL),
      status: "cloning",
    });
    assert.equal(options.getCloneCount(), 1);
    assert.equal(
      (await waitForStatus(baseUrl, repoIdFor(REPO_URL))).status,
      "ready",
    );
  });
});

test("async analysis marks a valid cache hit ready without cloning", async () => {
  let cloneCalls = 0;
  const app = createApp({
    getRemoteShaImpl: async () => "cached-sha",
    getHeadShaImpl: async () => "cached-sha",
    loadAnalysisCacheImpl: async () => ({
      graph: { sha: "cached-sha", nodes: [], edges: [] },
      analysis: { files: {}, reverseIndex: new Map() },
    }),
    cloneRepoImpl: async () => {
      cloneCalls += 1;
      throw new Error("cache hit should skip clone");
    },
  });
  await withServer(app, async (baseUrl) => {
    const accepted = await postAnalyze(baseUrl, { url: REPO_URL, async: true });
    assert.equal(accepted.status, 202);
    const status = await waitForStatus(baseUrl, repoIdFor(REPO_URL));
    assert.equal(status.status, "ready");
    assert.equal(cloneCalls, 0);
  });
});

test("progress SSE streams state changes and closes after ready", async () => {
  const options = makeOptions({ cloneDelay: 650 });
  await withServer(createApp(options), async (baseUrl) => {
    const accepted = await postAnalyze(baseUrl, { url: REPO_URL, async: true });
    assert.equal(accepted.status, 202);

    const response = await fetch(
      `${baseUrl}/api/progress/${repoIdFor(REPO_URL)}`,
    );
    assert.ok(
      response.headers.get("content-type").startsWith("text/event-stream"),
    );
    assert.equal(response.headers.get("cache-control"), "no-cache");
    assert.equal(response.headers.get("x-accel-buffering"), "no");
    const stream = await response.text();
    const events = stream
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)));
    assert.ok(events.length >= 1);
    assert.equal(events.at(-1).status, "ready");
  });
});

test("blocking analysis remains the default", async () => {
  await withServer(
    createApp(makeOptions({ cloneDelay: 0 })),
    async (baseUrl) => {
      const response = await postAnalyze(baseUrl, { url: REPO_URL });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        id: repoIdFor(REPO_URL),
        status: "ready",
      });
    },
  );
});

test("analysis status returns 404 for unknown repositories", async () => {
  await withServer(createApp(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/analyze/unknown/status`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Unknown repository id" });
  });
});

function makeOptions({ cloneDelay = 0 } = {}) {
  let cloneCount = 0;
  return {
    getCloneCount: () => cloneCount,
    getRemoteShaImpl: async () => null,
    cloneRepoImpl: async (url) => {
      cloneCount += 1;
      if (cloneDelay > 0) await delay(cloneDelay);
      return { id: repoIdFor(url), dir: "/fixture", sha: "fixture-sha" };
    },
    listFilesImpl: async () => ["src/a.js", "src/b.js"],
    buildGraphImpl: async ({ onProgress }) => {
      onProgress?.({ status: "parsing", progress: { done: 0, total: 2 } });
      await delay(20);
      onProgress?.({ status: "parsing", progress: { done: 2, total: 2 } });
      onProgress?.({ status: "graph", progress: { done: 2, total: 2 } });
      return {
        graph: {
          repo: REPO_URL,
          sha: "fixture-sha",
          nodes: [{ id: "src/a.js" }, { id: "src/b.js" }],
          edges: [],
          cycles: [],
          warnings: [],
        },
        analysis: { files: {}, reverseIndex: new Map() },
      };
    },
    loadAnalysisCacheImpl: async () => null,
    saveAnalysisCacheImpl: async () => true,
  };
}

async function postAnalyze(baseUrl, body) {
  return fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function waitForStatus(baseUrl, id) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/analyze/${id}/status`);
    const status = await response.json();
    if (status.status === "ready" || status.status === "error") return status;
    await delay(30);
  }
  throw new Error("analysis did not finish before test timeout");
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
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
