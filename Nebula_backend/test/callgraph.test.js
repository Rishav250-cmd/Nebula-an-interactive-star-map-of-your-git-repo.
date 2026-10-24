import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildCallGraph } from "../services/callgraph.js";
import { buildGraph } from "../services/graph.js";

test("buildCallGraph resolves local, this, default, named, and namespace calls", async () => {
  const fixture = await buildFixture({
    "src/main.js": [
      'import DefaultFn from "./default.js";',
      'import { namedFn as aliasFn } from "./named.js";',
      'import * as ns from "./namespace.js";',
      "function local() {}",
      "class Worker {",
      "  run() {",
      "    this.step();",
      "    local();",
      "    DefaultFn();",
      "    DefaultFn.method();",
      "    aliasFn();",
      "    aliasFn();",
      "    ns.namespaceFn();",
      "    missing();",
      "  }",
      "  step() {}",
      "}",
    ].join("\n"),
    "src/default.js": [
      'import { deepFn } from "./deep.js";',
      "export function method() {}",
      "export default function DefaultFn() {",
      "  deepFn();",
      "}",
    ].join("\n"),
    "src/named.js": "export function namedFn() {}",
    "src/namespace.js": "export function namespaceFn() {}",
    "src/deep.js": "export function deepFn() {}",
  });

  try {
    const shallow = buildCallGraph(
      fixture.analysis,
      fixture.graph,
      "src/main.js",
    );

    assert.equal(shallow.file, "src/main.js");
    assert.equal(shallow.depth, 1);
    assert.equal(shallow.truncated, false);
    assert.deepEqual(shallow.nodes, [
      {
        id: "src/main.js#local:4",
        name: "local",
        kind: "function",
        file: "src/main.js",
        line: 4,
        endLine: 4,
        complexity: 1,
        external: false,
      },
      {
        id: "src/main.js#Worker:5",
        name: "Worker",
        kind: "class",
        file: "src/main.js",
        line: 5,
        endLine: 17,
        complexity: 2,
        external: false,
      },
      {
        id: "src/main.js#Worker.run:6",
        name: "Worker.run",
        kind: "method",
        file: "src/main.js",
        line: 6,
        endLine: 15,
        complexity: 1,
        external: false,
      },
      {
        id: "src/main.js#Worker.step:16",
        name: "Worker.step",
        kind: "method",
        file: "src/main.js",
        line: 16,
        endLine: 16,
        complexity: 1,
        external: false,
      },
      {
        id: "src/default.js#DefaultFn:3",
        name: "DefaultFn",
        kind: "function",
        file: "src/default.js",
        line: 3,
        endLine: 5,
        complexity: 1,
        external: true,
      },
      {
        id: "src/default.js#method:2",
        name: "method",
        kind: "function",
        file: "src/default.js",
        line: 2,
        endLine: 2,
        complexity: 1,
        external: true,
      },
      {
        id: "src/named.js#namedFn:1",
        name: "namedFn",
        kind: "function",
        file: "src/named.js",
        line: 1,
        endLine: 1,
        complexity: 1,
        external: true,
      },
      {
        id: "src/namespace.js#namespaceFn:1",
        name: "namespaceFn",
        kind: "function",
        file: "src/namespace.js",
        line: 1,
        endLine: 1,
        complexity: 1,
        external: true,
      },
    ]);
    assert.deepEqual(shallow.edges, [
      {
        source: "src/main.js#Worker.run:6",
        target: "src/main.js#Worker.step:16",
        type: "call",
      },
      {
        source: "src/main.js#Worker.run:6",
        target: "src/main.js#local:4",
        type: "call",
      },
      {
        source: "src/main.js#Worker.run:6",
        target: "src/default.js#DefaultFn:3",
        type: "call",
      },
      {
        source: "src/main.js#Worker.run:6",
        target: "src/default.js#method:2",
        type: "call",
      },
      {
        source: "src/main.js#Worker.run:6",
        target: "src/named.js#namedFn:1",
        type: "call",
      },
      {
        source: "src/main.js#Worker.run:6",
        target: "src/namespace.js#namespaceFn:1",
        type: "call",
      },
    ]);

    const deeper = buildCallGraph(
      fixture.analysis,
      fixture.graph,
      "src/main.js",
      { depth: 2 },
    );
    assert.equal(deeper.depth, 2);
    assert.equal(deeper.truncated, false);
    assert.deepEqual(deeper.nodes.at(-1), {
      id: "src/deep.js#deepFn:1",
      name: "deepFn",
      kind: "function",
      file: "src/deep.js",
      line: 1,
      endLine: 1,
      complexity: 1,
      external: true,
    });
    assert.deepEqual(deeper.edges.at(-1), {
      source: "src/default.js#DefaultFn:3",
      target: "src/deep.js#deepFn:1",
      type: "call",
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("buildCallGraph caps nodes at 150 and reports truncation", async () => {
  const count = 151;
  const imports = Array.from(
    { length: count },
    (_, index) => `import { fn${index} } from "./target.js";`,
  );
  const calls = Array.from({ length: count }, (_, index) => `  fn${index}();`);
  const targetFunctions = Array.from(
    { length: count },
    (_, index) => `export function fn${index}() {}`,
  );
  const fixture = await buildFixture({
    "src/main.js": [...imports, "function run() {", ...calls, "}"].join("\n"),
    "src/target.js": targetFunctions.join("\n"),
  });

  try {
    const result = buildCallGraph(
      fixture.analysis,
      fixture.graph,
      "src/main.js",
    );

    assert.equal(result.nodes.length, 150);
    assert.equal(result.edges.length, 149);
    assert.equal(result.nodes[0].id, "src/main.js#run:152");
    assert.equal(result.nodes.at(-1).id, "src/target.js#fn148:149");
    assert.equal(result.truncated, true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("buildCallGraph resolves imports through repository path aliases", async () => {
  const fixture = await buildFixture({
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@/*": ["src/*"] },
      },
    }),
    "src/main.ts": [
      'import { aliasedTarget } from "@/target";',
      "export function caller() { aliasedTarget(); }",
    ].join("\n"),
    "src/target.ts": "export function aliasedTarget() {}",
  });

  try {
    const result = buildCallGraph(
      fixture.analysis,
      fixture.graph,
      "src/main.ts",
    );
    assert.deepEqual(
      result.nodes.map(({ name, external }) => ({ name, external })),
      [
        { name: "caller", external: false },
        { name: "aliasedTarget", external: true },
      ],
    );
    assert.deepEqual(result.edges, [
      {
        source: "src/main.ts#caller:2",
        target: "src/target.ts#aliasedTarget:1",
        type: "call",
      },
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

async function buildFixture(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nebula-callgraph-test-"));

  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const absolutePath = path.join(root, ...relativePath.split("/"));
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content);
    }

    const built = await buildGraph({
      id: "callgraph-fixture",
      dir: root,
      files: Object.keys(files),
      repoUrl: "callgraph-fixture.zip",
    });
    return { root, ...built };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
