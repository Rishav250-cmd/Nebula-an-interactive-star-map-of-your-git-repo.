
import { existsSync } from "node:fs";
import path from "node:path";

const analyses = new Map();

export function storeAnalysis({
  id,
  dir,
  url,
  graph = null,
  analysis: graphAnalysis = null,
  cloneInfo = null,
  job = null,
}) {
  const entry = analyses.get(id) ?? {};
  Object.assign(entry, {
    id,
    dir,
    url,
    graph: graph ?? null,
    analysis: graphAnalysis ?? null,
    cloneInfo: cloneInfo ?? entry.cloneInfo ?? null,
    onboardingCache: null,
    job: job ??
      entry.job ?? {
        status: "ready",
        error: null,
        progress: { done: 0, total: 0 },
      },
  });
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

export function updateAnalysisJob(id, job) {
  const analysis = analyses.get(id);
  if (!analysis) return null;
  analysis.job = {
    ...analysis.job,
    ...job,
    progress: job?.progress
      ? { ...job.progress }
      : { ...analysis.job.progress },
  };
  return analysis.job;
}
