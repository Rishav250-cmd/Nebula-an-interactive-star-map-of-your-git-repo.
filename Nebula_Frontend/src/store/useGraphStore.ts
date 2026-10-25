import { create } from 'zustand';
import { analyzeRepo, clearCallGraphCache, fetchCallGraph, fetchGraph } from '../api/client';
import { EMPTY_FILTERS, type GraphFilters } from '../lib/applyFilters';
import type { CallGraph, GraphData, GraphWarning } from '../types/graph';

export type GraphStatus = 'idle' | 'loading' | 'ready' | 'error';
export type AnalysisPhase = 'idle' | 'cloning' | 'parsing' | 'ready' | 'error';
export type ViewMode = 'file' | 'function';
export type CallGraphStatus = 'idle' | 'loading' | 'ready' | 'error';
export type EdgeToggleKind = 'imports' | 'calls' | 'cycles';

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
  viewMode: ViewMode;
  callGraph: CallGraph | null;
  callGraphStatus: CallGraphStatus;
  callGraphError: string | null;
  callGraphDepth: 1 | 2;
  selectedFunctionId: string | null;
  focusLine: number | null;
  selectedCycleIndex: number | null;
  edgeToggles: { imports: boolean; calls: boolean; cycles: boolean };
  filters: GraphFilters;
  setRepoUrl: (url: string) => void;
  setGraph: (graph: GraphData | null) => void;
  setAnalysisId: (id: string | null) => void;
  setStatus: (status: GraphStatus, error?: string | null) => void;
  setProgressMessage: (message: string | null) => void;
  selectNode: (id: string | null) => void;
  hoverNode: (id: string | null) => void;
  focusNode: (id: string) => void;
  setViewMode: (mode: ViewMode) => void;
  loadCallGraph: () => Promise<void>;
  setCallGraphDepth: (depth: 1 | 2) => void;
  selectFunction: (id: string | null) => void;
  setFocusLine: (line: number | null) => void;
  selectCycle: (index: number | null) => void;
  clearFocus: () => void;
  toggleEdges: (kind: EdgeToggleKind) => void;
  toggleFolderFilter: (folder: string) => void;
  toggleExtensionFilter: (extension: string) => void;
  resetFilters: () => void;
  analyze: (url: string) => Promise<void>;
};

/** Adds the value to the list, or removes it if it is already there. */
function toggled(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export const useGraphStore = create<GraphStore>()((set, get) => {
  let requestCounter = 0;
  let callGraphRequestCounter = 0;

  const cancelCallGraphRequest = () => {
    callGraphRequestCounter += 1;
  };

  const clearCallGraphState = () => {
    cancelCallGraphRequest();
    set({ callGraph: null, callGraphStatus: 'idle', callGraphError: null });
  };

  const resetAnalysisView = () => {
    cancelCallGraphRequest();
    clearCallGraphCache();
    set({
      viewMode: 'file',
      callGraph: null,
      callGraphStatus: 'idle',
      callGraphError: null,
      selectedCycleIndex: null,
      selectedFunctionId: null,
      focusLine: null,
      filters: EMPTY_FILTERS,
    });
  };

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
    viewMode: 'file',
    callGraph: null,
    callGraphStatus: 'idle',
    callGraphError: null,
    callGraphDepth: 1,
    selectedFunctionId: null,
    focusLine: null,
    selectedCycleIndex: null,
    edgeToggles: { imports: true, calls: true, cycles: true },
    filters: EMPTY_FILTERS,

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
    selectNode: (selectedId) => {
      const previousId = get().selectedId;
      set((state) => ({
        selectedId,
        ...(previousId !== selectedId ? {
          selectedFunctionId: null,
          focusLine: null,
          selectedCycleIndex: selectedId ? null : state.selectedCycleIndex,
        } : {}),
      }));
      if (previousId !== selectedId) {
        if (selectedId && get().viewMode === 'function') void get().loadCallGraph();
        else clearCallGraphState();
      }
    },
    hoverNode: (hoveredId) => set({ hoveredId }),
    focusNode: (selectedId) => {
      const previousId = get().selectedId;
      set((state) => ({
        selectedId,
        focusRequest: state.focusRequest + 1,
        ...(previousId !== selectedId ? {
          selectedFunctionId: null,
          focusLine: null,
          selectedCycleIndex: null,
        } : {}),
      }));
      if (previousId !== selectedId) {
        if (get().viewMode === 'function') void get().loadCallGraph();
        else clearCallGraphState();
      }
    },
    setViewMode: (viewMode) => {
      const previousMode = get().viewMode;
      if (previousMode === viewMode) return;
      set({ viewMode });
      if (viewMode === 'function' && get().selectedId) {
        void get().loadCallGraph();
      } else if (viewMode === 'file') {
        cancelCallGraphRequest();
      }
    },
    loadCallGraph: async () => {
      const { repoId, selectedId, callGraphDepth } = get();
      const requestId = ++callGraphRequestCounter;
      if (!repoId || !selectedId) {
        set({ callGraph: null, callGraphStatus: 'idle', callGraphError: null });
        return;
      }

      set({ callGraph: null, callGraphStatus: 'loading', callGraphError: null });
      try {
        const callGraph = await fetchCallGraph(repoId, selectedId, callGraphDepth);
        const current = get();
        if (
          requestId !== callGraphRequestCounter
          || current.repoId !== repoId
          || current.selectedId !== selectedId
          || current.callGraphDepth !== callGraphDepth
        ) return;
        set({ callGraph, callGraphStatus: 'ready', callGraphError: null });
      } catch (callGraphError: unknown) {
        const current = get();
        if (
          requestId !== callGraphRequestCounter
          || current.repoId !== repoId
          || current.selectedId !== selectedId
          || current.callGraphDepth !== callGraphDepth
        ) return;
        set({
          callGraph: null,
          callGraphStatus: 'error',
          callGraphError: callGraphError instanceof Error
            ? callGraphError.message
            : 'Could not load this file\'s function graph.',
        });
      }
    },
    setCallGraphDepth: (callGraphDepth) => {
      if (get().callGraphDepth === callGraphDepth) return;
      set({ callGraphDepth });
      if (get().viewMode === 'function' && get().selectedId) {
        void get().loadCallGraph();
      }
    },
    selectFunction: (selectedFunctionId) => set({ selectedFunctionId }),
    setFocusLine: (focusLine) => set({ focusLine }),
    selectCycle: (selectedCycleIndex) => {
      if (selectedCycleIndex === null) {
        set({ selectedCycleIndex: null });
        return;
      }
      if (get().selectedCycleIndex === selectedCycleIndex) {
        get().clearFocus();
        return;
      }
      set({
        selectedCycleIndex,
        selectedId: null,
        selectedFunctionId: null,
        focusLine: null,
      });
      clearCallGraphState();
    },
    clearFocus: () => {
      set({
        selectedCycleIndex: null,
        selectedId: null,
        selectedFunctionId: null,
        focusLine: null,
      });
      clearCallGraphState();
    },
    toggleEdges: (kind) => set((state) => ({
      edgeToggles: { ...state.edgeToggles, [kind]: !state.edgeToggles[kind] },
    })),
    toggleFolderFilter: (folder) => set((state) => ({
      filters: { ...state.filters, hiddenFolders: toggled(state.filters.hiddenFolders, folder) },
    })),
    toggleExtensionFilter: (extension) => set((state) => ({
      filters: { ...state.filters, hiddenExtensions: toggled(state.filters.hiddenExtensions, extension) },
    })),
    resetFilters: () => set({ filters: EMPTY_FILTERS }),
    analyze: async (url) => {
      const currentRequest = ++requestCounter;
      const submittedUrl = url.trim();
      const startedAt = Date.now();

      if (!GITHUB_REPO_URL.test(submittedUrl)) {
        resetAnalysisView();
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

      resetAnalysisView();
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

        resetAnalysisView();
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
