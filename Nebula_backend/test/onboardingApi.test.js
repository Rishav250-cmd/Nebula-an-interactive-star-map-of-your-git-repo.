import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "../app.js";
import { storeAnalysis } from "../services/store.js";

test("GET /api/onboarding returns a reading path when issues are rate limited", async () => {
  const id = `onboarding-github-${Date.now()}`;
  storeAnalysis({
    id,
    dir: "/unused",
    url: "https://github.com/octocat/onboarding-api",
    graph: fixtureGraph(),
    analysis: { files: {} },
  });
  let fetchCalls = 0;
  const app = createApp({
    fetchGoodFirstIssuesImpl: async (owner, repo) => {
      fetchCalls += 1;
      assert.equal(owner, "octocat");
      assert.equal(repo, "onboarding-api");
      return { status: "rate_limited", issues: [], resetAt: 123456 };
    },
  });

  await withServer(app, async (baseUrl) => {
    const first = await fetch(`${baseUrl}/api/onboarding/${id}`);
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(firstBody.issuesStatus, "rate_limited");
    assert.equal(firstBody.issuesResetAt, 123456);
    assert.equal(firstBody.entry, "src/main.js");
    assert.ok(firstBody.path.length > 0);
    const second = await fetch(`${baseUrl}/api/onboarding/${id}`);
    assert.deepEqual(await second.json(), firstBody);
    assert.equal(fetchCalls, 1);
  });
});

test("GET /api/onboarding skips issue fetching for ZIP repositories", async () => {
  const id = `onboarding-zip-${Date.now()}`;
  storeAnalysis({
    id,
    dir: "/unused",
    url: "uploaded-project.zip",
    graph: fixtureGraph(),
    analysis: { files: {} },
  });
  let fetchCalls = 0;
  const app = createApp({
    fetchGoodFirstIssuesImpl: async () => {
      fetchCalls += 1;
      return { status: "ok", issues: [] };
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/onboarding/${id}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.issuesStatus, "none");
    assert.equal(body.issuesResetAt, null);
    assert.ok(body.path.length > 0);
    assert.equal(fetchCalls, 0);
  });
});

test("GET /api/onboarding returns 404 for an unknown repository", async () => {
  await withServer(createApp(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/onboarding/unknown`);
    assert.equal(response.status, 404);
    assert.deepEqual((await response.json()).error, {
      code: "UNKNOWN_ID",
      message: "Unknown repository id",
    });
  });
});

function fixtureGraph() {
  return {
    nodes: [
      {
        id: "src/main.js",
        fanIn: 0,
        fanOut: 1,
        loc: 40,
        complexity: 1,
        churn: 0,
        functionCount: 1,
        blastRadius: 0,
      },
      {
        id: "src/helper.js",
        fanIn: 1,
        fanOut: 0,
        loc: 25,
        complexity: 2,
        churn: 1,
        functionCount: 1,
        blastRadius: 1,
      },
    ],
    edges: [{ source: "src/main.js", target: "src/helper.js" }],
  };
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
