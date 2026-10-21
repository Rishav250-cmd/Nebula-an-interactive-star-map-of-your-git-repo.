import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRepositoryGraph,
  extractImportSpecifiers,
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

test("extractImportSpecifiers finds static, dynamic, and CommonJS imports", () => {
  const source = [
    'import value from "./value.js";',
    'export { helper } from "../shared/helper";',
    'const lazy = import("./lazy");',
    'const common = require("./common");',
  ].join("\n");

  assert.deepEqual(extractImportSpecifiers(source), ["./value.js", "../shared/helper", "./lazy", "./common"]);
});

test("resolveRelativeImport resolves extensionless imports and ignores packages", () => {
  const files = new Set(["src/value.ts", "shared/helper.ts"]);

  assert.equal(resolveRelativeImport("src/index.ts", "./value", files), "src/value.ts");
  assert.equal(resolveRelativeImport("src/index.ts", "../shared/helper", files), "shared/helper.ts");
  assert.equal(resolveRelativeImport("src/index.ts", "react", files), null);
});

test("buildRepositoryGraph creates nodes and internal import edges from GitHub data", async () => {
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(url);

    if (url === "https://api.github.com/repos/octocat/demo") {
      return jsonResponse({ full_name: "octocat/demo", html_url: "https://github.com/octocat/demo", default_branch: "main" });
    }
    if (url === "https://api.github.com/repos/octocat/demo/branches/main") {
      return jsonResponse({ commit: { sha: "commit-sha", commit: { tree: { sha: "tree-sha" } } } });
    }
    if (url === "https://api.github.com/repos/octocat/demo/git/trees/tree-sha?recursive=1") {
      return jsonResponse({
        truncated: false,
        tree: [
          { type: "blob", path: "src/index.ts", size: 64 },
          { type: "blob", path: "src/util.ts", size: 32 },
          { type: "blob", path: "src/style.css", size: 20 },
        ],
      });
    }
    if (url === "https://raw.githubusercontent.com/octocat/demo/commit-sha/src/index.ts") {
      return textResponse('import { add } from "./util";\nimport "./util.ts";\nimport React from "react";');
    }
    if (url === "https://raw.githubusercontent.com/octocat/demo/commit-sha/src/util.ts") {
      return textResponse("export const add = (left, right) => left + right;");
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const graph = await buildRepositoryGraph("https://github.com/octocat/demo", { fetchImpl });

  assert.equal(graph.repository.name, "octocat/demo");
  assert.deepEqual(graph.nodes.map(({ id }) => id), ["src/index.ts", "src/util.ts"]);
  assert.deepEqual(graph.edges, [{ id: "src/index.ts->src/util.ts", source: "src/index.ts", target: "src/util.ts" }]);
  assert.ok(requestedUrls.some((url) => url.includes("?recursive=1")));
});

test("buildRepositoryGraph rejects a truncated Git tree", async () => {
  const fetchImpl = async (url) => {
    if (url === "https://api.github.com/repos/octocat/demo") return jsonResponse({ default_branch: "main" });
    if (url.endsWith("/branches/main")) {
      return jsonResponse({ commit: { sha: "commit-sha", commit: { tree: { sha: "tree-sha" } } } });
    }
    return jsonResponse({ truncated: true, tree: [] });
  };

  await assert.rejects(
    buildRepositoryGraph("https://github.com/octocat/demo", { fetchImpl }),
    (error) => error instanceof GraphError && error.statusCode === 413,
  );
});

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function textResponse(text, status = 200) {
  return new Response(text, { status, headers: { "content-type": "text/plain" } });
}
