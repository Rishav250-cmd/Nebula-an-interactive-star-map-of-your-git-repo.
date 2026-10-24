import fallbackGraph from '../data/mock-graph.json';
import type { AnalyzeResponse, CallGraph, GraphData, SearchResult } from '../types/graph';

export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:5001';
const REQUEST_TIMEOUT_MS = 120_000;
const NETWORK_ERROR_MESSAGE = 'Cannot reach the Nebula server. Is the backend running on port 5001?';

export type { AnalyzeResponse, SearchResult } from '../types/graph';

const callGraphCache = new Map<string, CallGraph>();

export type FileResponse = {
  content: string;
  language: string;
  loc: number;
  functions?: Array<{
    name: string;
    kind: 'function' | 'method' | 'class';
    line: number;
    endLine: number;
    complexity: number;
  }>;
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const externalSignal = init?.signal ?? undefined;
  const controller = new AbortController();
  let didTimeout = false;
  const timeoutId = window.setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort();

  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener('abort', abortFromCaller, { once: true });

  try {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, { ...init, signal: controller.signal });
    } catch (error: unknown) {
      if (externalSignal?.aborted) throw error;
      if (didTimeout) {
        throw new Error('The request timed out after 120 seconds. Try a smaller repository.');
      }
      throw new Error(NETWORK_ERROR_MESSAGE);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error: unknown) {
      if (externalSignal?.aborted) throw error;
      if (didTimeout) {
        throw new Error('The request timed out after 120 seconds. Try a smaller repository.');
      }
      if (response.ok) throw new Error('The Nebula server returned an invalid JSON response.');
      body = null;
    }

    if (!response.ok) {
      const message = typeof body === 'object' && body !== null && 'error' in body
        && typeof body.error === 'string'
        ? body.error
        : `Request failed (${response.status})`;
      throw new Error(message);
    }

    return body as T;
  } finally {
    if (externalSignal) externalSignal.removeEventListener('abort', abortFromCaller);
    window.clearTimeout(timeoutId);
  }
}

export function analyzeRepo(url: string, signal?: AbortSignal): Promise<AnalyzeResponse> {
  return requestJson<AnalyzeResponse>('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal,
  });
}

export function fetchGraph(id: string, signal?: AbortSignal): Promise<GraphData> {
  return requestJson<GraphData>(`/api/graph/${encodeURIComponent(id)}`, { signal });
}

export function fetchCallGraph(
  repoId: string,
  path: string,
  depth: 1 | 2,
  signal?: AbortSignal,
): Promise<CallGraph> {
  const cacheKey = `${repoId}|${path}|${depth}`;
  const cached = callGraphCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);

  const params = new URLSearchParams({ id: repoId, path, depth: String(depth) });
  return requestJson<CallGraph>(`/api/callgraph?${params.toString()}`, { signal })
    .then((callGraph) => {
      callGraphCache.set(cacheKey, callGraph);
      return callGraph;
    });
}

export function clearCallGraphCache(): void {
  callGraphCache.clear();
}

export function fetchRepositoryFile(
  id: string,
  path: string,
  signal?: AbortSignal,
): Promise<FileResponse> {
  const query = new URLSearchParams({ id, path });
  return requestJson<FileResponse>(`/api/file?${query.toString()}`, { signal });
}

export function searchRepositoryFiles(
  id: string,
  query: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const params = new URLSearchParams({ id, q: query });
  return requestJson<SearchResult[]>(`/api/search?${params.toString()}`, { signal });
}

export async function fetchMockGraph(): Promise<GraphData> {
  try {
    return await requestJson<GraphData>('/api/mock-graph');
  } catch {
    return structuredClone(fallbackGraph) as GraphData;
  }
}
