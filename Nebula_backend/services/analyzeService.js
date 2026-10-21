import { randomUUID } from "node:crypto";
import { buildRepositoryGraph } from "../src/graph.js";

const analyses = new Map();

export async function analyzeRepository(url, options) {
  const graph = await buildRepositoryGraph(url, options);
  const id = randomUUID();

  // Keep the result in memory so a later graph-by-ID route can retrieve it.
  analyses.set(id, graph);

  return { id, status: "ready" };
}

export function getAnalysis(id) {
  return analyses.get(id) ?? null;
}

export function buildGraph(repoUrl, options) {
  return buildRepositoryGraph(repoUrl, options);
}
