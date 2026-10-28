import { create } from 'zustand';
import {
  analyzeRepo,
  ApiError,
  errorForDisplay,
  fetchCallGraph,
  fetchGraph,
  getCachedRepositoryGraph,
  rememberRepositoryGraph,
  streamAnalysisProgress,
  fetchHealth,
  fetchOnboarding,
  type AnalysisProgress,
} from '../api/client';
import { EMPTY_FILTERS, type GraphFilters } from '../lib/applyFilters';
import type { CallGraph, GraphData, GraphWarning, HealthReport } from '../types/graph';

export type GraphStatus = 'idle' | 'loading' | 'ready' | 'error';
export type AnalysisPhase = 'idle' | 'cloning' | 'parsing' | 'ready' | 'error';
export type CallGraphStatus = 'idle' | 'loading' | 'ready' | 'error';
export type AnalysisProgressView = { stage: string; percent: number };
export type HealthLoadStatus = 'idle' | 'loading' | 'ready' | 'error';
export type EdgeToggleKind = 'imports' | 'calls' | 'cycles';
export type ViewMode = 'file' | 'function' | 'heatmap';
const GITHUB_REPO_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?\/?$/;
const INVALID_URL_MESSAGE = 'Enter a valid GitHub repository URL, such as https://github.com/owner/repo.';

type GraphStore = {
  repoUrl: string;
  graph: GraphData | null;
  healthReport: HealthReport | null;
  healthStatus: HealthLoadStatus;
  healthError: string | null;
  repoId: string | null;
  analysisId: string | null;
  status: GraphStatus;
  phase: AnalysisPhase;
  phaseStartedAt: number | null;
  warnings: GraphWarning[];
  lastUrl: string | null;
  error: string | null;
  analysisProgress: AnalysisProgressView | null;
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
  setHealthReport: (report: HealthReport | null) => void;
  loadHealthReport: (signal?: AbortSignal) => Promise<void>;
  setAnalysisId: (id: string | null) => void;
  setStatus: (status: GraphStatus, error?: string | null) => void;
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
  let healthRequestCounter = 0;
  let activeAnalysisController: AbortController | null = null;

  const cancelCallGraphRequest = () => {
    callGraphRequestCounter += 1;
  };

  const clearCallGraphState = () => {
    cancelCallGraphRequest();
    set({ callGraph: null, callGraphStatus: 'idle', callGraphError: null });
  };

  const resetAnalysisView = () => {
    cancelCallGraphRequest();
    healthRequestCounter += 1;
    set({
      viewMode: 'file',
      healthReport: null,
      healthStatus: 'idle',
      healthError: null,
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
    healthReport: null,
    healthStatus: 'idle',
    healthError: null,
    repoId: null,
    analysisId: null,
    status: 'idle',
    phase: 'idle',
    phaseStartedAt: null,
    warnings: [],
    lastUrl: null,
    error: null,
    analysisProgress: null,
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
    setHealthReport: (healthReport) => set({
      healthReport,
      healthStatus: healthReport ? 'ready' : 'idle',
      healthError: null,
    }),
    loadHealthReport: async (signal) => {
      const analysisId = get().analysisId;
      const requestId = ++healthRequestCounter;
      if (!analysisId) return;
      set({ healthStatus: 'loading', healthError: null });
      try {
        const healthReport = await fetchHealth(analysisId, signal);
        if (requestId !== healthRequestCounter || get().analysisId !== analysisId) return;
        set({ healthReport, healthStatus: 'ready', healthError: null });
      } catch (error: unknown) {
        if (signal?.aborted || requestId !== healthRequestCounter || get().analysisId !== analysisId) return;
        set({ healthReport: null, healthStatus: 'error', healthError: errorForDisplay(error) });
      }
    },
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
      } else {
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
          callGraphError: errorForDisplay(callGraphError),
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
      activeAnalysisController?.abort();
      activeAnalysisController = null;
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
          analysisProgress: null,
        });
        return;
      }

      const cachedRepository = getCachedRepositoryGraph(submittedUrl);
      resetAnalysisView();
      set({
        repoUrl: submittedUrl,
        lastUrl: submittedUrl,
        graph: cachedRepository?.graph ?? null,
        repoId: cachedRepository?.id ?? null,
        analysisId: cachedRepository?.id ?? null,
        warnings: cachedRepository?.graph.warnings ?? [],
        selectedId: null,
        hoveredId: null,
        phase: cachedRepository ? 'ready' : 'cloning',
        phaseStartedAt: startedAt,
        status: cachedRepository ? 'ready' : 'loading',
        error: null,
        analysisProgress: cachedRepository ? null : { stage: 'Starting analysis', percent: 0 },
      });
      if (cachedRepository) return;

      const controller = new AbortController();
      activeAnalysisController = controller;
      let timedOut = false;
      const timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 185_000);

      try {
        const analysis = await analyzeRepo(submittedUrl, controller.signal);
        if (currentRequest !== requestCounter) return;

        if (analysis.status !== 'ready') {
          await streamAnalysisProgress(analysis.id, (progress) => {
            if (currentRequest !== requestCounter) return;
            const nextPhase = progress.status === 'parsing' ? 'parsing' : 'cloning';
            set((state) => ({
              phase: nextPhase,
              phaseStartedAt: state.phase === nextPhase ? state.phaseStartedAt : Date.now(),
              analysisProgress: progressView(progress),
            }));
          }, controller.signal);
        }
        if (currentRequest !== requestCounter) return;

        set({
          phase: 'parsing',
          analysisProgress: { stage: 'Loading graph', percent: 96 },
        });

        const graph = await fetchGraph(analysis.id, controller.signal);
        if (currentRequest !== requestCounter) return;
        rememberRepositoryGraph(submittedUrl, analysis.id, graph);

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
          analysisProgress: null,
        });
        void fetchOnboarding(analysis.id, controller.signal).catch(() => {});
      } catch (analysisError: unknown) {
        if (currentRequest !== requestCounter) return;
        const safeError = timedOut
          ? new ApiError('ANALYSIS_TIMEOUT', 'Analysis timed out. Try again or use a smaller repository.')
          : analysisError;
        set({
          graph: null,
          repoId: null,
          analysisId: null,
          warnings: [],
          phase: 'error',
          phaseStartedAt: Date.now(),
          status: 'error',
          error: errorForDisplay(safeError),
          analysisProgress: null,
        });
      } finally {
        window.clearTimeout(timeoutId);
        if (activeAnalysisController === controller) activeAnalysisController = null;
      }
    },
  };
});

function progressView(progress: AnalysisProgress): AnalysisProgressView {
  const { status, progress: counts } = progress;
  if (status === 'parsing' && counts.total > 0) {
    return {
      stage: 'Parsing files',
      percent: Math.min(92, 15 + Math.floor((counts.done / counts.total) * 77)),
    };
  }
  const stages: Record<AnalysisProgress['status'], AnalysisProgressView> = {
    queued: { stage: 'Queued', percent: 1 },
    cloning: { stage: 'Cloning repository', percent: 5 },
    listing: { stage: 'Walking files', percent: 12 },
    parsing: { stage: 'Parsing files', percent: 15 },
    graph: { stage: 'Preparing graph', percent: 94 },
    ready: { stage: 'Loading graph', percent: 96 },
    error: { stage: 'Analysis failed', percent: 0 },
  };
  return stages[status];
}
