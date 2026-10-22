import assert from "node:assert/strict";
import test from "node:test";
import { searchFiles } from "../services/searchService.js";

const files = [
  "src/index.js",
  "src/utils/api.js",
  "src/components/ApiClient.jsx",
  "README.md",
  "docs/api-notes.md",
];

test("searchFiles finds files whose path contains the query, ignoring case", () => {
  const results = searchFiles(files, "API");
  assert.deepEqual(results.map((r) => r.path).sort(), [
    "docs/api-notes.md",
    "src/components/ApiClient.jsx",
    "src/utils/api.js",
  ]);
});

test("searchFiles returns the documented result shape", () => {
  assert.deepEqual(searchFiles(files, "readme"), [
    { type: "file", name: "README.md", path: "README.md", line: 1 },
  ]);
});

test("searchFiles ranks exact name, then prefix, then contains, then folder-only matches", () => {
  const results = searchFiles(
    ["a/api/zzz.js", "src/myapi.js", "src/apiClient.js", "src/utils/api.js"],
    "api",
  );
  assert.deepEqual(results.map((r) => r.path), [
    "src/utils/api.js", // file is named "api" (ignoring .js)
    "src/apiClient.js", // name starts with "api"
    "src/myapi.js", // name contains "api"
    "a/api/zzz.js", // only the folder contains "api"
  ]);
});

test("searchFiles returns at most 10 results", () => {
  const many = Array.from({ length: 25 }, (_, i) => `src/file${i}.js`);
  assert.equal(searchFiles(many, "file").length, 10);
});

test("searchFiles returns an empty list for blank, missing or unmatched queries", () => {
  assert.deepEqual(searchFiles(files, ""), []);
  assert.deepEqual(searchFiles(files, "   "), []);
  assert.deepEqual(searchFiles(files, undefined), []);
  assert.deepEqual(searchFiles(files, "nothing-matches-this"), []);
});
