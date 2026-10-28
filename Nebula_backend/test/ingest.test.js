import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { simpleGit } from "simple-git";
import { buildTree, cloneRepo, listFiles, repoIdFor } from "../services/ingest.js";
import { NebulaError } from "../services/errors.js";

test("cloneRepo returns its cloned directory and checked-out commit SHA", async () => {
  const source = await mkdtemp(path.join(os.tmpdir(), "nebula-clone-source-"));
  let cloneDir;

  try {
    await mkdir(path.join(source, "src"), { recursive: true });
    await writeFile(path.join(source, "src", "index.js"), "export const value = 1;");
    const git = simpleGit(source);
    await git.init();
    await git.addConfig("user.name", "Nebula Test");
    await git.addConfig("user.email", "nebula-test@example.com");
    await git.add("src/index.js");
    await git.commit("fixture commit");
    const expectedSha = (await git.revparse(["HEAD"])).trim();

    const cloned = await cloneRepo(source);
    cloneDir = cloned.dir;

    assert.equal(cloned.sha, expectedSha);
    assert.equal(typeof cloned.defaultBranch, "string");
    assert.equal(typeof cloned.shallow, "boolean");
    assert.equal(cloned.id.length, 10);
    assert.equal((await listFiles(cloned.dir)).includes("src/index.js"), true);
  } finally {
    if (cloneDir) await rm(cloneDir, { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
  }
});

test("listFiles returns relative POSIX paths and skips generated and binary files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nebula-ingest-test-"));
  let outside;

  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
    await mkdir(path.join(root, "dist"), { recursive: true });
    await writeFile(path.join(root, "src", "index.js"), "export {};");
    await writeFile(path.join(root, "src", "bundle.min.js"), "minified");
    await writeFile(path.join(root, "package-lock.json"), "{}");
    await writeFile(path.join(root, "yarn.lock"), "");
    await writeFile(path.join(root, "logo.svg"), "<svg />");
    await writeFile(path.join(root, "node_modules", "pkg", "index.js"), "ignored");
    await writeFile(path.join(root, "dist", "app.js"), "ignored");
    outside = await mkdtemp(path.join(os.tmpdir(), "nebula-ingest-outside-"));
    await writeFile(path.join(outside, "secret.js"), "outside");
    await symlink(outside, path.join(root, "outside-link"));

    assert.deepEqual(await listFiles(root), ["src/index.js"]);
  } finally {
    if (outside) await rm(outside, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("cloneRepo rejects an empty repository and removes its destination", async () => {
  const source = await mkdtemp(path.join(os.tmpdir(), "nebula-empty-source-"));
  const repoDir = await mkdtemp(path.join(os.tmpdir(), "nebula-empty-clone-"));
  const target = path.join(repoDir, repoIdFor(source));
  try {
    await simpleGit(source).init(true);
    await assert.rejects(
      cloneRepo(source, { repoDir }),
      (error) => error instanceof NebulaError && error.code === "EMPTY_REPO",
    );
    await assert.rejects(access(target), { code: "ENOENT" });
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(repoDir, { recursive: true, force: true });
  }
});

test("cloneRepo enforces its timeout and cleans up the destination", async () => {
  const repoDir = await mkdtemp(path.join(os.tmpdir(), "nebula-timeout-clone-"));
  const url = "local-slow-repository";
  const target = path.join(repoDir, repoIdFor(url));
  try {
    await assert.rejects(
      cloneRepo(url, {
        repoDir,
        timeoutMs: 10,
        runGitImpl: (_args, { signal }) => new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), { once: true });
        }),
      }),
      (error) => error instanceof NebulaError && error.code === "CLONE_TIMEOUT",
    );
    await assert.rejects(access(target), { code: "ENOENT" });
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

test("cloneRepo watchdog stops oversized clones and cleans up", async () => {
  const repoDir = await mkdtemp(path.join(os.tmpdir(), "nebula-large-clone-"));
  const url = "local-oversized-repository";
  const target = path.join(repoDir, repoIdFor(url));
  try {
    await assert.rejects(
      cloneRepo(url, {
        repoDir,
        maxCloneMb: 0.00001,
        watchdogIntervalMs: 5,
        runGitImpl: async (_args, { signal }) => {
          await mkdir(target, { recursive: true });
          await writeFile(path.join(target, "large.bin"), "this is over the test size limit");
          return new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), { once: true });
          });
        },
      }),
      (error) => error instanceof NebulaError && error.code === "REPO_TOO_LARGE",
    );
    await assert.rejects(access(target), { code: "ENOENT" });
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

test("cloneRepo translates repository-not-found stderr and cleans up", async () => {
  const repoDir = await mkdtemp(path.join(os.tmpdir(), "nebula-not-found-clone-"));
  const url = "missing-local-repository";
  const target = path.join(repoDir, repoIdFor(url));
  try {
    await assert.rejects(
      cloneRepo(url, {
        repoDir,
        runGitImpl: async () => {
          const error = new Error("git clone failed");
          error.stderr = "fatal: repository not found";
          throw error;
        },
      }),
      (error) => error instanceof NebulaError && error.code === "REPO_NOT_FOUND",
    );
    await assert.rejects(access(target), { code: "ENOENT" });
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

test("cloneRepo preflight rejects oversized repositories before cloning", async () => {
  const repoDir = await mkdtemp(path.join(os.tmpdir(), "nebula-preflight-large-"));
  let cloneStarted = false;
  try {
    await assert.rejects(
      cloneRepo("https://github.com/nebula-test-large/repository", {
        repoDir,
        maxRepoMb: 250,
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ size: 260000 }),
        }),
        runGitImpl: async () => { cloneStarted = true; },
      }),
      (error) => error instanceof NebulaError
        && error.code === "REPO_TOO_LARGE"
        && error.details.limitMb === 250,
    );
    assert.equal(cloneStarted, false);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

test("cloneRepo preflight maps GitHub 404 to REPO_NOT_FOUND", async () => {
  const repoDir = await mkdtemp(path.join(os.tmpdir(), "nebula-preflight-missing-"));
  try {
    await assert.rejects(
      cloneRepo("https://github.com/nebula-test-missing/repository", {
        repoDir,
        fetchImpl: async () => ({ ok: false, status: 404 }),
        runGitImpl: async () => assert.fail("clone must not start after a 404"),
      }),
      (error) => error instanceof NebulaError && error.code === "REPO_NOT_FOUND",
    );
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

test("buildTree creates nested directory objects and null file leaves", () => {
  assert.deepEqual(buildTree(["src/index.js", "src/lib/util.js", "README.md"]), {
    src: { "index.js": null, lib: { "util.js": null } },
    "README.md": null,
  });
});
