import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildRepositoryGraph,
  GraphError,
  parseGitHubRepoUrl,
  resolveRelativeImport,
} from "../src/graph.js";

test("parseGitHubRepoUrl accepts a repository URL and optional .git suffix", () => {
  assert.deepEqual(parseGitHubRepoUrl("https://github.com/octocat/hello-world.git"), {
    owner: "octocat",
    repository: "hello-world",
  });
});

test("parseGitHubRepoUrl rejects hosts other than github.com", () => {
  assert.throws(() => parseGitHubRepoUrl("https://example.com/octocat/hello-world"), {
    name: "GraphError",
    statusCode: 400,
  });
});

test("resolveRelativeImport resolves extensionless and directory imports and ignores packages", () => {
  const files = new Set(["src/value.ts", "shared/helper.ts", "src/widgets/index.ts"]);

  assert.equal(resolveRelativeImport("src/index.ts", "./value", files), "src/value.ts");
  assert.equal(resolveRelativeImport("src/index.ts", "../shared/helper", files), "shared/helper.ts");
  assert.equal(resolveRelativeImport("src/index.ts", "./widgets", files), "src/widgets/index.ts");
  assert.equal(resolveRelativeImport("src/index.ts", "react", files), null);
  assert.equal(resolveRelativeImport("src/index.ts", "../../outside", files), null);
});

test("buildRepositoryGraph reads source files from a local clone and returns contract nodes and edges", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nebula-graph-test-"));

  try {
    await mkdir(path.join(root, "src", "two"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "ignored"), { recursive: true });
    await writeFile(path.join(root, "index.ts"), 'import { one } from "./src/one";\nexport const result = one();');
    await writeFile(
      path.join(root, "src", "one.ts"),
      [
        'import { two } from "./two";',
        'import "./two/index.ts";',
        'const lazy = import("./two");',
        'const common = require("./two");',
        'import external from "some-package";',
        "export const one = () => two();",
      ].join("\n"),
    );
    await writeFile(path.join(root, "src", "two", "index.ts"), 'import "../../index";\nexport const two = () => 2;');
    await writeFile(path.join(root, "README.md"), "not a source file");
    await writeFile(path.join(root, "node_modules", "ignored", "index.js"), "ignored source");

    const graph = await buildRepositoryGraph("https://github.com/octocat/demo", root, { sha: "commit-sha" });

    assert.equal(graph.repo, "octocat/demo");
    assert.equal(graph.sha, "commit-sha");
    assert.deepEqual(graph.nodes.map(({ id }) => id), ["index.ts", "src/one.ts", "src/two/index.ts"]);
    assert.deepEqual(graph.edges, [
      { source: "index.ts", target: "src/one.ts", type: "import" },
      { source: "src/one.ts", target: "src/two/index.ts", type: "import" },
      { source: "src/two/index.ts", target: "index.ts", type: "import" },
    ]);
    assert.deepEqual(graph.cycles, []);

    const [rootNode, oneNode, twoNode] = graph.nodes;
    assert.deepEqual(
      { folder: rootNode.folder, loc: rootNode.loc, complexity: rootNode.complexity, churn: rootNode.churn, healthScore: rootNode.healthScore, isGodFile: rootNode.isGodFile, inCycle: rootNode.inCycle, fanIn: rootNode.fanIn, fanOut: rootNode.fanOut },
      { folder: ".", loc: 2, complexity: 0, churn: 0, healthScore: null, isGodFile: false, inCycle: false, fanIn: 1, fanOut: 1 },
    );
    assert.equal(rootNode.tokens > 0, true);
    assert.equal(oneNode.folder, "src");
    assert.equal(oneNode.fanIn, 1);
    assert.equal(oneNode.fanOut, 1);
    assert.equal(twoNode.fanIn, 1);
    assert.equal(twoNode.fanOut, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildRepositoryGraph requires a commit SHA for the returned graph", async () => {
  await assert.rejects(
    buildRepositoryGraph("https://github.com/octocat/demo", "/tmp/repo", {}),
    (error) => error instanceof GraphError && error.statusCode === 500,
  );
});
