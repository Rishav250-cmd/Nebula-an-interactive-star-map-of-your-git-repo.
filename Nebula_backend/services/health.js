export const HEALTH_THRESHOLDS = {
  hotspotChurn: 10,       // commits in the last 12 months
  hotspotComplexity: 10,  // worst function in the file
  godLoc: 500,
  godFunctions: 20,
  godFanOut: 10,
  minFiles: 10,           // below this, grade is null
  weights: { cycle: 2, god: 1.5, hotspot: 1 },
};

export function computeHealth(graph, analysis, { hasHistory }) {
  const T = HEALTH_THRESHOLDS;
  const files = graph.nodes.map((node) => {
    const functions = (analysis?.files?.[node.id]?.functions ?? [])
      .filter((fn) => fn.kind !== "class");
    const maxComplexity = Math.max(0, ...functions.map((fn) => fn.complexity));
    const churn = hasHistory ? node.churn : null;

    const isGodFile = node.loc >= T.godLoc && node.functionCount >= T.godFunctions && node.fanOut >= T.godFanOut;
    const inCycle = node.inCycle;
    const hotspotScore = hasHistory ? node.churn * maxComplexity : null;
    const risk = (hotspotScore === null ? 0 : Math.min(70, hotspotScore / 100 * 35))
      + (isGodFile ? 15 : 0)
      + (inCycle ? 10 : 0);

    return {
      id: node.id,
      loc: node.loc,
      churn,
      maxComplexity,
      hotspotScore,
      healthScore: Math.max(0, Math.round(100 - risk)),
      isHotspot: hasHistory && node.churn >= T.hotspotChurn && maxComplexity >= T.hotspotComplexity,
      isGodFile,
      inCycle,
    };
  });

  const n = files.length;
  const share = (count) => (n === 0 ? 0 : (count / n) * 100);
  const cycleFiles = files.filter((f) => f.inCycle).length;
  const godFiles = files.filter((f) => f.isGodFile).length;
  const hotspotFiles = files.filter((f) => f.isHotspot).length;

  const penalty =
    T.weights.cycle * share(cycleFiles) +
    T.weights.god * share(godFiles) +
    (hasHistory ? T.weights.hotspot * share(hotspotFiles) : 0);
  const score = Math.max(0, Math.round(100 - penalty));

  const lowConfidence = n < T.minFiles;
  const grade = lowConfidence ? null
    : score >= 97 ? "A+"
    : score >= 93 ? "A"
    : score >= 90 ? "A-"
    : score >= 87 ? "B+"
    : score >= 83 ? "B"
    : score >= 80 ? "B-"
    : score >= 77 ? "C+"
    : score >= 73 ? "C"
    : score >= 70 ? "C-"
    : score >= 67 ? "D+"
    : score >= 63 ? "D"
    : score >= 60 ? "D-"
    : "F";

  files.sort((a, b) => (b.hotspotScore ?? 0) - (a.hotspotScore ?? 0) || a.id.localeCompare(b.id));

  return {
    grade,
    score,
    lowConfidence,
    historyAvailable: hasHistory,
    summary: { files: n, cycleFiles, godFiles, hotspotFiles },
    thresholds: T,
    files,
  };
}
