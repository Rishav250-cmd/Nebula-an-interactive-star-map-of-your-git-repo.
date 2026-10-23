import { useCallback, useEffect, useRef } from 'react';
import './App.css';
import { analyzeRepository, fetchGraph } from './api/client';
import { generateMockGraph } from './data/generateMock';
import { GraphCanvas } from './components/GraphCanvas';
import { LeftPanel } from './components/LeftPanel';
import { RightPanel } from './components/RightPanel';
import { TopBar } from './components/TopBar';
import { useGraphStore } from './store/useGraphStore';

export default function App() {
  const repoUrl = useGraphStore((state) => state.repoUrl);
  const setGraph = useGraphStore((state) => state.setGraph);
  const setAnalysisId = useGraphStore((state) => state.setAnalysisId);
  const setStatus = useGraphStore((state) => state.setStatus);
  const setProgressMessage = useGraphStore((state) => state.setProgressMessage);
  const selectNode = useGraphStore((state) => state.selectNode);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('big') === '1') {
      setGraph(generateMockGraph());
      setStatus('ready');
    }

    return () => controllerRef.current?.abort();
  }, [setGraph, setStatus]);

  const handleAnalyze = useCallback(async () => {
    const url = repoUrl.trim();
    if (!url) return;

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setGraph(null);
    setAnalysisId(null);
    selectNode(null);
    setProgressMessage('Cloning repository and building its dependency graph…');
    setStatus('loading');

    try {
      const analysis = await analyzeRepository(url, controller.signal);
      setAnalysisId(analysis.id);
      setProgressMessage('Loading dependency atlas…');
      const graph = await fetchGraph(analysis.id, controller.signal);
      setGraph(graph);
      setProgressMessage(null);
      setStatus('ready');
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      const message = error instanceof Error ? error.message : 'Could not analyze this repository.';
      setProgressMessage(null);
      setStatus('error', message);
    }
  }, [repoUrl, selectNode, setAnalysisId, setGraph, setProgressMessage, setStatus]);

  return (
    <div className="app-shell">
      <TopBar onAnalyze={handleAnalyze} />
      <div className="workspace">
        <LeftPanel />
        <GraphCanvas />
        <RightPanel />
      </div>
    </div>
  );
}
