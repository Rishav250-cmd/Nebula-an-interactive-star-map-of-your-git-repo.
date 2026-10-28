import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildGraph } from "../services/graph.js";

test("worker parsing preserves the small repository graph", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nebula-parser-worker-"));
  const files = {
    "src/index.js": [
      'import { helper } from "./helper.js";',
      'import { Widget } from "./Widget.tsx";',
      "export const run = () => helper(Widget);",
    ].join("\n"),
    "src/helper.js": [
      'import { run } from "./index.js";',
      "export function helper(value) {",
      "  if (value && run) return 1;",
      "  return 0;",
      "}",
    ].join("\n"),
    "src/Widget.tsx": "export class Widget { render() { return <div />; } }",
    "src/broken.js": "export const = ;",
  };

  try {
    for (const [file, contents] of Object.entries(files)) {
      const fullPath = path.join(dir, file);
      await mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(fullPath, contents);
    }

    const { graph } = await buildGraph({
      id: "small-worker-regression",
      dir,
      files: Object.keys(files),
      repoUrl: "small-worker-regression.zip",
      getChurnImpl: async () => new Map(),
    });

    assert.deepEqual(
      graph.nodes.map(({ id }) => id),
      ["src/broken.js", "src/helper.js", "src/index.js", "src/Widget.tsx"],
    );
    assert.deepEqual(graph.edges, [
      { source: "src/helper.js", target: "src/index.js", type: "import", inCycle: true },
      { source: "src/index.js", target: "src/helper.js", type: "import", inCycle: true },
      { source: "src/index.js", target: "src/Widget.tsx", type: "import", inCycle: false },
    ]);
    assert.deepEqual(graph.cycles, [["src/helper.js", "src/index.js"]]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
