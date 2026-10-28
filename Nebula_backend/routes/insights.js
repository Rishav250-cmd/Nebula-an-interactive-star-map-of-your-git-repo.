import express from "express";
import { computeHealth } from "../services/health.js";
import { buildHeatmap } from "../services/heatmap.js";
import { getAnalysis } from "../services/store.js";

export function createInsightsRouter({ getAnalysisImpl = getAnalysis } = {}) {
  const router = express.Router();

  // Shared checks: a valid id, a known analysis, and a built graph.
  // Sends the error response itself and returns null when a check fails.
  function loadBuiltAnalysis(request, response) {
    const { id } = request.query;
    if (typeof id !== "string" || id === "") {
      response.status(400).json({ error: "The 'id' query parameter is required" });
      return null;
    }
    const analysis = getAnalysisImpl(id);
    if (!analysis) {
      response.status(404).json({ error: "Unknown repository id" });
      return null;
    }
    if (!analysis.graph || !analysis.analysis) {
      response.status(409).json({
        error: "Analysis is not built yet. Call /api/graph/:id first.",
      });
      return null;
    }
    return analysis;
  }

  router.get("/health", (request, response) => {
    const analysis = loadBuiltAnalysis(request, response);
    if (!analysis) return;

    const health = computeHealth(analysis.graph, analysis.analysis, {
      hasHistory: analysis.hasHistory === true,
    });
    const limit = Math.min(Number(request.query.limit) || 100, 50000);
    return response.status(200).json({
      ...health,
      files: health.files.slice(0, limit),
    });
  });

  router.get("/heatmap", (request, response) => {
    const analysis = loadBuiltAnalysis(request, response);
    if (!analysis) return;

    const hasHistory = analysis.hasHistory === true;
    const health = computeHealth(analysis.graph, analysis.analysis, { hasHistory });
    return response.status(200).json(buildHeatmap(health.files, { hasHistory }));
  });

  return router;
}
