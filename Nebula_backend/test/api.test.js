import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "../src/app.js";

test("POST /api/graph returns a repository graph", async () => {
  const app = createApp({
    fetchImpl: async (url) => {
      if (url === "https://api.github.com/repos/octocat/demo") {
        return jsonResponse({ full_name: "octocat/demo", default_branch: "main" });
      }
      if (url.endsWith("/branches/main")) {
        return jsonResponse({ commit: { sha: "commit-sha", commit: { tree: { sha: "tree-sha" } } } });
      }
      if (url.includes("/git/trees/")) {
        return jsonResponse({ truncated: false, tree: [{ type: "blob", path: "index.js", size: 30 }] });
      }
      if (url.endsWith("/commit-sha/index.js")) return textResponse("export default 1;");
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repoUrl: "https://github.com/octocat/demo" }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.repository.name, "octocat/demo");
    assert.deepEqual(body.nodes.map(({ id }) => id), ["index.js"]);
    assert.deepEqual(body.edges, []);
  });
});

test("POST /api/graph validates the repository URL", async () => {
  const app = createApp({ fetchImpl: async () => { throw new Error("fetch should not be called"); } });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repoUrl: "https://example.com/owner/repo" }),
    });

    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /github\.com/);
  });
});

test("POST /api/analyze returns an analysis identifier and status", async () => {
  const app = createApp({
    fetchImpl: async (url) => {
      if (url === "https://api.github.com/repos/octocat/demo") {
        return jsonResponse({ full_name: "octocat/demo", default_branch: "main" });
      }
      if (url.endsWith("/branches/main")) {
        return jsonResponse({ commit: { sha: "commit-sha", commit: { tree: { sha: "tree-sha" } } } });
      }
      if (url.includes("/git/trees/")) return jsonResponse({ truncated: false, tree: [] });
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/octocat/demo" }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(typeof body.id, "string");
    assert.equal(body.status, "ready");
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

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(text, status = 200) {
  return new Response(text, { status, headers: { "content-type": "text/plain" } });
}
