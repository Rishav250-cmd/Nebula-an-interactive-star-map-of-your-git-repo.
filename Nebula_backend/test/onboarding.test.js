import assert from "node:assert/strict";
import test from "node:test";
import { matchIssueToFiles } from "../services/onboarding.js";

test("matchIssueToFiles matches full and partial paths", () => {
  const nodes = [{ id: "src/utils/api.ts" }];
  for (const mention of ["src/utils/api.ts", "utils/api.ts"]) {
    assert.deepEqual(
      matchIssueToFiles({ title: `Please update ${mention}` }, nodes, []),
      [{ id: "src/utils/api.ts", score: 180, reason: "Mentioned by path" }],
    );
  }
});

test("matchIssueToFiles matches a unique file name", () => {
  assert.deepEqual(
    matchIssueToFiles(
      { title: "Fix Navbar.tsx rendering" },
      [{ id: "src/components/Navbar.tsx" }],
      [],
    ),
    [
      {
        id: "src/components/Navbar.tsx",
        score: 120,
        reason: "Mentioned by file name",
      },
    ],
  );
});

test("matchIssueToFiles splits ambiguous basename scores", () => {
  assert.deepEqual(
    matchIssueToFiles(
      { title: "Fix api.ts" },
      [{ id: "src/api.ts" }, { id: "legacy/api.ts" }],
      [],
    ),
    [
      { id: "legacy/api.ts", score: 40, reason: "Mentioned by file name" },
      { id: "src/api.ts", score: 40, reason: "Mentioned by file name" },
    ],
  );
});

test("matchIssueToFiles matches unique function and class names", () => {
  assert.deepEqual(
    matchIssueToFiles(
      { title: "The renderWidget call fails" },
      [{ id: "src/widgets.js" }],
      [{ name: "renderWidget", path: "src/widgets.js" }],
    ),
    [
      {
        id: "src/widgets.js",
        score: 60,
        reason: "Mentions function renderWidget",
      },
    ],
  );
  assert.deepEqual(
    matchIssueToFiles(
      { title: "`WidgetController` throws" },
      [{ id: "src/controller.js" }],
      [{ name: "WidgetController", path: "src/controller.js" }],
    ),
    [
      {
        id: "src/controller.js",
        score: 60,
        reason: "Mentions function WidgetController",
      },
    ],
  );
});

test("matchIssueToFiles matches bare PascalCase component names", () => {
  assert.deepEqual(
    matchIssueToFiles(
      { title: "Navbar does not close" },
      [{ id: "src/components/Navbar.tsx" }],
      [],
    ),
    [
      {
        id: "src/components/Navbar.tsx",
        score: 40,
        reason: "Mentions component Navbar",
      },
    ],
  );
});

test("matchIssueToFiles excludes tests when production matches exist", () => {
  assert.deepEqual(
    matchIssueToFiles(
      { title: "Fix src/App.tsx and App.test.tsx" },
      [{ id: "src/App.tsx" }, { id: "src/App.test.tsx" }],
      [],
    ).map(({ id }) => id),
    ["src/App.tsx"],
  );
});

test("matchIssueToFiles returns at most three deterministic matches", () => {
  const nodes = ["d", "c", "b", "a"].map((letter) => ({
    id: `src/${letter}.ts`,
  }));
  assert.deepEqual(
    matchIssueToFiles(
      { title: "src/a.ts src/b.ts src/c.ts src/d.ts" },
      nodes,
      [],
    ).map(({ id }) => id),
    ["src/a.ts", "src/b.ts", "src/c.ts"],
  );
});

test("matchIssueToFiles returns no results for unmatched text", () => {
  assert.deepEqual(
    matchIssueToFiles(
      { title: "Improve the experience" },
      [{ id: "src/engine.js" }],
      [{ name: "initializeEngine", path: "src/engine.js" }],
    ),
    [],
  );
});
