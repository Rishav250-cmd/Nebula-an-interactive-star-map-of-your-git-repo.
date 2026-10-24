import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import test from "node:test";
import { buildGraph } from "../services/graph.js";
import { listFiles } from "../services/ingest.js";

test("buildGraph returns code nodes, resolved import edges, metrics, and parse warnings", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "nebula-graph-builder-test-"),
  );

  try {
    const git = await initializeGitRepository(root);
    await mkdir(path.join(root, "src", "barrel"), { recursive: true });
    await writeFile(
      path.join(root, "src", "main.ts"),
      [
        'import { util } from "./util.js";',
        'import "./util.js";',
        'import React from "react";',
        "",
        "export const main = util;",
      ].join("\n"),
    );
    await writeFile(
      path.join(root, "src", "util.ts"),
      "export const util = 1;\n",
    );
    await writeFile(
      path.join(root, "src", "view.jsx"),
      "export const View = () => <div />;\n",
    );
    await writeFile(
      path.join(root, "src", "common.cjs"),
      'const util = require("./util");\nmodule.exports = util;\n',
    );
    await writeFile(
      path.join(root, "src", "lazy.js"),
      'export const load = () => import("./util");\n',
    );
    await writeFile(
      path.join(root, "src", "barrel", "index.ts"),
      'export * from "../util";\n',
    );
    await writeFile(
      path.join(root, "src", "broken.ts"),
      'import "./util";\nexport const = ;\n',
    );
    await writeFile(
      path.join(root, "src", "cycle-a.ts"),
      'import "./cycle-b";\nimport "./util";\n',
    );
    await writeFile(
      path.join(root, "src", "cycle-b.ts"),
      'import "./cycle-a";\n',
    );
    await writeFile(path.join(root, "src", "self.ts"), 'import "./self";\n');
    await writeFile(path.join(root, "src", "ignored.mts"), "export {};\n");
    await writeFile(path.join(root, "src", "data.json"), "{}");
    await writeFile(path.join(root, "README.md"), "not source code");

    const { graph, analysis } = await buildGraph({
      id: "fixture-id",
      dir: root,
      files: await listFiles(root),
      repoUrl: "https://github.com/octocat/graph-fixture",
    });

    assert.equal(graph.repo, "https://github.com/octocat/graph-fixture");
    assert.equal(graph.sha, (await git.revparse(["HEAD"])).trim());
    assert.deepEqual(
      graph.nodes.map(({ id }) => id),
      [
        "src/barrel/index.ts",
        "src/broken.ts",
        "src/common.cjs",
        "src/cycle-a.ts",
        "src/cycle-b.ts",
        "src/lazy.js",
        "src/main.ts",
        "src/self.ts",
        "src/util.ts",
        "src/view.jsx",
      ],
    );
    assert.deepEqual(graph.edges, [
      {
        source: "src/barrel/index.ts",
        target: "src/util.ts",
        type: "import",
        inCycle: false,
      },
      {
        source: "src/common.cjs",
        target: "src/util.ts",
        type: "import",
        inCycle: false,
      },
      {
        source: "src/cycle-a.ts",
        target: "src/cycle-b.ts",
        type: "import",
        inCycle: true,
      },
      {
        source: "src/cycle-a.ts",
        target: "src/util.ts",
        type: "import",
        inCycle: false,
      },
      {
        source: "src/cycle-b.ts",
        target: "src/cycle-a.ts",
        type: "import",
        inCycle: true,
      },
      {
        source: "src/lazy.js",
        target: "src/util.ts",
        type: "import",
        inCycle: false,
      },
      {
        source: "src/main.ts",
        target: "src/util.ts",
        type: "import",
        inCycle: false,
      },
      {
        source: "src/self.ts",
        target: "src/self.ts",
        type: "import",
        inCycle: true,
      },
    ]);
    assert.deepEqual(graph.cycles, [
      ["src/cycle-a.ts", "src/cycle-b.ts"],
      ["src/self.ts"],
    ]);
    assert.deepEqual(
      graph.warnings.map(({ file }) => file),
      ["src/broken.ts"],
    );

    const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
    assert.deepEqual(
      Object.fromEntries(
        [...nodesById].map(([file, node]) => [file, [node.fanIn, node.fanOut]]),
      ),
      {
        "src/barrel/index.ts": [0, 1],
        "src/broken.ts": [0, 0],
        "src/common.cjs": [0, 1],
        "src/cycle-a.ts": [1, 2],
        "src/cycle-b.ts": [1, 1],
        "src/lazy.js": [0, 1],
        "src/main.ts": [0, 1],
        "src/self.ts": [1, 1],
        "src/util.ts": [5, 0],
        "src/view.jsx": [0, 0],
      },
    );
    assert.equal(nodesById.get("src/main.ts").loc, 4);
    assert.equal(nodesById.get("src/util.ts").loc, 1);
    assert.equal(nodesById.get("src/barrel/index.ts").folder, "src");
    assert.equal(nodesById.get("src/main.ts").complexity, 1);
    assert.equal(nodesById.get("src/main.ts").functionCount, 0);
    assert.equal(nodesById.get("src/lazy.js").complexity, 1);
    assert.equal(nodesById.get("src/lazy.js").functionCount, 1);
    assert.equal(nodesById.get("src/cycle-a.ts").inCycle, true);
    assert.equal(nodesById.get("src/cycle-b.ts").inCycle, true);
    assert.equal(nodesById.get("src/self.ts").inCycle, true);
    assert.equal(nodesById.get("src/util.ts").inCycle, false);
    assert.equal(
      analysis.files["src/main.ts"].bindings.get("util").imported,
      "util",
    );
    assert.equal(analysis.files["src/lazy.js"].functions[0].name, "load");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildGraph skips files larger than 1 MB and reports a warning", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "nebula-graph-builder-test-"),
  );

  try {
    await initializeGitRepository(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "src", "large.js"),
      "x".repeat(1024 * 1024 + 1),
    );
    await writeFile(path.join(root, "src", "small.js"), "export {};\n");

    const { graph } = await buildGraph({
      id: "large-file-fixture",
      dir: root,
      files: ["src/large.js", "src/small.js"],
      repoUrl: "upload.zip",
    });

    assert.deepEqual(
      graph.nodes.map(({ id }) => id),
      ["src/small.js"],
    );
    assert.deepEqual(graph.warnings, [
      { file: "src/large.js", message: "Skipped file larger than 1 MB." },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("graph nodes expose file complexity and function counts", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "nebula-graph-builder-test-"),
  );

  try {
    await initializeGitRepository(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "src", "metrics.js"),
      "function branch(value) { if (value) return 1; return 0; }\nconst arrow = () => {};\n",
    );

    const { graph, analysis } = await buildGraph({
      id: "metrics-fixture",
      dir: root,
      files: ["src/metrics.js"],
      repoUrl: "upload.zip",
    });
    const [node] = graph.nodes;

    assert.equal(node.complexity, 2);
    assert.equal(node.functionCount, 2);
    assert.equal(analysis.files["src/metrics.js"].complexity, 2);
    assert.equal(analysis.files["src/metrics.js"].functions.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("functionCount includes functions and methods but not class declarations", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "nebula-graph-builder-test-"),
  );

  try {
    await initializeGitRepository(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "src", "mixed.js"),
      [
        "class Worker { run() {} }",
        "function start() {}",
        "const finish = () => {};",
      ].join("\n"),
    );
    const { graph } = await buildGraph({
      id: "function-count-fixture",
      dir: root,
      files: ["src/mixed.js"],
      repoUrl: "upload.zip",
    });
    assert.equal(graph.nodes[0].functionCount, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildGraph keeps the first 2000 sorted code files and reports the cap", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "nebula-graph-builder-test-"),
  );

  try {
    await initializeGitRepository(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    const files = [];

    for (let index = 0; index < 2001; index += 1) {
      const file = `src/file-${String(index).padStart(4, "0")}.js`;
      files.push(file);
      await writeFile(path.join(root, ...file.split("/")), "export {};\n");
    }

    const { graph } = await buildGraph({
      id: "cap-fixture",
      dir: root,
      files,
      repoUrl: "https://github.com/octocat/large-fixture",
    });

    assert.equal(graph.nodes.length, 2000);
    assert.equal(graph.nodes[0].id, "src/file-0000.js");
    assert.equal(graph.nodes.at(-1).id, "src/file-1999.js");
    assert.deepEqual(graph.warnings, [
      {
        file: "src/file-2000.js",
        message:
          "Repository has more than 2000 code files; only the first 2000 sorted paths were analyzed.",
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function initializeGitRepository(root) {
  const git = simpleGit(root);
  await git.init();
  await git.addConfig("user.name", "Nebula Test");
  await git.addConfig("user.email", "nebula-test@example.invalid");
  await writeFile(path.join(root, ".seed"), "fixture\n");
  await git.add(".seed");
  await git.commit("create test fixture");
  return git;
}
