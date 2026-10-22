import assert from "node:assert/strict";
import test from "node:test";
import {
  GraphError,
  parseGitHubRepoUrl,
} from "../src/graph.js";
import { resolveImport } from "../services/resolver.js";

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

test("resolveImport resolves relative extensionless and directory imports and ignores packages", () => {
  const files = new Set(["src/value.ts", "shared/helper.ts", "src/widgets/index.ts"]);

  assert.equal(resolveImport("./value", "src/index.ts", files), "src/value.ts");
  assert.equal(resolveImport("../shared/helper", "src/index.ts", files), "shared/helper.ts");
  assert.equal(resolveImport("./widgets", "src/index.ts", files), "src/widgets/index.ts");
  assert.equal(resolveImport("react", "src/index.ts", files), null);
  assert.equal(resolveImport("node:fs", "src/index.ts", files), null);
  assert.equal(resolveImport("../../outside", "src/index.ts", files), null);
});
