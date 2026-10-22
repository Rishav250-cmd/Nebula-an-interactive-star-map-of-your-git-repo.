const analyses = new Map();

export function storeAnalysis(id, dir, graph) {
  const analysis = { id, dir, graph };
  analyses.set(id, analysis);
  return analysis;
}

export function getAnalysis(id) {
  return analyses.get(id) ?? null;
}
