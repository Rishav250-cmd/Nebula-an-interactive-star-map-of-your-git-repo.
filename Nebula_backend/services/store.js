const analyses = new Map();

export function storeAnalysis({ id, dir, url, graph = null }) {
  const analysis = { id, dir, url, graph: graph ?? null };
  analyses.set(id, analysis);
  return analysis;
}

export function getAnalysis(id) {
  return analyses.get(id) ?? null;
}

export function cacheAnalysisGraph(id, graph) {
  const analysis = analyses.get(id);
  if (!analysis) return null;

  analysis.graph = graph;
  return analysis;
}
