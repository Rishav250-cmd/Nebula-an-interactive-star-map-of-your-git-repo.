import { create } from 'zustand';
import { analyzeRepo, fetchGraph } from '../api/client';
import type { GraphData, GraphWarning } from '../types/graph';

export type GraphStatus = 'idle' | 'loading' | 'ready' | 'error';
export type AnalysisPhase = 'idle' | 'cloning' | 'parsing' | 'ready' | 'error';

const GITHUB_REPO_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?\/?$/;
const INVALID_URL_MESSAGE = 'Enter a valid GitHub repository URL, such as https://github.com/owner/repo.';

type GraphStore = {
  repoUrl: string;
  graph: GraphData | null;
  repoId: string | null;
  analysisId: string | null;
  status: GraphStatus;
  phase: AnalysisPhase;
  phaseStartedAt: number | null;
  warnings: GraphWarning[];
  lastUrl: string | null;
  error: string | null;
  progressMessage: string | null;
  selectedId: string | null;
  hoveredId: string | null;
  focusRequest: number;
  setRepoUrl: (url: string) => void;
  setGraph: (graph: GraphData | null) => void;
  setAnalysisId: (id: string | null) => void;
  setStatus: (status: GraphStatus, error?: string | null) => void;
  setProgressMessage: (message: string | null) => void;
  selectNode: (id: string | null) => void;
  hoverNode: (id: string | null) => void;
  focusNode: (id: string) => void;
  analyze: (url: string) => Promise<void>;
};

export const useGraphStore = create<GraphStore>()((set) => {
  let requestCounter = 0;

  return {
    repoUrl: '',
    graph: null,
    repoId: null,
    analysisId: null,
    status: 'idle',
    phase: 'idle',
    phaseStartedAt: null,
    warnings: [],
    lastUrl: null,
    error: null,
    progressMessage: null,
    selectedId: null,
    hoveredId: null,
    focusRequest: 0,

    setRepoUrl: (repoUrl) => set({ repoUrl }),
    setGraph: (graph) => set({ graph }),
    setAnalysisId: (analysisId) => set({ analysisId, repoId: analysisId }),
    setStatus: (status, error) => set((state) => {
      const phase: AnalysisPhase = status === 'loading'
        ? (state.phase === 'parsing' ? 'parsing' : 'cloning')
        : status;
      return {
        status,
        error: error ?? null,
        phase,
        phaseStartedAt: state.phase === phase ? state.phaseStartedAt : Date.now(),
      };
    }),
    setProgressMessage: (progressMessage) => set({ progressMessage }),
    selectNode: (selectedId) => set({ selectedId }),
    hoverNode: (hoveredId) => set({ hoveredId }),
    focusNode: (selectedId) =>
      set((state) => ({
        selectedId,
        focusRequest: state.focusRequest + 1,
      })),
    analyze: async (url) => {
      const currentRequest = ++requestCounter;
      const submittedUrl = url.trim();
      const startedAt = Date.now();

      if (!GITHUB_REPO_URL.test(submittedUrl)) {
        set({
          repoUrl: submittedUrl,
          lastUrl: submittedUrl,
          graph: null,
          repoId: null,
          analysisId: null,
          warnings: [],
          selectedId: null,
          hoveredId: null,
          phase: 'error',
          phaseStartedAt: startedAt,
          status: 'error',
          error: INVALID_URL_MESSAGE,
          progressMessage: null,
        });
        return;
      }

      set({
        repoUrl: submittedUrl,
        lastUrl: submittedUrl,
        graph: null,
        repoId: null,
        analysisId: null,
        warnings: [],
        selectedId: null,
        hoveredId: null,
        phase: 'cloning',
        phaseStartedAt: startedAt,
        status: 'loading',
        error: null,
        progressMessage: 'Cloning repository…',
      });

      try {
        const analysis = await analyzeRepo(submittedUrl);
        if (currentRequest !== requestCounter) return;

        set({
          phase: 'parsing',
          phaseStartedAt: Date.now(),
          status: 'loading',
          error: null,
          progressMessage: 'Building dependency graph…',
        });

        const graph = await fetchGraph(analysis.id);
        if (currentRequest !== requestCounter) return;

        set({
          graph,
          warnings: graph.warnings ?? [],
          repoId: analysis.id,
          analysisId: analysis.id,
          selectedId: null,
          hoveredId: null,
          phase: 'ready',
          phaseStartedAt: Date.now(),
          status: 'ready',
          error: null,
          progressMessage: null,
        });
      } catch (analysisError: unknown) {
        if (currentRequest !== requestCounter) return;
        set({
          graph: null,
          repoId: null,
          analysisId: null,
          warnings: [],
          phase: 'error',
          phaseStartedAt: Date.now(),
          status: 'error',
          error: analysisError instanceof Error ? analysisError.message : 'Could not analyze this repository.',
          progressMessage: null,
        });
      }
    },
  };
});
