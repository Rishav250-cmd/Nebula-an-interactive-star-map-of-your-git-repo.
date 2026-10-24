const analyses = new Map();

export function storeAnalysis({
  id,
  dir,
  url,
  graph = null,
  analysis: graphAnalysis = null,
}) {
  const entry = {
    id,
    dir,
    url,
    graph: graph ?? null,
    analysis: graphAnalysis ?? null,
  };
  analyses.set(id, entry);
  return entry;
}

export function getAnalysis(id) {
  return analyses.get(id) ?? null;
}

export function cacheAnalysisGraph(id, graph, graphAnalysis = null) {
  const analysis = analyses.get(id);
  if (!analysis) return null;

  analysis.graph = graph;
  analysis.analysis = graphAnalysis;
  return analysis;
}
