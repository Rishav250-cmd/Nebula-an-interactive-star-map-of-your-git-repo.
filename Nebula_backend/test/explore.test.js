import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../app.js";
import { MAX_FILE_BYTES } from "../services/fileService.js";
import { storeAnalysis } from "../services/store.js";

async function makeRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), "nebula-explore-"));
  await mkdir(path.join(root, "src", "utils"), { recursive: true });
  await mkdir(path.join(root, ".git"), { recursive: true });
  await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
  await writeFile(
    path.join(root, "src", "index.js"),
    'import { api } from "./utils/api.js";\nconsole.log(api);\n',
  );
  await writeFile(
    path.join(root, "src", "utils", "api.js"),
    "export const api = 1;",
  );
  await writeFile(
    path.join(root, "src", "App.tsx"),
    "export default function App() {}\n",
  );
  await writeFile(path.join(root, "README.md"), "# Demo\n");
  await writeFile(path.join(root, ".git", "config"), "[core]\n");
  await writeFile(
    path.join(root, "node_modules", "pkg", "index.js"),
    "module.exports = 1;",
  );
  await writeFile(
    path.join(root, "src", "blob.dat"),
    Buffer.from([1, 2, 0, 3]),
  );
  return root;
}

async function withRepo(callback) {
  const root = await makeRepo();
  const id = `explore-${path.basename(root)}`;
  storeAnalysis({ id, dir: root, url: "https://github.com/octocat/demo" });
  try {
    await withServer(createApp(), (baseUrl) => callback({ baseUrl, id, root }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const getJson = async (url) => {
  const response = await fetch(url);
  return { status: response.status, body: await response.json() };
};

test("GET /api/file returns content, language and loc", async () => {
  await withRepo(async ({ baseUrl, id }) => {
    const { status, body } = await getJson(
      `${baseUrl}/api/file?id=${id}&path=src/index.js`,
    );
    assert.equal(status, 200);
    assert.equal(body.language, "javascript");
    assert.equal(body.loc, 2);
    assert.match(body.content, /console\.log\(api\)/);
    assert.deepEqual(Object.keys(body).sort(), [
      "content",
      "functions",
      "language",
      "loc",
    ]);
    assert.deepEqual(body.functions, []);

    const tsx = await getJson(`${baseUrl}/api/file?id=${id}&path=src/App.tsx`);
    assert.equal(tsx.body.language, "tsx");
    assert.deepEqual(tsx.body.functions, [
      { name: "App", kind: "function", line: 1, endLine: 1, complexity: 1 },
    ]);

    const readme = await getJson(`${baseUrl}/api/file?id=${id}&path=README.md`);
    assert.deepEqual(readme.body.functions, []);
  });
});

test("cached analysis restores its checkout only when source files are requested", async () => {
  const root = await makeRepo();
  const id = `explore-cached-${path.basename(root)}`;
  let cloneCalls = 0;
  storeAnalysis({
    id,
    dir: path.join(root, "missing-checkout"),
    url: "https://github.com/octocat/demo",
    sha: null,
    graph: { nodes: [], edges: [] },
    analysis: { files: {} },
  });
  const app = createApp({
    cloneRepoImpl: async () => {
      cloneCalls += 1;
      return { id, dir: root, sha: null };
    },
  });
  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/file?id=${id}&path=src/index.js`);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).language, "javascript");
      assert.equal(cloneCalls, 1);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("GET /api/file requires id and path", async () => {
  await withRepo(async ({ baseUrl, id }) => {
    assert.equal(
      (await getJson(`${baseUrl}/api/file?path=src/index.js`)).status,
      400,
    );
    assert.equal((await getJson(`${baseUrl}/api/file?id=${id}`)).status, 400);
    assert.equal(
      (await getJson(`${baseUrl}/api/file?id=${id}&path=`)).status,
      400,
    );
  });
});

test("GET /api/file returns 404 for an unknown id, a missing file or a directory", async () => {
  await withRepo(async ({ baseUrl, id }) => {
    assert.equal(
      (await getJson(`${baseUrl}/api/file?id=nope&path=src/index.js`)).status,
      404,
    );
    assert.equal(
      (await getJson(`${baseUrl}/api/file?id=${id}&path=src/missing.js`))
        .status,
      404,
    );
    assert.equal(
      (await getJson(`${baseUrl}/api/file?id=${id}&path=src`)).status,
      404,
    );
  });
});

test("GET /api/file blocks path traversal and absolute paths", async () => {
  await withRepo(async ({ baseUrl, id }) => {
    for (const bad of [
      "../secret.txt",
      "src/../../secret.txt",
      "..%2Fsecret.txt",
      "/etc/passwd",
      "C:/Windows/win.ini",
      "src%5C..%5C..%5Cx",
    ]) {
      const { status } = await getJson(
        `${baseUrl}/api/file?id=${id}&path=${bad}`,
      );
      assert.equal(status, 400, `expected 400 for ${bad}`);
    }
  });
});

test("GET /api/file hides .git and node_modules", async () => {
  await withRepo(async ({ baseUrl, id }) => {
    assert.equal(
      (await getJson(`${baseUrl}/api/file?id=${id}&path=.git/config`)).status,
      404,
    );
    assert.equal(
      (
        await getJson(
          `${baseUrl}/api/file?id=${id}&path=node_modules/pkg/index.js`,
        )
      ).status,
      404,
    );
  });
});

test("GET /api/file refuses binary and oversized files", async () => {
  await withRepo(async ({ baseUrl, id, root }) => {
    assert.equal(
      (await getJson(`${baseUrl}/api/file?id=${id}&path=src/blob.dat`)).status,
      415,
    );

    await writeFile(
      path.join(root, "src", "huge.js"),
      "a".repeat(MAX_FILE_BYTES + 1),
    );
    assert.equal(
      (await getJson(`${baseUrl}/api/file?id=${id}&path=src/huge.js`)).status,
      413,
    );
  });
});

test("GET /api/file does not follow a symlink that points outside the repo", async (t) => {
  await withRepo(async ({ baseUrl, id, root }) => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "nebula-outside-"));
    try {
      await writeFile(path.join(outside, "secret.txt"), "top secret");
      try {
        await symlink(
          path.join(outside, "secret.txt"),
          path.join(root, "src", "link.txt"),
        );
      } catch (error) {
        if (error.code === "EPERM" || error.code === "EACCES")
          return t.skip("symlinks not allowed here");
        throw error;
      }
      const { status, body } = await getJson(
        `${baseUrl}/api/file?id=${id}&path=src/link.txt`,
      );
      assert.equal(status, 400);
      assert.ok(!JSON.stringify(body).includes("top secret"));
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test("GET /api/search returns matching files, best matches first", async () => {
  await withRepo(async ({ baseUrl, id }) => {
    const { status, body } = await getJson(
      `${baseUrl}/api/search?id=${id}&q=API`,
    );
    assert.equal(status, 200);
    assert.deepEqual(body, [
      { type: "file", name: "api.js", path: "src/utils/api.js", line: 1 },
    ]);

    const readme = await getJson(`${baseUrl}/api/search?id=${id}&q=readme`);
    assert.deepEqual(
      readme.body.map((r) => r.path),
      ["README.md"],
    );

    const symbols = await getJson(`${baseUrl}/api/search?id=${id}&q=App`);
    assert.deepEqual(symbols.body, [
      { type: "file", name: "App.tsx", path: "src/App.tsx", line: 1 },
      {
        type: "symbol",
        name: "App",
        path: "src/App.tsx",
        line: 1,
        kind: "function",
      },
    ]);
  });
});

test("GET /api/search skips ignored files and handles empty queries", async () => {
  await withRepo(async ({ baseUrl, id }) => {
    assert.deepEqual(
      (await getJson(`${baseUrl}/api/search?id=${id}&q=config`)).body,
      [],
    );
    assert.deepEqual(
      (await getJson(`${baseUrl}/api/search?id=${id}&q=`)).body,
      [],
    );
    assert.deepEqual(
      (await getJson(`${baseUrl}/api/search?id=${id}`)).body,
      [],
    );
  });
});

test("GET /api/search validates its parameters", async () => {
  await withRepo(async ({ baseUrl, id }) => {
    assert.equal((await getJson(`${baseUrl}/api/search?q=api`)).status, 400);
    assert.equal(
      (await getJson(`${baseUrl}/api/search?id=nope&q=api`)).status,
      404,
    );
    assert.equal(
      (await getJson(`${baseUrl}/api/search?id=${id}&q=a&q=b`)).status,
      400,
    );
    assert.equal(
      (await getJson(`${baseUrl}/api/search?id=${id}&q=${"x".repeat(201)}`))
        .status,
      400,
    );
  });
});

async function withServer(app, callback) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const { port } = server.address();
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
