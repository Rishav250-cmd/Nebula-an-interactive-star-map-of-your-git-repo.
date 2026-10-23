import type { GraphData } from '../types/graph';
import { resolveEndpoints } from '../utils/graphEdges';

export type GraphAdjacency = {
  imports: Map<string, Set<string>>;
  importers: Map<string, Set<string>>;
};

/** Build direct import relationships once for a graph, even after force-graph mutates link ends. */
export function buildAdjacency(graph: GraphData | null | undefined): GraphAdjacency {
  const imports = new Map<string, Set<string>>();
  const importers = new Map<string, Set<string>>();

  for (const node of graph?.nodes ?? []) {
    imports.set(node.id, new Set());
    importers.set(node.id, new Set());
  }

  for (const edge of graph?.edges ?? []) {
    if (edge.type !== 'import') continue;
    const { sourceId, targetId } = resolveEndpoints(edge);
    if (!sourceId || !targetId) continue;

    if (!imports.has(sourceId)) imports.set(sourceId, new Set());
    if (!importers.has(targetId)) importers.set(targetId, new Set());
    imports.get(sourceId)?.add(targetId);
    importers.get(targetId)?.add(sourceId);
  }

  return { imports, importers };
}
