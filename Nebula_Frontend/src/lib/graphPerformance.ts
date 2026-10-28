export const GRAPH_PERFORMANCE_THRESHOLDS = {
  reducedMotion: 800,
  simplifiedRendering: 1_500,
} as const;

export function graphPerformanceForNodeCount(nodeCount: number) {
  if (nodeCount > GRAPH_PERFORMANCE_THRESHOLDS.simplifiedRendering) {
    return {
      tier: 'simplified' as const,
      warmupTicks: 2,
      cooldownTicks: 32,
      alphaDecay: 0.08,
    };
  }

  if (nodeCount > GRAPH_PERFORMANCE_THRESHOLDS.reducedMotion) {
    return {
      tier: 'reduced' as const,
      warmupTicks: 8,
      cooldownTicks: 55,
      alphaDecay: 0.05,
    };
  }

  return {
    tier: 'full' as const,
    warmupTicks: 20,
    cooldownTicks: 100,
    alphaDecay: 0.0228,
  };
}
