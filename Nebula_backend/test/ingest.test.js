import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { simpleGit } from "simple-git";
import { buildTree, cloneRepo, listFiles } from "../services/ingest.js";

test("cloneRepo returns its cloned directory and checked-out commit SHA", async () => {
  const source = await mkdtemp(path.join(os.tmpdir(), "nebula-clone-source-"));
  let cloneDir;

  try {
    await mkdir(path.join(source, "src"), { recursive: true });
    await writeFile(path.join(source, "src", "index.js"), "export const value = 1;");
    const git = simpleGit(source);
    await git.init();
    await git.addConfig("user.name", "Nebula Test");
    await git.addConfig("user.email", "nebula-test@example.com");
    await git.add("src/index.js");
    await git.commit("fixture commit");
    const expectedSha = (await git.revparse(["HEAD"])).trim();

    const cloned = await cloneRepo(source);
    cloneDir = cloned.dir;

    assert.equal(cloned.sha, expectedSha);
    assert.equal(cloned.id.length, 10);
    assert.equal((await listFiles(cloned.dir)).includes("src/index.js"), true);
  } finally {
    if (cloneDir) await rm(cloneDir, { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
  }
});

test("listFiles returns relative POSIX paths and skips generated and binary files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nebula-ingest-test-"));

  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
    await mkdir(path.join(root, "dist"), { recursive: true });
    await writeFile(path.join(root, "src", "index.js"), "export {};");
    await writeFile(path.join(root, "src", "bundle.min.js"), "minified");
    await writeFile(path.join(root, "package-lock.json"), "{}");
    await writeFile(path.join(root, "yarn.lock"), "");
    await writeFile(path.join(root, "logo.svg"), "<svg />");
    await writeFile(path.join(root, "node_modules", "pkg", "index.js"), "ignored");
    await writeFile(path.join(root, "dist", "app.js"), "ignored");

    assert.deepEqual(await listFiles(root), ["src/index.js"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildTree creates nested directory objects and null file leaves", () => {
  assert.deepEqual(buildTree(["src/index.js", "src/lib/util.js", "README.md"]), {
    src: { "index.js": null, lib: { "util.js": null } },
    "README.md": null,
  });
});
