import assert from "node:assert/strict";
import test from "node:test";
import { findCycles } from "../services/cycles.js";

test("findCycles returns no components when the graph is acyclic", () => {
  assert.deepEqual(
    findCycles(
      ["a", "b", "c"],
      [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
      ],
    ),
    [],
  );
});

test("findCycles returns a two-file cycle in alphabetical order", () => {
  assert.deepEqual(
    findCycles(
      [{ id: "b" }, { id: "a" }],
      [
        { source: "a", target: "b" },
        { source: "b", target: "a" },
      ],
    ),
    [["a", "b"]],
  );
});

test("findCycles returns a three-file strongly connected component", () => {
  assert.deepEqual(
    findCycles(
      ["c", "a", "b"],
      [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
        { source: "c", target: "a" },
      ],
    ),
    [["a", "b", "c"]],
  );
});

test("findCycles sorts separate components by size, then first file", () => {
  assert.deepEqual(
    findCycles(
      ["z2", "z1", "m2", "m1", "a3", "a1", "a2"],
      [
        { source: "z1", target: "z2" },
        { source: "z2", target: "z1" },
        { source: "m1", target: "m2" },
        { source: "m2", target: "m1" },
        { source: "a1", target: "a2" },
        { source: "a2", target: "a3" },
        { source: "a3", target: "a1" },
      ],
    ),
    [
      ["a1", "a2", "a3"],
      ["m1", "m2"],
      ["z1", "z2"],
    ],
  );
});

test("findCycles handles a 5000-node chain without recursion", () => {
  const nodes = Array.from({ length: 5000 }, (_, index) => `node-${index}`);
  const edges = nodes.slice(0, -1).map((source, index) => ({
    source,
    target: nodes[index + 1],
  }));

  assert.deepEqual(findCycles(nodes, edges), []);
});

test("findCycles includes a file that imports itself", () => {
  assert.deepEqual(findCycles(["self"], [{ source: "self", target: "self" }]), [
    ["self"],
  ]);
});
