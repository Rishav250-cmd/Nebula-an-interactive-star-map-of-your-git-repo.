import express from "express";
import { buildGraph } from "../services/analyzeService.js";
import { buildTree, cloneRepo, listFiles } from "../services/ingest.js";
import { storeAnalysis } from "../services/store.js";
import { GraphError } from "../src/graph.js";

const githubRepositoryUrl = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?$/;

export function createAnalyzeRouter({
  fetchImpl = fetch,
  cloneRepoImpl = cloneRepo,
  listFilesImpl = listFiles,
  buildTreeImpl = buildTree,
  storeAnalysisImpl = storeAnalysis,
} = {}) {
  const router = express.Router();

  router.post("/analyze", async (request, response) => {
    const { url } = request.body ?? {};
    if (typeof url !== "string" || !githubRepositoryUrl.test(url)) {
      return response.status(400).json({ error: "Invalid GitHub URL" });
    }

    try {
      const { id, dir } = await cloneRepoImpl(url);
      const files = await listFilesImpl(dir);
      const tree = buildTreeImpl(files);
      storeAnalysisImpl(id, dir);

      return response.status(200).json({ id, status: "done", fileCount: files.length, files, tree });
    } catch (error) {
      console.error("Repository ingestion failed:", error.message);
      return response.status(500).json({ error: "Could not clone repo (private or not found?)" });
    }
  });

  // Preserve the original graph endpoint while the analysis-ID API is built out.
  router.post("/graph", async (request, response) => {
    if (typeof request.body?.repoUrl !== "string") {
      return response.status(400).json({ error: "repoUrl must be a GitHub repository URL." });
    }

    try {
      return response.status(200).json(await buildGraph(request.body.repoUrl, { fetchImpl }));
    } catch (error) {
      return sendGraphError(response, error);
    }
  });

  return router;
}

function sendGraphError(response, error) {
  if (error instanceof GraphError) {
    return response.status(error.statusCode).json({ error: error.message });
  }

  return response.status(502).json({ error: "Unable to read repository data from GitHub." });
}
