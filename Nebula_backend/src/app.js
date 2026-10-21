import express from "express";
import { buildRepositoryGraph, GraphError } from "./graph.js";

export function createApp({ fetchImpl = fetch } = {}) {
  const app = express();

  app.use(express.json({ limit: "16kb" }));

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  app.post("/api/graph", async (request, response) => {
    if (typeof request.body?.repoUrl !== "string") {
      return response.status(400).json({ error: "repoUrl must be a GitHub repository URL." });
    }

    try {
      const graph = await buildRepositoryGraph(request.body.repoUrl, { fetchImpl });
      return response.status(200).json(graph);
    } catch (error) {
      if (error instanceof GraphError) {
        return response.status(error.statusCode).json({ error: error.message });
      }

      return response.status(502).json({ error: "Unable to read repository data from GitHub." });
    }
  });

  // Keep malformed JSON and oversized request errors in the API's JSON format.
  app.use((error, _request, response, _next) => {
    const statusCode = error.status === 413 ? 413 : 400;
    const message = statusCode === 413 ? "Request body is too large." : "Request body must be valid JSON.";
    response.status(statusCode).json({ error: message });
  });

  return app;
}

export default createApp();
