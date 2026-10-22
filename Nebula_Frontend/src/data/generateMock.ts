import type { GraphData, GraphEdge, GraphNode } from '../types/graph';

const NODE_COUNT = 300;
const EDGE_COUNT = 500;
const FOLDERS = [
  'src/api',
  'src/core',
  'src/components',
  'src/store',
  'src/utils',
  'packages/graph',
  'packages/ui',
  'tests',
];

export function generateMockGraph(): GraphData {
  const fanIn = Array<number>(NODE_COUNT).fill(0);
  const fanOut = Array<number>(NODE_COUNT).fill(0);
  const nodes: GraphNode[] = Array.from({ length: NODE_COUNT }, (_, index) => {
    const folder = FOLDERS[index % FOLDERS.length];
    const loc = 24 + Math.floor(Math.random() * 240);

    return {
      id: `${folder}/module-${String(index + 1).padStart(3, '0')}.ts`,
      folder,
      loc,
      tokens: loc * (5 + Math.floor(Math.random() * 8)),
      complexity: 1 + Math.floor(Math.random() * 24),
      churn: Math.floor(Math.random() * 50),
      healthScore: 45 + Math.floor(Math.random() * 56),
      isGodFile: loc > 220 && Math.random() < 0.25,
      inCycle: false,
      fanIn: 0,
      fanOut: 0,
    };
  });

  const edges: GraphEdge[] = [];
  const usedEdges = new Set<string>();

  while (edges.length < EDGE_COUNT) {
    const sourceIndex = Math.floor(Math.random() * NODE_COUNT);
    const targetIndex = Math.floor(Math.random() * NODE_COUNT);
    if (sourceIndex === targetIndex) continue;

    const edgeKey = `${sourceIndex}:${targetIndex}`;
    if (usedEdges.has(edgeKey)) continue;
    usedEdges.add(edgeKey);
    fanOut[sourceIndex] += 1;
    fanIn[targetIndex] += 1;
    edges.push({
      source: nodes[sourceIndex].id,
      target: nodes[targetIndex].id,
      type: Math.random() < 0.75 ? 'import' : 'call',
    });
  }

  return {
    repo: 'nebula/performance-check',
    sha: 'generated',
    nodes: nodes.map((node, index) => ({ ...node, fanIn: fanIn[index], fanOut: fanOut[index] })),
    edges,
    cycles: [],
  };
}
