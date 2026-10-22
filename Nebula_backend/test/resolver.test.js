import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadAliases, resolveImport } from "../services/resolver.js";

test("resolves exact relative paths before fallback candidates", () => {
  const files = new Set(["src/data.json", "src/data.json.ts"]);

  assert.equal(resolveImport("./data.json", "src/index.ts", files), "src/data.json");
});

test("resolves extensionless imports using the configured extension order", () => {
  const files = new Set(["src/module.js", "src/module.ts"]);

  assert.equal(resolveImport("./module", "src/index.ts", files), "src/module.ts");
});

test("resolves directory imports to index files", () => {
  const files = new Set(["src/widgets/index.tsx"]);

  assert.equal(resolveImport("./widgets", "src/index.ts", files), "src/widgets/index.tsx");
});

test("maps JavaScript ESM specifiers to TypeScript source files", () => {
  const files = new Set(["src/util.tsx"]);

  assert.equal(resolveImport("./util.js", "src/index.ts", files), "src/util.tsx");
});

test("resolves parent directory imports", () => {
  const files = new Set(["src/shared/helper.mjs"]);

  assert.equal(resolveImport("../shared/helper", "src/pages/index.ts", files), "src/shared/helper.mjs");
});

test("ignores bare package names and refuses paths escaping the repository", () => {
  const files = new Set(["outside/file.ts", "src/index.ts"]);

  assert.equal(resolveImport("express", "src/index.ts", files), null);
  assert.equal(resolveImport("react", "src/index.ts", files), null);
  assert.equal(resolveImport("node:fs", "src/index.ts", files), null);
  assert.equal(resolveImport("../../../outside/file", "src/nested/index.ts", files), null);
  assert.equal(resolveImport("../../outside/file", "src/index.ts", files), null);
});

test("resolves aliases supplied through options", () => {
  const files = new Set(["src/components/Button.tsx"]);

  assert.equal(
    resolveImport("@/components/Button", "src/pages/index.ts", files, {
      aliases: [{ prefix: "@/", targets: ["src/*"] }],
    }),
    "src/components/Button.tsx",
  );
});

test("does not resolve bare packages through a catch-all alias", () => {
  assert.equal(
    resolveImport("react", "src/index.ts", new Set(["src/react.ts"]), {
      aliases: [{ prefix: "*", targets: ["src/*"] }],
    }),
    null,
  );
});

test("loads baseUrl and paths from commented JSONC with trailing commas", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nebula-resolver-test-"));

  try {
    await writeFile(
      path.join(root, "tsconfig.json"),
      `{
        // Project aliases
        "compilerOptions": {
          "baseUrl": ".",
          "paths": {
            "@/*": ["src/*",],
          },
        },
      }`,
    );

    const aliases = await loadAliases(root);
    assert.deepEqual(aliases, [{ prefix: "@/", targets: ["src/*"] }]);
    assert.equal(
      resolveImport("@/components/Button", "src/pages/index.ts", new Set(["src/components/Button.tsx"]), {
        aliases,
      }),
      "src/components/Button.tsx",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loads aliases from jsconfig and roots targets at baseUrl", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nebula-resolver-test-"));

  try {
    await writeFile(
      path.join(root, "jsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: "src", paths: { "@/*": ["components/*"] } } }),
    );

    assert.deepEqual(await loadAliases(root), [{ prefix: "@/", targets: ["src/components/*"] }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("returns no aliases when configuration is missing or invalid", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nebula-resolver-test-"));

  try {
    assert.deepEqual(await loadAliases(root), []);
    await writeFile(path.join(root, "tsconfig.json"), "{invalid json");
    assert.deepEqual(await loadAliases(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
