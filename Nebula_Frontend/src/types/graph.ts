export type GraphNode = {
  id: string;
  folder: string;
  loc: number;
  tokens: number;
  complexity: number;
  churn: number;
  healthScore: number;
  isGodFile: boolean;
  inCycle: boolean;
  fanIn: number;
  fanOut: number;
};

export type GraphEdge = {
  source: string;
  target: string;
  type: 'import' | 'call';
};

export type GraphData = {
  repo: string;
  sha: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  cycles: string[][];
};
