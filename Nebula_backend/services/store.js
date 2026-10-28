
import { existsSync } from "node:fs";
import path from "node:path";

const analyses = new Map();

export function storeAnalysis({
  id,
  dir,
  url,
  graph = null,
  analysis: graphAnalysis = null,
  hasHistory,
}) {
  const entry = {
    id,
    dir,
    url,
    graph: graph ?? null,
    analysis: graphAnalysis ?? null,

    // Git clones have a .git entry; ZIP uploads usually do not.
    hasHistory:
      typeof hasHistory === "boolean"
        ? hasHistory
        : existsSync(path.join(dir, ".git")),
  };

  analyses.set(id, entry);
  return entry;
}

export function getAnalysis(id) {
  return analyses.get(id) ?? null;
}

export function cacheAnalysisGraph(
  id,
  graph,
  graphAnalysis = null
) {
  const entry = analyses.get(id);

  if (!entry) return null;

  entry.graph = graph;
  entry.analysis = graphAnalysis;

  return entry;
}
