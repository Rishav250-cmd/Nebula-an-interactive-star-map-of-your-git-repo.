import assert from "node:assert/strict";
import test from "node:test";
import { buildOnboarding } from "../services/onboarding.js";

test("buildOnboarding chooses a preferred entry and orders imports by depth", () => {
  const graph = {
    nodes: [
      node("src/worker.js", { fanOut: 9, fanIn: 0 }),
      node("src/index.js", { fanOut: 1, fanIn: 0 }),
      node("src/main.js", { fanOut: 3, fanIn: 0 }),
      node("src/z-helper.js", { fanIn: 1 }),
      node("src/a-helper.js", { fanIn: 1 }),
      node("src/nested.js", { fanIn: 1 }),
      node("src/__tests__/main.test.js", { fanIn: 1 }),
      node("dist/bundle.js", { fanIn: 1 }),
      node("src/client.generated.ts", { fanIn: 1 }),
    ],
    edges: [
      { source: "src/main.js", target: "src/z-helper.js" },
      { source: "src/main.js", target: "src/a-helper.js" },
      { source: "src/main.js", target: "src/__tests__/main.test.js" },
      { source: "src/a-helper.js", target: "src/nested.js" },
    ],
  };
  const result = buildOnboarding({
    graph,
    analysis: { files: {} },
    issues: [],
  });
  assert.equal(result.entry, "src/main.js");
  assert.deepEqual(
    result.path.map(({ id, depth }) => [id, depth]),
    [
      ["src/main.js", 0],
      ["src/a-helper.js", 1],
      ["src/z-helper.js", 1],
      ["src/nested.js", 2],
    ],
  );
  assert.ok(result.path.every((step) => !step.id.includes("test")));
  assert.deepEqual(
    result.safeStarters.map(({ id }) => id),
    [
      "src/a-helper.js",
      "src/index.js",
      "src/main.js",
      "src/nested.js",
      "src/worker.js",
    ],
  );
});

test("buildOnboarding falls back to highest fan-out when no root has imports", () => {
  const graph = {
    nodes: [
      node("src/a.js", { fanIn: 1, fanOut: 1 }),
      node("src/b.js", { fanIn: 1, fanOut: 4 }),
    ],
    edges: [{ source: "src/a.js", target: "src/b.js" }],
  };
  assert.equal(
    buildOnboarding({ graph, analysis: { files: {} } }).entry,
    "src/b.js",
  );
});

test("buildOnboarding is deterministic and caps the reading path at eight", () => {
  const nodes = Array.from({ length: 10 }, (_, index) =>
    node(`src/file-${String(index).padStart(2, "0")}.js`, {
      fanIn: index === 0 ? 0 : 1,
      fanOut: index === 0 ? 9 : index < 9 ? 1 : 0,
    }),
  );
  const edges = nodes.slice(0, -1).map((entry, index) => ({
    source: entry.id,
    target: nodes[index + 1].id,
  }));
  const graph = { nodes, edges };
  const first = buildOnboarding({ graph, analysis: { files: {} } });
  const second = buildOnboarding({ graph, analysis: { files: {} } });
  assert.deepEqual(first, second);
  assert.equal(first.path.length, 8);
  assert.equal(first.path[0].id, "src/file-00.js");
});

test("buildOnboarding returns empty entry and path for an empty graph", () => {
  assert.deepEqual(
    buildOnboarding({
      graph: { nodes: [], edges: [] },
      analysis: {},
      issues: [],
    }),
    { entry: null, path: [], safeStarters: [], issues: [] },
  );
});

test("buildOnboarding matches issues and assigns difficulty from impact", () => {
  const graph = {
    nodes: [
      node("src/Widget.tsx", { blastRadius: 4, complexity: 5 }),
      node("src/engine.js", { blastRadius: 30, complexity: 2 }),
      node("src/other.js", { blastRadius: 8, complexity: 12 }),
    ],
    edges: [],
  };
  const result = buildOnboarding({
    graph,
    analysis: {
      files: {
        "src/engine.js": {
          functions: [{ name: "refreshEngine", kind: "function" }],
        },
      },
    },
    issues: [
      { number: 3, title: "Unrelated request", labels: [] },
      {
        number: 2,
        title: "Refresh refreshEngine",
        labels: ["good first issue"],
      },
      { number: 1, title: "Fix Widget.tsx", labels: [] },
    ],
  });
  assert.deepEqual(
    result.issues.map(({ number, difficulty }) => [number, difficulty]),
    [
      [1, "easy"],
      [2, "hard"],
      [3, "unknown"],
    ],
  );
});

function node(id, overrides = {}) {
  return {
    id,
    loc: 80,
    complexity: 2,
    churn: 1,
    functionCount: 1,
    blastRadius: 2,
    fanIn: 0,
    fanOut: 0,
    ...overrides,
  };
}
