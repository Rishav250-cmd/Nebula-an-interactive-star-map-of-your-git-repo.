import fallbackGraph from '../data/mock-graph.json';
import type { GraphData } from '../types/graph';

export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:5001';

export async function fetchMockGraph(): Promise<GraphData> {
  try {
    const response = await fetch(`${API_BASE}/api/mock-graph`);

    if (!response.ok) {
      throw new Error(`Mock graph request failed (${response.status})`);
    }

    return (await response.json()) as GraphData;
  } catch {
    return structuredClone(fallbackGraph) as GraphData;
  }
}
