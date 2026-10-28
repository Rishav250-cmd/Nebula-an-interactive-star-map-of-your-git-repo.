import fallbackGraph from '../data/mock-graph.json';
import type { AnalyzeResponse, CallGraph, GraphData, HealthReport, RepositoryQAResponse, SearchResult } from '../types/graph';

export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:5001';
const REQUEST_TIMEOUT_MS = 120_000;
const NETWORK_ERROR_MESSAGE = 'Cannot reach the Nebula server. Is the backend running on port 5001?';
const MAX_GRAPH_CACHE = 4;
const MAX_FILE_CACHE = 12;
const MAX_HEALTH_CACHE = 4;
const MAX_ONBOARDING_CACHE = 4;
const MAX_CALL_GRAPH_CACHE = 24;
const MAX_SEARCH_CACHE = 24;

export type { AnalyzeResponse, SearchResult } from '../types/graph';

export class ApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

export type AnalysisProgress = {
  id: string;
  status: 'queued' | 'cloning' | 'listing' | 'parsing' | 'graph' | 'ready' | 'error';
  error: string | null;
  progress: { done: number; total: number };
};

const graphCache = new Map<string, GraphData>();
const fileCache = new Map<string, FileResponse>();
const healthCache = new Map<string, HealthReport>();
const onboardingCache = new Map<string, OnboardingResult>();
const callGraphCache = new Map<string, CallGraph>();
const searchCache = new Map<string, SearchResult[]>();
const repositoryGraphCache = new Map<string, { id: string; graph: GraphData }>();

function touchCache<T>(cache: Map<string, T>, key: string): T | undefined {
  const value = cache.get(key);
  if (value === undefined) return undefined;
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function remember<T>(cache: Map<string, T>, key: string, value: T, limit: number): T {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) cache.delete(cache.keys().next().value!);
  return value;
}

function cachedRequest<T>(
  cache: Map<string, T>,
  key: string,
  limit: number,
  load: () => Promise<T>,
): Promise<T> {
  const cached = touchCache(cache, key);
  if (cached !== undefined) return Promise.resolve(cached);
  return load().then((value) => remember(cache, key, value, limit));
}

function repositoryKey(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase();
}

export function getCachedRepositoryGraph(url: string): { id: string; graph: GraphData } | undefined {
  return touchCache(repositoryGraphCache, repositoryKey(url));
}

export function rememberRepositoryGraph(url: string, id: string, graph: GraphData): void {
  remember(repositoryGraphCache, repositoryKey(url), { id, graph }, MAX_GRAPH_CACHE);
}

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

export type OnboardingResult = {
  entry: string | null;
  path: Array<{ id: string; depth: number; reason: string; blastRadius: number; complexity: number; loc: number; safety: number }>;
  safeStarters: Array<{ id: string; safety: number; reason: string }>;
  issues: Array<{ number: number; title: string; url: string; labels: string[]; files: Array<{ id: string; score: number; reason: string }>; blastRadius: number | null; difficulty: 'easy' | 'medium' | 'hard' | 'unknown' }>;
  issuesStatus: 'ok' | 'none' | 'rate_limited' | 'not_found' | 'unavailable';
  issuesResetAt: number | null;
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
        throw new ApiError('REQUEST_TIMEOUT', 'The request timed out after 120 seconds. Try a smaller repository.');
      }
      throw new ApiError('NETWORK_ERROR', NETWORK_ERROR_MESSAGE);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error: unknown) {
      if (externalSignal?.aborted) throw error;
      if (didTimeout) {
        throw new ApiError('REQUEST_TIMEOUT', 'The request timed out after 120 seconds. Try a smaller repository.');
      }
      if (response.ok) throw new ApiError('INVALID_RESPONSE', 'The Nebula server returned an invalid JSON response.');
      body = null;
    }

    if (!response.ok) {
      throw apiErrorFromBody(body, response.status);
    }

    return body as T;
  } finally {
    if (externalSignal) externalSignal.removeEventListener('abort', abortFromCaller);
    window.clearTimeout(timeoutId);
  }
}

function apiErrorFromBody(body: unknown, status: number): ApiError {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const error = body.error;
    if (typeof error === 'object' && error !== null && 'message' in error) {
      const code = 'code' in error && typeof error.code === 'string' ? error.code : `HTTP_${status}`;
      const message = typeof error.message === 'string' ? error.message : `Request failed (${status})`;
      return new ApiError(code, message);
    }
    if (typeof error === 'string') return new ApiError(`HTTP_${status}`, error);
  }
  return new ApiError(`HTTP_${status}`, `Request failed (${status})`);
}

export function errorForDisplay(error: unknown): string {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return `REQUEST_FAILED: ${error.message}`;
  return 'REQUEST_FAILED: The request failed. Please try again.';
}

export function analyzeRepo(url: string, signal?: AbortSignal): Promise<AnalyzeResponse> {
  return requestJson<AnalyzeResponse>('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, async: true }),
    signal,
  });
}

export async function streamAnalysisProgress(
  id: string,
  onProgress: (progress: AnalysisProgress) => void,
  signal: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/progress/${encodeURIComponent(id)}`, {
      headers: { Accept: 'text/event-stream' },
      signal,
    });
  } catch (error: unknown) {
    if (signal.aborted) throw error;
    throw new ApiError('PROGRESS_CONNECTION_FAILED', 'Could not connect to analysis progress. Retry the analysis.');
  }
  if (!response.ok) {
    let body: unknown = null;
    try { body = await response.json(); } catch { /* Error body may be empty. */ }
    throw apiErrorFromBody(body, response.status);
  }
  if (!response.body) throw new ApiError('PROGRESS_STREAM_FAILED', 'The progress stream returned no data. Retry the analysis.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  const processFrame = (frame: string) => {
    const data = frame.split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');
    if (!data) return false;
    let payload: AnalysisProgress;
    try { payload = JSON.parse(data) as AnalysisProgress; } catch {
      throw new ApiError('INVALID_PROGRESS', 'The progress stream returned invalid data. Retry the analysis.');
    }
    onProgress(payload);
    if (payload.status === 'error') {
      throw new ApiError('ANALYSIS_FAILED', payload.error || 'Repository analysis failed.');
    }
    return payload.status === 'ready';
  };

  while (true) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try { chunk = await reader.read(); } catch (error: unknown) {
      if (signal.aborted) throw error;
      throw new ApiError('PROGRESS_STREAM_FAILED', 'The progress stream disconnected. Retry the analysis.');
    }
    if (chunk.done) {
      buffered += decoder.decode();
      if (buffered.trim() && processFrame(buffered)) return;
      throw new ApiError('PROGRESS_STREAM_CLOSED', 'The progress stream closed before analysis completed. Retry the analysis.');
    }
    buffered += decoder.decode(chunk.value, { stream: true });
    const frames = buffered.split(/\r?\n\r?\n/);
    buffered = frames.pop() ?? '';
    for (const frame of frames) {
      if (processFrame(frame)) {
        await reader.cancel().catch(() => {});
        return;
      }
    }
  }
}

export function fetchGraph(id: string, signal?: AbortSignal): Promise<GraphData> {
  return cachedRequest(graphCache, id, MAX_GRAPH_CACHE, () => requestJson<GraphData>(`/api/graph/${encodeURIComponent(id)}`, { signal }));
}

export function fetchHealth(id: string, signal?: AbortSignal): Promise<HealthReport> {
  const params = new URLSearchParams({ id, limit: '50000' });
  return cachedRequest(healthCache, id, MAX_HEALTH_CACHE, () => requestJson<HealthReport>(`/api/health?${params.toString()}`, { signal }));
}

export function fetchOnboarding(id: string, signal?: AbortSignal): Promise<OnboardingResult> {
  return cachedRequest(onboardingCache, id, MAX_ONBOARDING_CACHE, () => requestJson<OnboardingResult>(`/api/onboarding/${encodeURIComponent(id)}`, { signal }));
}

export function fetchCallGraph(
  repoId: string,
  path: string,
  depth: 1 | 2,
  signal?: AbortSignal,
): Promise<CallGraph> {
  const cacheKey = `${repoId}|${path}|${depth}`;
  const params = new URLSearchParams({ id: repoId, path, depth: String(depth) });
  return cachedRequest(callGraphCache, cacheKey, MAX_CALL_GRAPH_CACHE, () => requestJson<CallGraph>(`/api/callgraph?${params.toString()}`, { signal }));
}

export function fetchRepositoryFile(
  id: string,
  path: string,
  signal?: AbortSignal,
): Promise<FileResponse> {
  const query = new URLSearchParams({ id, path });
  const cacheKey = `${id}|${path}`;
  return cachedRequest(fileCache, cacheKey, MAX_FILE_CACHE, () => requestJson<FileResponse>(`/api/file?${query.toString()}`, { signal }));
}

export function searchRepositoryFiles(
  id: string,
  query: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const params = new URLSearchParams({ id, q: query });
  const cacheKey = `${id}|${query.trim().toLowerCase()}`;
  return cachedRequest(searchCache, cacheKey, MAX_SEARCH_CACHE, () => requestJson<SearchResult[]>(`/api/search?${params.toString()}`, { signal }));
}

export function askRepositoryQuestion(
  id: string,
  question: string,
  signal?: AbortSignal,
): Promise<RepositoryQAResponse> {
  return requestJson<RepositoryQAResponse>('/api/qa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, question }),
    signal,
  });
}

export async function fetchMockGraph(): Promise<GraphData> {
  try {
    return await requestJson<GraphData>('/api/mock-graph');
  } catch {
    return structuredClone(fallbackGraph) as GraphData;
  }
}
