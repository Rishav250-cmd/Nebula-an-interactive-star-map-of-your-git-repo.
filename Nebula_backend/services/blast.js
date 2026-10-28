export function buildReverseIndex(edges) {
  const reverseIndex = new Map();

  for (const edge of edges ?? []) {
    if (!edge || typeof edge.target !== "string" || typeof edge.source !== "string")
      continue;
    let importers = reverseIndex.get(edge.target);
    if (!importers) {
      importers = [];
      reverseIndex.set(edge.target, importers);
    }
    if (!importers.includes(edge.source)) importers.push(edge.source);
  }

  return reverseIndex;
}

export function computeBlast(
  reverseIndex,
  startId,
  { maxDepth = 4, cap = 500 } = {},
) {
  const depthLimit = Number.isFinite(maxDepth) ? Math.max(0, maxDepth) : 4;
  const resultCap = cap === Number.POSITIVE_INFINITY
    ? Number.POSITIVE_INFINITY
    : Number.isFinite(cap)
      ? Math.max(0, cap)
      : 500;
  const affected = [];
  const depthMap = {};
  const visited = new Set([startId]);
  const queue = [{ id: startId, depth: 0 }];
  let cursor = 0;
  let truncated = false;

  while (cursor < queue.length) {
    const current = queue[cursor++];
    if (current.depth >= depthLimit) continue;

    for (const importer of reverseIndex?.get(current.id) ?? []) {
      if (visited.has(importer)) continue;
      if (affected.length >= resultCap) {
        truncated = true;
        break;
      }
      visited.add(importer);
      const depth = current.depth + 1;
      affected.push({ id: importer, depth });
      depthMap[importer] = depth;
      queue.push({ id: importer, depth });
    }
    if (truncated) break;
  }

  const byDepth = {};
  let maxDepthReached = 0;
  for (const { depth } of affected) {
    byDepth[depth] = (byDepth[depth] ?? 0) + 1;
    maxDepthReached = Math.max(maxDepthReached, depth);
  }

  return {
    file: startId,
    count: affected.length,
    affected,
    depthMap,
    byDepth,
    maxDepthReached,
    truncated,
  };
}
