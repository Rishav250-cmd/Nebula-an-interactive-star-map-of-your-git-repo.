import express from "express";
import { analyzeRepository, buildGraph } from "../services/analyzeService.js";
import { GraphError } from "../src/graph.js";

export function createAnalyzeRouter({ fetchImpl = fetch } = {}) {
  const router = express.Router();

  router.post("/analyze", async (request, response) => {
    if (typeof request.body?.url !== "string") {
      return response.status(400).json({ error: "url must be a GitHub repository URL." });
    }

    try {
      const result = await analyzeRepository(request.body.url, { fetchImpl });
      return response.status(200).json(result);
    } catch (error) {
      return sendGraphError(response, error);
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
