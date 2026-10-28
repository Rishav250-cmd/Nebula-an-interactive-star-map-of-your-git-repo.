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
  isFolderGroup?: boolean;
  fileCount?: number;
  memberIds?: string[];
};

export type GraphEdge = {
  source: string;
  target: string;
  type: 'import' | 'call';
  inCycle?: boolean;
  aggregateCount?: number;
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

export type RepositoryQAMatch = {
  path: string;
  line: number;
  snippet: string;
  matchedTerms: string[];
};

export type RepositoryQAResponse = {
  answer: string;
  matches: RepositoryQAMatch[];
};

export type GraphWarning = {
  file: string;
  message: string;
};

export type AnalyzeResponse = {
  id: string;
  status: 'ready' | 'queued' | 'cloning';
};

export type GraphData = {
  repo: string;
  sha: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  cycles: string[][];
  warnings: GraphWarning[];
  meta?: {
    analyzedFiles?: number;
    totalCodeFiles?: number;
    truncated?: boolean;
    truncatedReason?: string | null;
  };
};

export type HealthFile = {
  id: string;
  loc: number;
  churn: number | null;
  maxComplexity: number;
  hotspotScore: number | null;
  healthScore: number;
  isHotspot: boolean;
  isGodFile: boolean;
  inCycle: boolean;
};

export type HealthReport = {
  grade: 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D+' | 'D' | 'D-' | 'F' | null;
  score: number;
  lowConfidence: boolean;
  historyAvailable: boolean;
  summary: { files: number; cycleFiles: number; godFiles: number; hotspotFiles: number };
  files: HealthFile[];
};
