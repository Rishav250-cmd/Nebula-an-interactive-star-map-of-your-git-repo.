export type LinkEndpoints = {
  source?: unknown;
  target?: unknown;
  type?: unknown;
  inCycle?: unknown;
};

export type ResolvedEndpoints = {
  sourceId: string | null;
  targetId: string | null;
};

export function endpointId(endpoint: unknown): string | null {
  if (typeof endpoint === 'string' || typeof endpoint === 'number') return String(endpoint);
  if (typeof endpoint !== 'object' || endpoint === null || !('id' in endpoint)) return null;

  const id = (endpoint as { id?: unknown }).id;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null;
}

export function resolveEndpoints(link: LinkEndpoints): ResolvedEndpoints {
  return {
    sourceId: endpointId(link.source),
    targetId: endpointId(link.target),
  };
}

export function getNodeRelations(edges: readonly LinkEndpoints[], nodeId: string) {
  const imports = new Set<string>();
  const importers = new Set<string>();

  for (const edge of edges) {
    if (edge.type !== 'import') continue;
    const { sourceId, targetId } = resolveEndpoints(edge);
    if (sourceId === nodeId && targetId) imports.add(targetId);
    if (targetId === nodeId && sourceId) importers.add(sourceId);
  }

  return {
    imports: [...imports],
    importers: [...importers],
  };
}
