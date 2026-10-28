import assert from "node:assert/strict";
import test from "node:test";
import { countChurn } from "../utils/churn.js";

test("countChurn counts a file at most once per commit", () => {
  const rawLog = "src/a.js\nsrc/a.js\nsrc/b.js\n\nsrc/a.js\r\nsrc/c.js\r\n";

  assert.deepEqual(
    [...countChurn(rawLog).entries()].sort(([a], [b]) => a.localeCompare(b)),
    [["src/a.js", 2], ["src/b.js", 1], ["src/c.js", 1]],
  );
});

test("countChurn returns an empty map for empty or invalid input", () => {
  assert.deepEqual(countChurn(""), new Map());
  assert.deepEqual(countChurn(undefined), new Map());
});

test("countChurn preserves spaces inside file paths", () => {
  assert.deepEqual([...countChurn("src/file name.js\n").entries()], [["src/file name.js", 1]]);
});
