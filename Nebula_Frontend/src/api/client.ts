import type { GraphData } from '../types/graph';

export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:5001';

export type AnalyzeResponse = {
  id: string;
  status: 'ready';
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json() as { error?: unknown; message?: unknown };
      if (typeof body.error === 'string') message = body.error;
      else if (typeof body.message === 'string') message = body.message;
    } catch {
      // Keep the status-based message when the server did not return JSON.
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export function analyzeRepository(url: string, signal?: AbortSignal): Promise<AnalyzeResponse> {
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
