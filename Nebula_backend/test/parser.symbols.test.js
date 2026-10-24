import assert from "node:assert/strict";
import test from "node:test";
import { parseFile } from "../services/parser.js";

test("collects declarations, expressions, classes, methods, and CommonJS exports in JavaScript", () => {
  const source = [
    "export function declared() { function nestedLocal() {} }",
    "const expression = function namedExpression() {};",
    "const arrow = () => {};",
    "export class Widget {",
    "  method() {}",
    "  #privateMethod() {}",
    "  field = () => {};",
    "}",
    "const LocalClass = class {};",
    "const object = { objectMethod() {} };",
    "export default function () {}",
    "module.exports = function () {};",
    "module.exports.run = function () {};",
    "exports.start = () => {};",
  ].join("\n");
  const result = parseFile(source, "src/symbols.js");

  assert.equal(result.error, null);
  assert.deepEqual(
    result.functions.map(({ name, kind, parent }) => ({ name, kind, parent })),
    [
      { name: "declared", kind: "function", parent: null },
      { name: "nestedLocal", kind: "function", parent: null },
      { name: "namedExpression", kind: "function", parent: null },
      { name: "arrow", kind: "function", parent: null },
      { name: "Widget", kind: "class", parent: null },
      { name: "Widget.method", kind: "method", parent: "Widget" },
      { name: "Widget.#privateMethod", kind: "method", parent: "Widget" },
      { name: "Widget.field", kind: "method", parent: "Widget" },
      { name: "LocalClass", kind: "class", parent: null },
      { name: "object.objectMethod", kind: "method", parent: null },
      { name: "default", kind: "function", parent: null },
      { name: "default", kind: "function", parent: null },
      { name: "run", kind: "function", parent: null },
      { name: "start", kind: "function", parent: null },
    ],
  );
  assert.ok(
    result.functions.every(({ id }) => id.startsWith("src/symbols.js#")),
  );

  const declared = result.functions.find(({ name }) => name === "declared");
  const nestedLocal = result.functions.find(
    ({ name }) => name === "nestedLocal",
  );
  const widget = result.functions.find(({ kind }) => kind === "class");
  const defaultFunctions = result.functions.filter(
    ({ name }) => name === "default",
  );
  assert.equal(declared.exported, true);
  assert.equal(nestedLocal.exported, false);
  assert.equal(defaultFunctions[0].isDefaultExport, true);
  assert.equal(defaultFunctions[1].isDefaultExport, true);
  assert.equal(widget.exported, true);
  assert.equal(
    result.functions.find(({ name }) => name === "Widget.method").exported,
    true,
  );
  assert.equal(widget.complexity, 3);
});

test("collects TypeScript methods and skips declaration and overload signatures", () => {
  const source = [
    "declare function ambient(value: string): void;",
    "function overloaded(value: string): string;",
    "function overloaded(value: unknown) { return String(value); }",
    "class Service {",
    "  declareMethod(value: string): void;",
    "  run(value: string): string { return value; }",
    "}",
  ].join("\n");
  const result = parseFile(source, "src/service.ts");

  assert.equal(result.error, null);
  assert.deepEqual(
    result.functions.map(({ name, kind }) => [name, kind]),
    [
      ["overloaded", "function"],
      ["Service", "class"],
      ["Service.run", "method"],
    ],
  );
  assert.equal(result.functions[0].line, 3);
});

test("collects functions in JSX and TSX source files", () => {
  const jsx = parseFile(
    "function Button() { return <button />; }\nconst View = () => <div />;",
    "src/Button.jsx",
  );
  const tsx = parseFile(
    "type Props = { label: string };\nexport const View = ({ label }: Props) => <div>{label}</div>;",
    "src/View.tsx",
  );

  assert.equal(jsx.error, null);
  assert.deepEqual(
    jsx.functions.map(({ name }) => name),
    ["Button", "View"],
  );
  assert.equal(tsx.error, null);
  assert.deepEqual(
    tsx.functions.map(({ name }) => name),
    ["View"],
  );
  assert.equal(tsx.functions[0].exported, true);
});

test("extracts import and require bindings", () => {
  const source = [
    'import fallback, { original as renamed, named } from "./module.js";',
    'import * as namespace from "./namespace.js";',
    'const common = require("./common.cjs");',
    'const { first, second: localSecond } = require("./parts.cjs");',
  ].join("\n");
  const result = parseFile(source, "src/bindings.js");

  assert.equal(result.error, null);
  assert.deepEqual(
    [...result.bindings],
    [
      ["fallback", { source: "./module.js", imported: "default" }],
      ["renamed", { source: "./module.js", imported: "original" }],
      ["named", { source: "./module.js", imported: "named" }],
      ["namespace", { source: "./namespace.js", imported: "*" }],
      ["common", { source: "./common.cjs", imported: "*" }],
      ["first", { source: "./parts.cjs", imported: "first" }],
      ["localSecond", { source: "./parts.cjs", imported: "second" }],
    ],
  );
});

test("records calls under the innermost function and at module scope", () => {
  const result = parseFile(
    [
      "topLevel();",
      "function caller() {",
      "  direct();",
      "  object.method();",
      "  this.other();",
      "  new Widget();",
      "  obj[key]();",
      "  function nested() { inside(); }",
      "}",
    ].join("\n"),
    "src/calls.js",
  );
  const caller = result.functions.find(({ name }) => name === "caller");
  const nested = result.functions.find(({ name }) => name === "nested");

  assert.deepEqual(result.calls, [
    {
      callerId: "<module>",
      name: "topLevel",
      object: null,
      property: null,
      line: 1,
    },
    {
      callerId: caller.id,
      name: "direct",
      object: null,
      property: null,
      line: 3,
    },
    {
      callerId: caller.id,
      name: "object.method",
      object: "object",
      property: "method",
      line: 4,
    },
    {
      callerId: caller.id,
      name: "this.other",
      object: "this",
      property: "other",
      line: 5,
    },
    {
      callerId: caller.id,
      name: "Widget",
      object: null,
      property: null,
      line: 6,
    },
    {
      callerId: nested.id,
      name: "inside",
      object: null,
      property: null,
      line: 8,
    },
  ]);
});

test("calculates function and file cyclomatic complexity", () => {
  const empty = parseFile("function empty() {}", "empty.js");
  assert.equal(empty.functions[0].complexity, 1);
  assert.equal(empty.complexity, 1);

  const oneIf = parseFile("function check(x) { if (x) return true; }", "if.js");
  assert.equal(oneIf.functions[0].complexity, 2);

  const decisions = parseFile(
    "function run(a, b) { if (a && b) { for (;;) break; } }",
    "decisions.js",
  );
  assert.equal(decisions.functions[0].complexity, 4);

  const switchResult = parseFile(
    "function choose(x) { switch (x) { case 1: break; case 2: break; case 3: break; default: break; } }",
    "switch.js",
  );
  assert.equal(switchResult.functions[0].complexity, 4);
});

test("does not include nested function decisions in the outer function complexity", () => {
  const result = parseFile(
    "function outer(x) { if (x) { function inner(y) { while (y) break; } } }",
    "nested.js",
  );

  assert.deepEqual(
    result.functions.map(({ name, complexity }) => [name, complexity]),
    [
      ["outer", 2],
      ["inner", 2],
    ],
  );
  assert.equal(result.complexity, 3);
});

test("returns empty analysis collections and an error for invalid syntax", () => {
  const result = parseFile("export const = ;", "src/broken.js");

  assert.deepEqual(result.imports, []);
  assert.deepEqual([...result.bindings], []);
  assert.deepEqual(result.functions, []);
  assert.deepEqual(result.calls, []);
  assert.equal(result.complexity, 0);
  assert.equal(typeof result.error, "string");
  assert.notEqual(result.error.length, 0);
});
