import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "../app.js";
import { buildReverseIndex } from "../services/blast.js";
import { storeAnalysis } from "../services/store.js";

test("GET /api/blast returns importer depths and repository percentage", async () => {
  const id = `blast-api-${Date.now()}`;
  const nodes = ["a.js", "b.js", "c.js", "solo.js"].map((nodeId) => ({
    id: nodeId,
    blastRadius: nodeId === "c.js" ? 2 : 0,
  }));
  const edges = [
    { source: "a.js", target: "b.js" },
    { source: "b.js", target: "c.js" },
  ];
  storeAnalysis({
    id,
    dir: "/unused",
    url: "https://github.com/octocat/blast-api",
    graph: { nodes, edges },
    analysis: { reverseIndex: buildReverseIndex(edges) },
  });

  await withServer(async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/blast?id=${id}&path=${encodeURIComponent("c.js")}`,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      file: "c.js",
      count: 2,
      affected: [
        { id: "b.js", depth: 1 },
        { id: "a.js", depth: 2 },
      ],
      depthMap: { "b.js": 1, "a.js": 2 },
      byDepth: { 1: 1, 2: 1 },
      maxDepthReached: 2,
      truncated: false,
      totalFiles: 4,
      percentOfRepo: 50,
    });
    assert.ok(nodes.every((node) => Object.hasOwn(node, "blastRadius")));
  });
});

test("GET /api/blast reports unknown ids and missing or unknown paths", async () => {
  await withServer(async (baseUrl) => {
    const unknownId = await fetch(`${baseUrl}/api/blast?id=missing&path=a.js`);
    assert.equal(unknownId.status, 404);
    assert.deepEqual(await unknownId.json(), {
      error: "Unknown repository id",
    });

    const missingPath = await fetch(`${baseUrl}/api/blast?id=missing`);
    assert.equal(missingPath.status, 400);
    assert.deepEqual(await missingPath.json(), {
      error: "The 'path' query parameter is required",
    });

    const id = `blast-api-path-${Date.now()}`;
    storeAnalysis({
      id,
      dir: "/unused",
      url: "fixture",
      graph: { nodes: [{ id: "known.js", blastRadius: 0 }], edges: [] },
      analysis: { reverseIndex: new Map() },
    });
    const unknownPath = await fetch(
      `${baseUrl}/api/blast?id=${id}&path=unknown.js`,
    );
    assert.equal(unknownPath.status, 404);
    assert.deepEqual(await unknownPath.json(), {
      error: "Path is not a graph node",
    });
  });
});

test("GET /api/blast accepts only integer depths from 1 to 6", async () => {
  const id = `blast-api-depth-${Date.now()}`;
  storeAnalysis({
    id,
    dir: "/unused",
    url: "fixture",
    graph: { nodes: [{ id: "known.js", blastRadius: 0 }], edges: [] },
    analysis: { reverseIndex: new Map() },
  });

  await withServer(async (baseUrl) => {
    for (const depth of ["0", "7", "1.5", "abc", ""]) {
      const response = await fetch(
        `${baseUrl}/api/blast?id=${id}&path=known.js&depth=${depth}`,
      );
      assert.equal(response.status, 400, `expected 400 for depth=${depth}`);
    }
    for (const depth of ["1", "6"]) {
      const response = await fetch(
        `${baseUrl}/api/blast?id=${id}&path=known.js&depth=${depth}`,
      );
      assert.equal(response.status, 200);
    }
  });
});

async function withServer(callback) {
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
