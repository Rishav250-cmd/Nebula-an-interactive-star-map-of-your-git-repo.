import assert from "node:assert/strict";
import test from "node:test";
import { parseImports } from "../services/parser.js";

test("parses static imports with default, named, and namespace specifiers", () => {
  const result = parseImports(
    [
      'import value from "./default.js";',
      'import { named } from "./named.js";',
      'import * as namespace from "./namespace.js";',
    ].join("\n"),
    "src/index.js",
  );

  assert.deepEqual(result, {
    imports: [
      { specifier: "./default.js", kind: "import" },
      { specifier: "./named.js", kind: "import" },
      { specifier: "./namespace.js", kind: "import" },
    ],
    error: null,
  });
});

test("parses side-effect-only imports", () => {
  assert.deepEqual(parseImports('import "./polyfills.js";', "src/index.js"), {
    imports: [{ specifier: "./polyfills.js", kind: "import" }],
    error: null,
  });
});

test("parses type-only imports", () => {
  assert.deepEqual(parseImports('import type { User } from "./types";', "src/index.ts"), {
    imports: [{ specifier: "./types", kind: "import" }],
    error: null,
  });
});

test("parses named and star re-exports", () => {
  assert.deepEqual(
    parseImports('export { item } from "./item";\nexport * from "./all";', "src/index.js"),
    {
      imports: [
        { specifier: "./item", kind: "export-from" },
        { specifier: "./all", kind: "export-from" },
      ],
      error: null,
    },
  );
});

test("parses CommonJS require calls with literal arguments only", () => {
  assert.deepEqual(
    parseImports('const a = require("./a");\nconst b = require(name);', "src/index.cjs"),
    { imports: [{ specifier: "./a", kind: "require" }], error: null },
  );
});

test("parses dynamic imports with literal arguments only", () => {
  assert.deepEqual(
    parseImports('const a = import("./a");\nconst b = import(name);', "src/index.mjs"),
    { imports: [{ specifier: "./a", kind: "dynamic" }], error: null },
  );
});

test("parses TypeScript import-equals require declarations", () => {
  assert.deepEqual(parseImports('import logger = require("./logger");', "src/index.ts"), {
    imports: [{ specifier: "./logger", kind: "require" }],
    error: null,
  });
});

test("parses JSX files", () => {
  assert.deepEqual(
    parseImports('import React from "react";\nconst View = () => <div />;', "src/View.jsx"),
    { imports: [{ specifier: "react", kind: "import" }], error: null },
  );
});

test("parses TSX files", () => {
  assert.deepEqual(
    parseImports('import type { User } from "./types";\ntype Props = { user: User };\nconst View = ({ user }: Props) => <div>{user.name}</div>;', "src/View.tsx"),
    { imports: [{ specifier: "./types", kind: "import" }], error: null },
  );
});

test("deduplicates identical specifiers even when import forms differ", () => {
  assert.deepEqual(
    parseImports('import value from "./value";\nconst same = require("./value");', "src/index.js"),
    { imports: [{ specifier: "./value", kind: "import" }], error: null },
  );
});

test("returns a parse error instead of throwing on invalid syntax", () => {
  const result = parseImports("export const = ;", "src/broken.js");

  assert.deepEqual(result.imports, []);
  assert.equal(typeof result.error, "string");
  assert.notEqual(result.error.length, 0);
});
