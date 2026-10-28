import assert from "node:assert/strict";
import test from "node:test";
import { buildReverseIndex, computeBlast } from "../services/blast.js";

test("blast follows importers outward from a changed file", () => {
  const reverseIndex = buildReverseIndex([
    { source: "a", target: "b" },
    { source: "b", target: "c" },
  ]);
  assert.deepEqual(computeBlast(reverseIndex, "c").affected, [
    { id: "b", depth: 1 },
    { id: "a", depth: 2 },
  ]);
});

test("blast visits a diamond once at its shortest depth", () => {
  const reverseIndex = buildReverseIndex([
    { source: "a", target: "b" },
    { source: "a", target: "c" },
    { source: "b", target: "d" },
    { source: "c", target: "d" },
  ]);
  const result = computeBlast(reverseIndex, "d");
  assert.equal(result.count, 3);
  assert.equal(result.depthMap.a, 2);
  assert.deepEqual(result.byDepth, { 1: 2, 2: 1 });
});

test("blast handles cycles without returning the start file", () => {
  const reverseIndex = buildReverseIndex([
    { source: "a", target: "b" },
    { source: "b", target: "a" },
  ]);
  const result = computeBlast(reverseIndex, "a");
  assert.deepEqual(result.affected, [{ id: "b", depth: 1 }]);
});

test("blast returns zero for isolated and unknown files", () => {
  const reverseIndex = buildReverseIndex([]);
  assert.equal(computeBlast(reverseIndex, "isolated").count, 0);
  assert.equal(computeBlast(reverseIndex, "unknown").count, 0);
});

test("blast respects the depth limit", () => {
  const reverseIndex = buildReverseIndex([
    { source: "a", target: "b" },
    { source: "b", target: "c" },
  ]);
  const result = computeBlast(reverseIndex, "c", { maxDepth: 1 });
  assert.deepEqual(result.affected, [{ id: "b", depth: 1 }]);
  assert.equal(result.maxDepthReached, 1);
});

test("blast caps results and marks truncation only when more are available", () => {
  const reverseIndex = buildReverseIndex([
    { source: "a", target: "changed" },
    { source: "b", target: "changed" },
  ]);
  const limited = computeBlast(reverseIndex, "changed", { cap: 1 });
  assert.equal(limited.count, 1);
  assert.equal(limited.truncated, true);
  const exact = computeBlast(buildReverseIndex([
    { source: "a", target: "changed" },
  ]), "changed", { cap: 1 });
  assert.equal(exact.truncated, false);
});

test("reverse index deduplicates importers", () => {
  const reverseIndex = buildReverseIndex([
    { source: "a", target: "b" },
    { source: "a", target: "b" },
  ]);
  assert.deepEqual(reverseIndex.get("b"), ["a"]);
});
