import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { getChurn } from "../services/churn.js";
import { buildGraph } from "../services/graph.js";
import { countChurn } from "../utils/churn.js";

const execFile = promisify(execFileCallback);

// ---------- countChurn (pure function) ----------

test("countChurn returns an empty map for empty or invalid input", () => {
  assert.equal(countChurn("").size, 0);
  assert.equal(countChurn(undefined).size, 0);
  assert.equal(countChurn(null).size, 0);
  assert.equal(countChurn("\n\n  \n").size, 0);
});

test("countChurn counts one commit per line a file appears on", () => {
  const log = ["src/a.js", "src/b.js", "", "src/a.js", "", "src/a.js", "README.md"].join("\n");
  const counts = countChurn(log);
  assert.equal(counts.get("src/a.js"), 3);
  assert.equal(counts.get("src/b.js"), 1);
  assert.equal(counts.get("README.md"), 1);
  assert.equal(counts.size, 3);
});

test("countChurn ignores blank lines and Windows line endings", () => {
  const counts = countChurn("a.js\r\n\r\nb.js\r\n\r\na.js\r\n");
  assert.equal(counts.get("a.js"), 2);
  assert.equal(counts.get("b.js"), 1);
});

test("countChurn keeps paths with spaces and treats different folders as different files", () => {
  const counts = countChurn("docs/my notes.md\nsrc/index.js\nlib/index.js\nsrc/index.js\n");
  assert.equal(counts.get("docs/my notes.md"), 1);
  assert.equal(counts.get("src/index.js"), 2);
  assert.equal(counts.get("lib/index.js"), 1);
});

test("countChurn is safe with names like constructor or __proto__", () => {
  const counts = countChurn("constructor\n__proto__\nconstructor\n");
  assert.equal(counts.get("constructor"), 2);
  assert.equal(counts.get("__proto__"), 1);
});

// ---------- getChurn (real git repository) ----------

async function git(dir, args, env = {}) {
  await execFile("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
    cwd: dir,
    env: { ...process.env, ...env },
  });
}

async function commitFile(dir, name, content, env) {
  await writeFile(path.join(dir, name), content);
  await git(dir, ["add", name]);
  await git(dir, ["commit", "-q", "-m", `change ${name} ${content}`], env);
}

test("getChurn counts commits from the last 12 months and ignores older ones", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nebula-churn-"));
  try {
    await git(dir, ["init", "-q"]);

    const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString();
    const oldDates = { GIT_AUTHOR_DATE: twoYearsAgo, GIT_COMMITTER_DATE: twoYearsAgo };
    await commitFile(dir, "a.js", "old", oldDates); // too old: must not count

    await commitFile(dir, "a.js", "v1");
    await commitFile(dir, "a.js", "v2");
    await commitFile(dir, "a.js", "v3");
    await commitFile(dir, "b.js", "v1");

    const churn = await getChurn(dir);
    assert.equal(churn.get("a.js"), 3);
    assert.equal(churn.get("b.js"), 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("getChurn returns an empty map when the folder has no git history (e.g. ZIP uploads)", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nebula-churn-nogit-"));
  try {
    await writeFile(path.join(dir, "a.js"), "x");
    const churn = await getChurn(dir);
    assert.equal(churn.size, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------- buildGraph wiring ----------

test("buildGraph puts churn on every node and defaults to 0 for files without history", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nebula-churn-graph-"));
  try {
    await writeFile(path.join(dir, "a.js"), 'import "./b.js";\n');
    await writeFile(path.join(dir, "b.js"), "export const b = 1;\n");

    const { graph } = await buildGraph({
      id: "churn-graph-test",
      dir,
      files: ["a.js", "b.js"],
      repoUrl: "churn-test.zip", // .zip skips the git SHA lookup
      getChurnImpl: async () => new Map([["a.js", 5]]),
    });

    const byId = Object.fromEntries(graph.nodes.map((node) => [node.id, node]));
    assert.equal(byId["a.js"].churn, 5);
    assert.equal(byId["b.js"].churn, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
