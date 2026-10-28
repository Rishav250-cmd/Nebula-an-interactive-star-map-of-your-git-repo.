import assert from "node:assert/strict";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import test from "node:test";
import { createApp } from "../app.js";
import {
  ANALYSIS_VERSION,
  MAX_CACHE_BYTES,
  getAnalysisCachePath,
  loadAnalysisCache,
  pruneAnalysisCache,
  saveAnalysisCache,
} from "../services/cache.js";
import { parseFile } from "../services/parser.js";
import { getAnalysis } from "../services/store.js";

const REPO_URL = "https://github.com/octocat/cache-fixture";
const SHA_ONE = "1".repeat(40);
const SHA_TWO = "2".repeat(40);

test("analysis cache saves atomically and round-trips analysis maps", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "nebula-cache-"));
  const graph = {
    repo: REPO_URL,
    sha: SHA_ONE,
    nodes: [],
    edges: [],
    cycles: [],
    warnings: [],
  };
  const analysis = {
    churn: new Map([
      ["src/index.js", 3],
      ["src/helper.js", 1],
    ]),
    files: {
      "src/index.js": {
        functions: [],
        calls: [],
        bindings: new Map([
          ["helper", { source: "./helper.js", imported: "default" }],
        ]),
        complexity: 1,
      },
    },
  };

  try {
    assert.equal(
      await saveAnalysisCache(
        { repo: REPO_URL, sha: SHA_ONE, graph, analysis },
        { cacheDir },
      ),
      true,
    );
    const cachePath = getAnalysisCachePath(REPO_URL, SHA_ONE, { cacheDir });
    assert.equal(
      path.basename(cachePath),
      `octocat__cache-fixture__${SHA_ONE}.json`,
    );
    const files = await readdir(cacheDir);
    assert.deepEqual(files, [path.basename(cachePath)]);

    const cached = await loadAnalysisCache(REPO_URL, SHA_ONE, { cacheDir });
    assert.equal(cached.version, ANALYSIS_VERSION);
    assert.deepEqual(cached.graph, graph);
    assert.ok(cached.analysis.churn instanceof Map);
    assert.deepEqual(cached.analysis.churn, analysis.churn);
    assert.ok(cached.analysis.files["src/index.js"].bindings instanceof Map);
    assert.deepEqual(
      cached.analysis.files["src/index.js"].bindings.get("helper"),
      {
        source: "./helper.js",
        imported: "default",
      },
    );
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("analysis cache ignores corrupted files and version mismatches", async () => {
  const cacheDir = await mkdtemp(
    path.join(os.tmpdir(), "nebula-cache-invalid-"),
  );
  const cachePath = getAnalysisCachePath(REPO_URL, SHA_ONE, { cacheDir });

  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath, "{not valid json");
    assert.equal(
      await loadAnalysisCache(REPO_URL, SHA_ONE, { cacheDir }),
      null,
    );

    await writeFile(
      cachePath,
      JSON.stringify({
        version: ANALYSIS_VERSION + 1,
        repo: REPO_URL,
        sha: SHA_ONE,
        graph: {},
        analysis: {},
      }),
    );
    assert.equal(
      await loadAnalysisCache(REPO_URL, SHA_ONE, { cacheDir }),
      null,
    );
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("remote failure serves stale cache only when its clone folder exists", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nebula-stale-clone-"));
  await mkdir(dir, { recursive: true });
  const graph = { repo: REPO_URL, sha: SHA_ONE, nodes: [], edges: [], cycles: [], warnings: [], meta: { stale: false } };
  const analysis = { files: {} };
  const app = createApp({
    cloneLocationForUrlImpl: () => ({ id: "stale-cache", dir }),
    getRemoteShaImpl: async () => null,
    loadLatestAnalysisCacheImpl: async () => ({ sha: SHA_ONE, graph, analysis }),
    cloneRepoImpl: async () => assert.fail("stale cache should avoid cloning"),
  });
  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/analyze`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: REPO_URL }),
      });
      assert.equal(response.status, 200);
      const stored = getAnalysis("stale-cache");
      assert.equal(stored.graph.meta.stale, true);
      assert.ok(stored.graph.warnings.some((warning) => warning.message === "GitHub could not be reached; showing the last analysis"));
    });

    const noCacheApp = createApp({
      cloneLocationForUrlImpl: () => ({ id: "stale-cache-missing", dir: path.join(dir, "missing") }),
      getRemoteShaImpl: async () => null,
      loadLatestAnalysisCacheImpl: async () => null,
      cloneRepoImpl: async () => { throw new Error("offline"); },
    });
    await withServer(noCacheApp, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/analyze`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: REPO_URL }),
      });
      assert.equal(response.status, 502);
      const payload = await response.json();
      assert.deepEqual(Object.keys(payload), ["error"]);
      assert.deepEqual(Object.keys(payload.error), ["code", "message"]);
      assert.equal(payload.error.code, "CLONE_FAILED");
      assert.equal(typeof payload.error.message, "string");
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ping reports runtime shape and CORS limits response origins", async () => {
  const app = createApp({ corsOrigin: "https://allowed.example" });
  await withServer(app, async (baseUrl) => {
    const allowed = await fetch(`${baseUrl}/api/ping`, { headers: { Origin: "https://allowed.example" } });
    const payload = await allowed.json();
    assert.equal(allowed.headers.get("access-control-allow-origin"), "https://allowed.example");
    assert.equal(allowed.headers.get("x-content-type-options"), "nosniff");
    assert.equal(allowed.headers.get("x-powered-by"), null);
    assert.equal(payload.ok, true);
    assert.equal(typeof payload.version, "string");
    assert.equal(typeof payload.uptimeSec, "number");
    assert.equal(typeof payload.rssMb, "number");
    assert.equal(typeof payload.repos, "number");
    assert.deepEqual(Object.keys(payload.queue), ["running", "waiting"]);
    assert.deepEqual(Object.keys(payload.limits), ["maxCodeFiles", "maxRepoMb", "maxConcurrentJobs"]);
    const denied = await fetch(`${baseUrl}/api/ping`, { headers: { Origin: "https://denied.example" } });
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
    const compressed = await fetch(`${baseUrl}/api/mock-graph`, {
      headers: { "accept-encoding": "gzip" },
    });
    assert.equal(compressed.headers.get("content-encoding"), "gzip");
  });
});

test("analysis cache skips entries larger than 50 MB", async () => {
  const cacheDir = path.join(os.tmpdir(), `nebula-cache-large-${process.pid}`);
  await rm(cacheDir, { recursive: true, force: true });

  assert.equal(
    await saveAnalysisCache(
      {
        repo: REPO_URL,
        sha: SHA_ONE,
        graph: { oversized: "x".repeat(MAX_CACHE_BYTES) },
        analysis: { files: {} },
      },
      { cacheDir },
    ),
    false,
  );
  await assert.rejects(readdir(cacheDir), { code: "ENOENT" });
});

test("analysis cache pruning keeps only the 30 newest JSON files", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "nebula-cache-prune-"));

  try {
    for (let index = 0; index < 32; index += 1) {
      const filename = `cache-${String(index).padStart(2, "0")}.json`;
      const filePath = path.join(cacheDir, filename);
      await writeFile(filePath, "{}");
      const timestamp = new Date(1_700_000_000_000 + index * 1000);
      await utimes(filePath, timestamp, timestamp);
    }

    await pruneAnalysisCache({ cacheDir });
    const files = (await readdir(cacheDir)).sort();
    assert.equal(files.length, 30);
    assert.equal(files[0], "cache-02.json");
    assert.equal(files.at(-1), "cache-31.json");
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("analysis cache pruning evicts oldest repositories to fit the disk budget", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "nebula-cache-budget-"));
  const now = Date.now();
  try {
    for (let index = 0; index < 3; index += 1) {
      const filePath = path.join(cacheDir, `owner__repo-${index}__${SHA_ONE}.json`);
      await writeFile(filePath, "x".repeat(10));
      const modified = new Date(now + index * 1000);
      await utimes(filePath, modified, modified);
    }
    await pruneAnalysisCache({ cacheDir, maxRepos: 10, maxDiskBytes: 20 });
    const files = (await readdir(cacheDir)).sort();
    assert.deepEqual(files, [
      `owner__repo-1__${SHA_ONE}.json`,
      `owner__repo-2__${SHA_ONE}.json`,
    ]);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("analysis pipeline builds once, hits cache without parsing, and rebuilds for a changed SHA", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nebula-cache-pipeline-"));
  const cacheDir = await mkdtemp(
    path.join(os.tmpdir(), "nebula-cache-pipeline-cache-"),
  );
  let remoteSha;
  let cloneCalls = 0;
  let parserCalls = 0;

  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "src", "index.js"),
      "export function run() {}\n",
    );
    const git = simpleGit(root);
    await git.init();
    await git.addConfig("user.name", "Nebula Test");
    await git.addConfig("user.email", "nebula-test@example.invalid");
    await git.add(".");
    await git.commit("first cache fixture");
    remoteSha = (await git.revparse(["HEAD"])).trim();

    const app = createApp({
      getRemoteShaImpl: async () => remoteSha,
      cloneLocationForUrlImpl: () => ({ id: "cache-pipeline", dir: root }),
      getHeadShaImpl: async (directory) =>
        (await simpleGit(directory).revparse(["HEAD"])).trim(),
      cloneRepoImpl: async () => {
        cloneCalls += 1;
        return { id: "cache-pipeline", dir: root, sha: remoteSha };
      },
      loadAnalysisCacheImpl: (repo, sha) =>
        loadAnalysisCache(repo, sha, { cacheDir }),
      saveAnalysisCacheImpl: (entry) => saveAnalysisCache(entry, { cacheDir }),
      parseFileImpl: (source, filePath) => {
        parserCalls += 1;
        return parseFile(source, filePath);
      },
    });

    await withServer(app, async (baseUrl) => {
      assert.equal((await postAnalyze(baseUrl)).status, 200);
      assert.equal(cloneCalls, 1);
      assert.equal(parserCalls, 1);
      assert.ok(await loadAnalysisCache(REPO_URL, remoteSha, { cacheDir }));

      assert.equal((await postAnalyze(baseUrl)).status, 200);
      assert.equal(cloneCalls, 1);
      assert.equal(parserCalls, 1);
      assert.equal(getAnalysis("cache-pipeline").graph.sha, remoteSha);

      await writeFile(
        path.join(root, "src", "index.js"),
        "export function run() { return 2; }\n",
      );
      await git.add(".");
      await git.commit("changed cache fixture");
      remoteSha = (await git.revparse(["HEAD"])).trim();
      assert.notEqual(remoteSha, SHA_ONE);

      assert.equal((await postAnalyze(baseUrl)).status, 200);
      assert.equal(cloneCalls, 2);
      assert.equal(parserCalls, 2);
      assert.equal(getAnalysis("cache-pipeline").graph.sha, remoteSha);
      assert.ok(await loadAnalysisCache(REPO_URL, remoteSha, { cacheDir }));
    });
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("analysis cache read and write errors do not fail a request", async () => {
  const graph = {
    repo: REPO_URL,
    sha: SHA_ONE,
    nodes: [],
    edges: [],
    cycles: [],
    warnings: [],
  };
  const app = createApp({
    getRemoteShaImpl: async () => null,
    cloneRepoImpl: async () => ({
      id: "cache-errors",
      dir: "/fixture",
      sha: SHA_ONE,
    }),
    loadAnalysisCacheImpl: async () => {
      throw new Error("simulated cache read error");
    },
    saveAnalysisCacheImpl: async () => {
      throw new Error("simulated cache write error");
    },
    listFilesImpl: async () => [],
    buildGraphImpl: async () => ({ graph, analysis: { files: {} } }),
  });

  await withServer(app, async (baseUrl) => {
    const response = await postAnalyze(baseUrl);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      id: "cache-errors",
      status: "ready",
    });
  });
});

async function postAnalyze(baseUrl) {
  return fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: REPO_URL }),
  });
}

async function withServer(app, callback) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const { port } = server.address();
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
