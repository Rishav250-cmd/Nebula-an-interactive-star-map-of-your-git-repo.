import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { simpleGit } from "simple-git";
import test from "node:test";
import { createApp } from "../app.js";
import { NebulaError } from "../services/errors.js";
import { repoIdFor } from "../services/ingest.js";

const GITHUB_URL = "https://github.com/nebula-test/pipeline-fixture";

test("analysis errors expose stable code/message pairs and expected statuses", async () => {
  const cases = [
    {
      name: "invalid URL",
      url: "https://example.com/owner/repository",
      status: 400,
      code: "INVALID_URL",
      message: "Invalid GitHub URL",
      cloneError: null,
    },
    ...["private", "non-existent"].map((name) => ({
      name,
      url: `https://github.com/nebula-test/${name}-repository`,
      status: 404,
      code: "REPO_NOT_FOUND",
      message: "Repository not found, or it is private",
      cloneError: new NebulaError("REPO_NOT_FOUND"),
    })),
    {
      name: "empty repository",
      url: "https://github.com/nebula-test/empty-repository",
      status: 422,
      code: "EMPTY_REPO",
      message: "This repository has no commits yet",
      cloneError: new NebulaError("EMPTY_REPO"),
    },
    {
      name: "clone timeout",
      url: "https://github.com/nebula-test/timeout-repository",
      status: 504,
      code: "CLONE_TIMEOUT",
      message: "Repository clone timed out",
      cloneError: new NebulaError("CLONE_TIMEOUT"),
    },
  ];

  for (const fixture of cases) {
    const app = createApp({
      errorLogger: () => {},
      getRemoteShaImpl: async () => null,
      loadLatestAnalysisCacheImpl: async () => null,
      cloneRepoImpl: async () => {
        if (!fixture.cloneError) assert.fail("invalid URLs must not clone");
        throw fixture.cloneError;
      },
    });
    await withServer(app, async (baseUrl) => {
      const response = await postAnalyze(baseUrl, fixture.url);
      assert.equal(response.status, fixture.status, fixture.name);
      assert.deepEqual(await response.json(), {
        error: { code: fixture.code, message: fixture.message },
      }, fixture.name);
    });
  }
});

test("async clone timeout closes progress SSE and leaves the server responsive", async () => {
  const url = "https://github.com/nebula-test/sse-timeout";
  const app = createApp({
    errorLogger: () => {},
    getRemoteShaImpl: async () => null,
    loadLatestAnalysisCacheImpl: async () => null,
    cloneRepoImpl: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      throw new NebulaError("CLONE_TIMEOUT");
    },
  });

  await withServer(app, async (baseUrl) => {
    const accepted = await postAnalyze(baseUrl, url, { async: true });
    assert.equal(accepted.status, 202);
    const { id } = await accepted.json();
    const progress = await fetch(`${baseUrl}/api/progress/${id}`, {
      signal: AbortSignal.timeout(2000),
    });
    assert.equal(progress.status, 200);
    assert.match(progress.headers.get("content-type"), /text\/event-stream/);
    const body = await progress.text();
    assert.match(body, /"status":"error"/);
    const ping = await fetch(`${baseUrl}/api/ping`, { signal: AbortSignal.timeout(1000) });
    assert.equal(ping.status, 200);
  });
});

test("a blocking exact-SHA cache hit skips clone and local checkout checks", async () => {
  const url = "https://github.com/nebula-test/blocking-cache-hit";
  const id = repoIdFor(url);
  let cloneCalls = 0;
  let headChecks = 0;
  const graph = {
    repo: url,
    sha: "disk-cache-sha",
    nodes: [],
    edges: [],
    cycles: [],
    warnings: [],
    meta: { truncated: false },
  };
  const app = createApp({
    errorLogger: () => {},
    cloneLocationForUrlImpl: () => ({ id, dir: path.join(os.tmpdir(), "missing-cache-clone") }),
    getRemoteShaImpl: async () => graph.sha,
    getHeadShaImpl: async () => {
      headChecks += 1;
      return graph.sha;
    },
    loadAnalysisCacheImpl: async () => ({ graph, analysis: { files: {} } }),
    cloneRepoImpl: async () => {
      cloneCalls += 1;
      assert.fail("an exact-SHA disk cache hit must avoid cloning");
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await postAnalyze(baseUrl, url);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id, status: "ready" });
    assert.equal(cloneCalls, 0);
    assert.equal(headChecks, 0);
  });
});

test("a repository above the graph file cap succeeds with truncated metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nebula-cap-api-"));
  const url = "https://github.com/nebula-test/truncated-repository";
  const id = repoIdFor(url);
  const graph = {
    repo: url,
    sha: "truncated-fixture-sha",
    nodes: [],
    edges: [],
    cycles: [],
    warnings: [],
    meta: { truncated: true, truncatedReason: "file-cap" },
  };
  const app = createApp({
    errorLogger: () => {},
    cloneLocationForUrlImpl: () => ({ id, dir: root }),
    getRemoteShaImpl: async () => null,
    loadLatestAnalysisCacheImpl: async () => null,
    cloneRepoImpl: async () => ({ id, dir: root, sha: graph.sha }),
    listFilesImpl: async () => [],
    buildGraphImpl: async () => ({ graph, analysis: { files: {} } }),
    getChurnImpl: async () => new Map(),
    saveAnalysisCacheImpl: async () => true,
    cleanupTemporaryClones: false,
  });
  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/graph`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.meta.truncated, true);
      assert.equal(body.meta.truncatedReason, "file-cap");
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a repository with only unparseable source files still returns a graph", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nebula-unparseable-api-"));
  const url = "https://github.com/nebula-test/unparseable-repository";
  const id = repoIdFor(url);
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "broken-a.js"), "export const = ;\n");
    await writeFile(path.join(root, "src", "broken-b.ts"), "export function ( {\n");
    const git = simpleGit(root);
    await git.init();
    await git.addConfig("user.name", "Nebula Test");
    await git.addConfig("user.email", "nebula-test@example.invalid");
    await git.add(".");
    await git.commit("unparseable sources");
    const sha = (await git.revparse(["HEAD"])).trim();
    const app = createApp({
      errorLogger: () => {},
      cloneLocationForUrlImpl: () => ({ id, dir: root }),
      getRemoteShaImpl: async () => null,
      loadLatestAnalysisCacheImpl: async () => null,
      cloneRepoImpl: async () => ({ id, dir: root, sha }),
      getChurnImpl: async () => new Map(),
      saveAnalysisCacheImpl: async () => true,
      cleanupTemporaryClones: false,
    });

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/graph`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(response.status, 200);
      const graph = await response.json();
      assert.equal(graph.nodes.length, 2);
      assert.ok(graph.warnings.filter((warning) => warning.file).length >= 2);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("temporary repository directories are removed after success and failure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nebula-temp-clones-"));
  const successfulUrl = "https://github.com/nebula-test/cleanup-success";
  const failedUrl = "https://github.com/nebula-test/cleanup-failure";
  const successfulId = repoIdFor(successfulUrl);
  const failedId = repoIdFor(failedUrl);
  const successfulDir = path.join(root, successfulId);
  const failedDir = path.join(root, failedId);
  const graph = {
    repo: successfulUrl,
    sha: "cleanup-success-sha",
    nodes: [],
    edges: [],
    cycles: [],
    warnings: [],
    meta: { truncated: false },
  };
  const app = createApp({
    errorLogger: () => {},
    cloneLocationForUrlImpl: (url) => ({
      id: repoIdFor(url),
      dir: path.join(root, repoIdFor(url)),
    }),
    getRemoteShaImpl: async () => null,
    loadLatestAnalysisCacheImpl: async () => null,
    cloneRepoImpl: async (url) => {
      const id = repoIdFor(url);
      const dir = path.join(root, id);
      await mkdir(dir, { recursive: true });
      if (url === failedUrl) throw new NebulaError("CLONE_TIMEOUT");
      return { id, dir, sha: graph.sha };
    },
    listFilesImpl: async () => [],
    buildGraphImpl: async () => ({ graph, analysis: { files: {} } }),
    getChurnImpl: async () => new Map(),
    saveAnalysisCacheImpl: async () => true,
    cleanupTemporaryClones: true,
  });

  try {
    await withServer(app, async (baseUrl) => {
      const success = await postAnalyze(baseUrl, successfulUrl);
      assert.equal(success.status, 200);
      await waitForMissing(successfulDir);

      const failure = await postAnalyze(baseUrl, failedUrl);
      assert.equal(failure.status, 504);
      await assert.rejects(access(failedDir), { code: "ENOENT" });
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function postAnalyze(baseUrl, url, extra = {}) {
  return fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, ...extra }),
  });
}

async function waitForMissing(directory) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    try {
      await access(directory);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`temporary directory was not removed: ${directory}`);
}

async function withServer(app, callback) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }
}
