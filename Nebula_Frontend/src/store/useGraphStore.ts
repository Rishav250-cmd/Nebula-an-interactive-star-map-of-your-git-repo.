import { create } from 'zustand';
import type { GraphData } from '../types/graph';

export type GraphStatus = 'idle' | 'loading' | 'ready' | 'error';

type GraphStore = {
  repoUrl: string;
  graph: GraphData | null;
  status: GraphStatus;
  error: string | null;
  selectedId: string | null;
  hoveredId: string | null;
  focusRequest: number;
  setRepoUrl: (url: string) => void;
  setGraph: (graph: GraphData | null) => void;
  setStatus: (status: GraphStatus, error?: string | null) => void;
  selectNode: (id: string | null) => void;
  hoverNode: (id: string | null) => void;
  focusNode: (id: string) => void;
};

export const useGraphStore = create<GraphStore>()((set) => ({
  repoUrl: '',
  graph: null,
  status: 'idle',
  error: null,
  selectedId: null,
  hoveredId: null,
  focusRequest: 0,

  setRepoUrl: (repoUrl) => set({ repoUrl }),
  setGraph: (graph) => set({ graph }),
  setStatus: (status, error) => set({ status, error: error ?? null }),
  selectNode: (selectedId) => set({ selectedId }),
  hoverNode: (hoveredId) => set({ hoveredId }),
  focusNode: (selectedId) =>
    set((state) => ({
      selectedId,
      focusRequest: state.focusRequest + 1,
    })),
}));
