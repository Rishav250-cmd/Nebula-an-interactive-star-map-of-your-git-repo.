import express from "express";
import { buildGraph } from "../services/analyzeService.js";
import { cloneRepo, listFiles } from "../services/ingest.js";
import { getAnalysis, storeAnalysis } from "../services/store.js";
import { GraphError } from "../src/graph.js";

const githubRepositoryUrl = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?$/;

export function createAnalyzeRouter({
  cloneRepoImpl = cloneRepo,
  listFilesImpl = listFiles,
  buildGraphImpl = buildGraph,
  getAnalysisImpl = getAnalysis,
  storeAnalysisImpl = storeAnalysis,
} = {}) {
  const router = express.Router();

  router.post("/analyze", async (request, response) => {
    const { url } = request.body ?? {};
    if (typeof url !== "string" || !githubRepositoryUrl.test(url)) {
      return response.status(400).json({ error: "Invalid GitHub URL" });
    }

    let clonedRepository;
    try {
      clonedRepository = await cloneRepoImpl(url);
    } catch (error) {
      console.error("Repository clone failed:", error.message);
      return response.status(500).json({ error: "Could not clone repo (private or not found?)" });
    }

    try {
      const { id, dir } = clonedRepository;
      const files = await listFilesImpl(dir);
      const graph = await buildGraphImpl({ id, dir, files, repoUrl: url });
      storeAnalysisImpl(id, dir, graph);
      return response.status(200).json({ id, status: "ready" });
    } catch (error) {
      console.error("Repository graph build failed:", error.message);
      if (error instanceof GraphError) return sendGraphError(response, error);
      return response.status(500).json({ error: "Could not build repository graph." });
    }
  });

  router.get("/graph/:id", (request, response) => {
    const analysis = getAnalysisImpl(request.params.id);
    if (!analysis?.graph) {
      return response.status(404).json({ error: "Analysis not found." });
    }

    return response.status(200).json(analysis.graph);
  });

  return router;
}

function sendGraphError(response, error) {
  if (error instanceof GraphError) {
    return response.status(error.statusCode).json({ error: error.message });
  }

  return response.status(502).json({ error: "Unable to read repository data from GitHub." });
}
