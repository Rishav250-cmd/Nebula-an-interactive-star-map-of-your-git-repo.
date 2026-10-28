import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import AdmZip from "adm-zip";
import test from "node:test";
import { getAnalysis, storeAnalysis } from "../services/store.js";
import { createApp } from "../app.js";
import { buildGraph } from "../services/graph.js";

test("POST /api/analyze stores a clone graph and GET /api/graph/:id returns it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nebula-api-test-"));

  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "src", "index.js"),
      'import { helper } from "./helper";\nexport const output = helper();',
    );
    await writeFile(
      path.join(root, "src", "helper.js"),
      'export const helper = () => "ok";',
    );
    const git = simpleGit(root);
    await git.init();
    await git.addConfig("user.name", "Nebula Test");
    await git.addConfig("user.email", "nebula-test@example.invalid");
    await git.add(".");
    await git.commit("create API fixture");
    const expectedSha = (await git.revparse(["HEAD"])).trim();
    const app = createApp({
      getRemoteShaImpl: async () => null,
      cloneRepoImpl: async (url) => {
        assert.equal(url, "https://github.com/octocat/demo");
        return { id: "analysis-fixture", dir: root, sha: expectedSha };
      },
    });

    await withServer(app, async (baseUrl) => {
      const analyzeResponse = await fetch(`${baseUrl}/api/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://github.com/octocat/demo" }),
      });

      assert.equal(analyzeResponse.status, 200);
      assert.deepEqual(await analyzeResponse.json(), {
        id: "analysis-fixture",
        status: "ready",
      });
      assert.equal(getAnalysis("analysis-fixture").dir, root);
      assert.equal(
        getAnalysis("analysis-fixture").url,
        "https://github.com/octocat/demo",
      );

      const graphResponse = await fetch(
        `${baseUrl}/api/graph/analysis-fixture`,
      );
      const graph = await graphResponse.json();

      assert.equal(graphResponse.status, 200);
      assert.equal(graph.repo, "https://github.com/octocat/demo");
      assert.equal(graph.sha, expectedSha);
      assert.deepEqual(
        graph.nodes.map(({ id }) => id),
        ["src/helper.js", "src/index.js"],
      );
      assert.deepEqual(graph.edges, [
        {
          source: "src/index.js",
          target: "src/helper.js",
          type: "import",
          inCycle: false,
        },
      ]);
      assert.deepEqual(graph.cycles, []);
      assert.deepEqual(graph.warnings, []);
      assert.deepEqual(Object.keys(graph.nodes[0]).sort(), [
        "blastRadius",
        "churn",
        "complexity",
        "fanIn",
        "fanOut",
        "folder",
        "functionCount",
        "healthScore",
        "id",
        "inCycle",
        "isGodFile",
        "loc",
        "tokens",
      ]);
      assert.equal(graph.nodes[0].healthScore, null);
      assert.equal(graph.nodes[0].fanIn, 1);
      assert.equal(graph.nodes[1].fanOut, 1);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("POST /api/analyze rejects invalid GitHub URLs", async () => {
  const app = createApp({
    getRemoteShaImpl: async () => null,
    cloneRepoImpl: async () => {
      throw new Error("clone should not run");
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/owner/repo" }),
    });

    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "Invalid GitHub URL");
  });
});

test("POST /api/analyze returns an error when cloning fails", async () => {
  const app = createApp({
    getRemoteShaImpl: async () => null,
    cloneRepoImpl: async () => {
      throw new Error("clone failed");
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/octocat/demo" }),
    });

    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, "Could not clone repo (private or not found?)");
  });
});

test("GET /api/graph/:id returns 404 when the analysis is unknown", async () => {
  const app = createApp();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/graph/missing-analysis`);

    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, "Unknown repository id");
  });
});

test("GET /api/callgraph validates requests and returns call graph; graph includes cycles", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nebula-callgraph-api-"));

  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "src", "main.js"),
      'import { helper } from "./helper.js";\nexport function run() { helper(); }\n',
    );
    await writeFile(
      path.join(root, "src", "helper.js"),
      'import { run } from "./main.js";\nexport function helper() {}\n',
    );
    await writeFile(path.join(root, "README.md"), "not code\n");

    const built = await buildGraph({
      id: "callgraph-api-fixture",
      dir: root,
      files: ["README.md", "src/main.js", "src/helper.js"],
      repoUrl: "callgraph-api-fixture.zip",
    });
    storeAnalysis({
      id: "callgraph-api-fixture",
      dir: root,
      url: "callgraph-api-fixture.zip",
      graph: built.graph,
      analysis: built.analysis,
    });

    await withServer(createApp(), async (baseUrl) => {
      const success = await fetch(
        `${baseUrl}/api/callgraph?id=callgraph-api-fixture&path=src/main.js`,
      );
      const callGraph = await success.json();
      assert.equal(success.status, 200);
      assert.equal(callGraph.file, "src/main.js");
      assert.equal(callGraph.depth, 1);
      assert.deepEqual(
        callGraph.nodes.map(({ name, external }) => ({ name, external })),
        [
          { name: "run", external: false },
          { name: "helper", external: true },
        ],
      );
      assert.deepEqual(callGraph.edges, [
        {
          source: "src/main.js#run:2",
          target: "src/helper.js#helper:2",
          type: "call",
        },
      ]);

      const missingPath = await fetch(
        `${baseUrl}/api/callgraph?id=callgraph-api-fixture`,
      );
      assert.equal(missingPath.status, 400);

      const unknown = await fetch(
        `${baseUrl}/api/callgraph?id=unknown&path=src/main.js`,
      );
      assert.equal(unknown.status, 404);

      const notAnalyzed = await fetch(
        `${baseUrl}/api/callgraph?id=callgraph-api-fixture&path=README.md`,
      );
      assert.equal(notAnalyzed.status, 404);

      const invalidDepth = await fetch(
        `${baseUrl}/api/callgraph?id=callgraph-api-fixture&path=src/main.js&depth=3`,
      );
      assert.equal(invalidDepth.status, 400);

      const graphResponse = await fetch(
        `${baseUrl}/api/graph/callgraph-api-fixture`,
      );
      const graph = await graphResponse.json();
      assert.equal(graphResponse.status, 200);
      assert.deepEqual(graph.cycles, [["src/helper.js", "src/main.js"]]);
      assert.ok(graph.nodes.every((node) => node.inCycle));
      assert.ok(graph.edges.every((edge) => edge.inCycle));
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("POST /api/graph uses the shared clone/build pipeline and includes the id", async () => {
  const graph = {
    repo: "https://github.com/octocat/demo",
    sha: "fixture-sha",
    nodes: [],
    edges: [],
    cycles: [],
    warnings: [],
  };
  const analysis = { files: {} };
  let buildArguments;
  const app = createApp({
    getRemoteShaImpl: async () => null,
    cloneRepoImpl: async () => ({ id: "direct-graph", dir: "/fixture/repo" }),
    listFilesImpl: async () => ["src/index.ts"],
    buildGraphImpl: async (options) => {
      buildArguments = options;
      return { graph, analysis };
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/octocat/demo" }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ...graph, id: "direct-graph" });
    assert.deepEqual(buildArguments, {
      id: "direct-graph",
      dir: "/fixture/repo",
      files: ["src/index.ts"],
      repoUrl: "https://github.com/octocat/demo",
    });
    assert.equal(getAnalysis("direct-graph").graph, graph);
    assert.equal(getAnalysis("direct-graph").analysis, analysis);
  });
});

test("GET /api/graph/:id builds and caches a graph when it is not cached", async () => {
  const graph = {
    repo: "https://github.com/octocat/lazy",
    sha: "lazy-sha",
    nodes: [],
    edges: [],
    cycles: [],
    warnings: [],
  };
  const analysis = { files: {} };
  storeAnalysis({ id: "lazy-analysis", dir: "/fixture/lazy", url: graph.repo });
  let buildCount = 0;
  const app = createApp({
    listFilesImpl: async (dir) => {
      assert.equal(dir, "/fixture/lazy");
      return ["index.js"];
    },
    buildGraphImpl: async () => {
      buildCount += 1;
      return { graph, analysis };
    },
  });

  await withServer(app, async (baseUrl) => {
    const firstResponse = await fetch(`${baseUrl}/api/graph/lazy-analysis`);
    assert.equal(firstResponse.status, 200);
    assert.deepEqual(await firstResponse.json(), graph);

    const secondResponse = await fetch(`${baseUrl}/api/graph/lazy-analysis`);
    assert.equal(secondResponse.status, 200);
    assert.equal(buildCount, 1);
    assert.equal(getAnalysis("lazy-analysis").graph, graph);
    assert.equal(getAnalysis("lazy-analysis").analysis, analysis);
  });
});

test("POST /api/upload extracts a ZIP and its lazy graph can be fetched", async () => {
  const zipBuffer = makeZip({
    "src/index.js": 'export const value = "ok";',
    "README.md": "A small fixture.",
    "node_modules/pkg/index.js": "ignored",
  });
  const app = createApp();
  let extractedDir;

  try {
    await withServer(app, async (baseUrl) => {
      const response = await uploadZip(baseUrl, "demo.zip", zipBuffer);
      const result = await response.json();

      assert.equal(response.status, 200);
      assert.match(result.id, /^[0-9a-f]{10}$/);
      assert.equal(result.status, "done");
      assert.equal(result.fileCount, 2);
      assert.deepEqual(result.files, ["README.md", "src/index.js"]);
      assert.deepEqual(result.tree, {
        "README.md": null,
        src: { "index.js": null },
      });

      const analysis = getAnalysis(result.id);
      extractedDir = analysis.dir;
      assert.equal(analysis.url, "demo.zip");
      assert.equal(analysis.graph, null);

      const graphResponse = await fetch(`${baseUrl}/api/graph/${result.id}`);
      const graph = await graphResponse.json();
      assert.equal(graphResponse.status, 200);
      assert.equal(graph.repo, "demo.zip");
      assert.equal(graph.sha, result.id);
      assert.deepEqual(
        graph.nodes.map(({ id }) => id),
        ["src/index.js"],
      );
    });
  } finally {
    if (extractedDir) await rm(extractedDir, { recursive: true, force: true });
  }
});

test("POST /api/upload rejects a ZIP-slip entry", async () => {
  const zip = new AdmZip();
  zip.addFile("safe.txt", Buffer.from("outside"));
  zip.getEntry("safe.txt").entryName = "../../nebula-zip-slip.txt";
  const app = createApp();

  await withServer(app, async (baseUrl) => {
    const response = await uploadZip(baseUrl, "unsafe.zip", zip.toBuffer());
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /escapes its target folder/);
  });
});

test("POST /api/upload rejects a missing file and a non-ZIP filename", async () => {
  const app = createApp();

  await withServer(app, async (baseUrl) => {
    const missing = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      body: new FormData(),
    });
    assert.equal(missing.status, 400);
    assert.match((await missing.json()).error, /ZIP file is required/);

    const nonZip = await uploadZip(
      baseUrl,
      "notes.txt",
      Buffer.from("not a zip"),
    );
    assert.equal(nonZip.status, 400);
    assert.equal((await nonZip.json()).error, "Only .zip files are accepted.");
  });
});

test("POST /api/upload strips a single top-level folder and ignores repository junk", async () => {
  const zipBuffer = makeZip({
    "repo-main/src/app.ts": "export const app = true;",
    "repo-main/.git/config": "ignored",
    "repo-main/node_modules/pkg/index.js": "ignored",
    "repo-main/dist/bundle.js": "ignored",
  });
  let extractedDir;

  try {
    await withServer(createApp(), async (baseUrl) => {
      const response = await uploadZip(baseUrl, "repo-main.zip", zipBuffer);
      const result = await response.json();
      assert.equal(response.status, 200);
      assert.deepEqual(result.files, ["src/app.ts"]);
      assert.deepEqual(result.tree, { src: { "app.ts": null } });
      extractedDir = getAnalysis(result.id).dir;
      assert.equal(getAnalysis(result.id).url, "repo-main.zip");
    });
  } finally {
    if (extractedDir) await rm(extractedDir, { recursive: true, force: true });
  }
});

async function withServer(app, callback) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const { port } = server.address();
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function makeZip(files) {
  const zip = new AdmZip();
  for (const [entryPath, contents] of Object.entries(files)) {
    zip.addFile(entryPath, Buffer.from(contents));
  }
  return zip.toBuffer();
}

function uploadZip(baseUrl, fileName, bytes) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/zip" }), fileName);
  return fetch(`${baseUrl}/api/upload`, { method: "POST", body: form });
}
