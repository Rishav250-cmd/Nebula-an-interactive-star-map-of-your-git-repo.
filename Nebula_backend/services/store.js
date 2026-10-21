const analyses = new Map();

export function storeAnalysis(id, dir) {
  const analysis = { id, dir };
  analyses.set(id, analysis);
  return analysis;
}

export function getAnalysis(id) {
  return analyses.get(id) ?? null;
}
