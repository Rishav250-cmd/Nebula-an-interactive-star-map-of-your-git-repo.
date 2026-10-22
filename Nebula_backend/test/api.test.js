import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import test from "node:test";
import { getAnalysis } from "../services/store.js";
import { createApp } from "../src/app.js";

test("POST /api/analyze stores a clone graph and GET /api/graph/:id returns it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nebula-api-test-"));

  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "index.js"), 'import { helper } from "./helper";\nexport const output = helper();');
    await writeFile(path.join(root, "src", "helper.js"), 'export const helper = () => "ok";');
    const git = simpleGit(root);
    await git.init();
    await git.addConfig("user.name", "Nebula Test");
    await git.addConfig("user.email", "nebula-test@example.invalid");
    await git.add(".");
    await git.commit("create API fixture");
    const expectedSha = (await git.revparse(["HEAD"])).trim();
    const app = createApp({
      cloneRepoImpl: async (url) => {
        assert.equal(url, "https://github.com/octocat/demo");
        return { id: "analysis-fixture", dir: root, sha: expectedSha };
      },
    });

    await withServer(app, async (baseUrl) => {
      const analyzeResponse = await fetch(`${baseUrl}/api/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://github.com/octocat/demo" }),
      });

      assert.equal(analyzeResponse.status, 200);
      assert.deepEqual(await analyzeResponse.json(), { id: "analysis-fixture", status: "ready" });
      assert.equal(getAnalysis("analysis-fixture").dir, root);

      const graphResponse = await fetch(`${baseUrl}/api/graph/analysis-fixture`);
      const graph = await graphResponse.json();

      assert.equal(graphResponse.status, 200);
      assert.equal(graph.repo, "https://github.com/octocat/demo");
      assert.equal(graph.sha, expectedSha);
      assert.deepEqual(graph.nodes.map(({ id }) => id), ["src/helper.js", "src/index.js"]);
      assert.deepEqual(graph.edges, [
        { source: "src/index.js", target: "src/helper.js", type: "import" },
      ]);
      assert.deepEqual(graph.cycles, []);
      assert.deepEqual(graph.warnings, []);
      assert.deepEqual(Object.keys(graph.nodes[0]).sort(), [
        "churn", "complexity", "fanIn", "fanOut", "folder", "healthScore", "id", "inCycle", "isGodFile", "loc", "tokens",
      ]);
      assert.equal(graph.nodes[0].healthScore, null);
      assert.equal(graph.nodes[0].fanIn, 1);
      assert.equal(graph.nodes[1].fanOut, 1);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("POST /api/analyze rejects invalid GitHub URLs", async () => {
  const app = createApp({
    cloneRepoImpl: async () => {
      throw new Error("clone should not run");
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/owner/repo" }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Invalid GitHub URL" });
  });
});

test("POST /api/analyze returns an error when cloning fails", async () => {
  const app = createApp({
    cloneRepoImpl: async () => {
      throw new Error("clone failed");
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/octocat/demo" }),
    });

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: "Could not clone repo (private or not found?)",
    });
  });
});

test("GET /api/graph/:id returns 404 when the analysis is unknown", async () => {
  const app = createApp();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/graph/missing-analysis`);

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Analysis not found." });
  });
});

async function withServer(app, callback) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const { port } = server.address();
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
