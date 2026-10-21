import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildTree, listFiles } from "../services/ingest.js";

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
