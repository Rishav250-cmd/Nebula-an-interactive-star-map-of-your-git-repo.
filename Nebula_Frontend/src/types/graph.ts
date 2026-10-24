export type GraphNode = {
  id: string;
  folder: string;
  loc: number;
  tokens: number;
  complexity: number;
  churn: number;
  healthScore: number | null;
  isGodFile: boolean;
  inCycle: boolean;
  fanIn: number;
  fanOut: number;
  functionCount?: number;
};

export type GraphEdge = {
  source: string;
  target: string;
  type: 'import' | 'call';
  inCycle?: boolean;
};

export type CallGraphNode = {
  id: string;
  name: string;
  kind: 'function' | 'method' | 'class';
  file: string;
  line: number;
  endLine: number;
  complexity: number;
  external: boolean;
};

export type CallGraphEdge = {
  source: string;
  target: string;
  type: 'call';
};

export type CallGraph = {
  file: string;
  depth: 1 | 2;
  nodes: CallGraphNode[];
  edges: CallGraphEdge[];
  truncated: boolean;
};

export type SearchResult =
  | { type: 'file'; name: string; path: string; line?: number; kind?: never }
  | { type: 'symbol'; name: string; path: string; line: number; kind: string };

export type GraphWarning = {
  file: string;
  message: string;
};

export type AnalyzeResponse = {
  id: string;
  status: 'ready';
};

export type GraphData = {
  repo: string;
  sha: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  cycles: string[][];
  warnings: GraphWarning[];
};
