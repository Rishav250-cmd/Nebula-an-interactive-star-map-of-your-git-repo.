import express from "express";
import { computeHealth } from "../services/health.js";
import { buildHeatmap } from "../services/heatmap.js";
import { getAnalysis } from "../services/store.js";
import { NebulaError } from "../services/errors.js";

export function createInsightsRouter({ getAnalysisImpl = getAnalysis } = {}) {
  const router = express.Router();

  // Shared checks: a valid id, a known analysis, and a built graph.
  function loadBuiltAnalysis(request) {
    const { id } = request.query;
    if (typeof id !== "string" || id === "")
      throw new NebulaError("INVALID_QUERY", { message: "The 'id' query parameter is required" });
    const analysis = getAnalysisImpl(id);
    if (!analysis) throw new NebulaError("UNKNOWN_ID");
    if (!analysis.graph || !analysis.analysis) throw new NebulaError("ANALYSIS_NOT_READY");
    return analysis;
  }

  router.get("/health", (request, response) => {
    const analysis = loadBuiltAnalysis(request);

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
    const analysis = loadBuiltAnalysis(request);

    const hasHistory = analysis.hasHistory === true;
    const health = computeHealth(analysis.graph, analysis.analysis, { hasHistory });
    return response.status(200).json(buildHeatmap(health.files, { hasHistory }));
  });

  return router;
}
