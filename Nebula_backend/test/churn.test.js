import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { simpleGit } from "simple-git";
import test from "node:test";
import { getChurn } from "../services/churn.js";
import { buildGraph } from "../services/graph.js";

test("getChurn counts each path once per commit and graph nodes use the counts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nebula-churn-git-"));

  try {
    const git = simpleGit(root);
    await git.init();
    await git.addConfig("user.name", "Nebula Test");
    await git.addConfig("user.email", "nebula-test@example.invalid");

    await commitFiles(git, root, "initial files", {
      "src/a.js": "export const a = 1;\n",
      "src/b.js": "export const b = 1;\n",
    });
    await commitFiles(git, root, "update a", {
      "src/a.js": "export const a = 2;\n",
    });
    await commitFiles(git, root, "update b and add c", {
      "src/b.js": "export const b = 2;\n",
      "src/c.js": "export const c = 1;\n",
    });

    const expected = new Map([
      ["src/a.js", 2],
      ["src/b.js", 2],
      ["src/c.js", 1],
    ]);
    assert.deepEqual(
      sortedEntries(await getChurn(root)),
      sortedEntries(expected),
    );

    const { graph, analysis } = await buildGraph({
      id: "churn-fixture",
      dir: root,
      files: [...expected.keys()],
      repoUrl: "https://github.com/octocat/churn-fixture",
    });
    assert.deepEqual(
      sortedEntries(new Map(graph.nodes.map(({ id, churn }) => [id, churn]))),
      sortedEntries(expected),
    );
    assert.deepEqual(sortedEntries(analysis.churn), sortedEntries(expected));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("getChurn returns an empty Map for a directory without a Git repository", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nebula-churn-empty-"));

  try {
    assert.deepEqual(await getChurn(root), new Map());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("getChurn returns an empty Map for a shallow repository", async () => {
  const source = await mkdtemp(path.join(os.tmpdir(), "nebula-churn-source-"));
  const cloneRoot = await mkdtemp(
    path.join(os.tmpdir(), "nebula-churn-shallow-"),
  );

  try {
    const git = simpleGit(source);
    await git.init();
    await git.addConfig("user.name", "Nebula Test");
    await git.addConfig("user.email", "nebula-test@example.invalid");
    await commitFiles(git, source, "initial file", {
      "src/index.js": "export {};\n",
    });
    await commitFiles(git, source, "second file revision", {
      "src/index.js": "export const value = 1;\n",
    });

    const shallowClone = path.join(cloneRoot, "clone");
    await simpleGit().clone(pathToFileURL(source).href, shallowClone, [
      "--depth",
      "1",
    ]);
    assert.equal(
      (
        await simpleGit(shallowClone).raw([
          "rev-parse",
          "--is-shallow-repository",
        ])
      ).trim(),
      "true",
    );
    assert.deepEqual(await getChurn(shallowClone), new Map());
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(cloneRoot, { recursive: true, force: true });
  }
});

test("ZIP graphs have zero churn when there is no Git history", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nebula-churn-zip-"));

  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "index.js"), "export {};\n");
    const { graph, analysis } = await buildGraph({
      id: "churn-zip-fixture",
      dir: root,
      files: ["src/index.js"],
      repoUrl: "upload.zip",
    });

    assert.equal(graph.nodes[0].churn, 0);
    assert.deepEqual(analysis.churn, new Map());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function commitFiles(git, root, message, files) {
  for (const [relativePath, contents] of Object.entries(files)) {
    const fullPath = path.join(root, relativePath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, contents);
  }
  await git.add(Object.keys(files));
  await git.commit(message);
}

function sortedEntries(map) {
  return [...map.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
}
