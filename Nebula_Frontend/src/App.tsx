import { useCallback, useEffect } from 'react';
import './App.css';
import { fetchMockGraph } from './api/client';
import { generateMockGraph } from './data/generateMock';
import { GraphCanvas } from './components/GraphCanvas';
import { LeftPanel } from './components/LeftPanel';
import { RightPanel } from './components/RightPanel';
import { TopBar } from './components/TopBar';
import { useGraphStore } from './store/useGraphStore';

export default function App() {
  const repoUrl = useGraphStore((state) => state.repoUrl);
  const analyze = useGraphStore((state) => state.analyze);
  const setGraph = useGraphStore((state) => state.setGraph);
  const setStatus = useGraphStore((state) => state.setStatus);

  useEffect(() => {
    let isMounted = true;
    const params = new URLSearchParams(window.location.search);

    if (params.get('mock') === '1') {
      fetchMockGraph().then((graph) => {
        if (!isMounted) return;
        setGraph(graph);
        setStatus('ready');
      });
    } else if (params.get('big') === '1') {
      setGraph(generateMockGraph());
      setStatus('ready');
    }

    return () => { isMounted = false; };
  }, [setGraph, setStatus]);

  const handleAnalyze = useCallback(() => {
    void analyze(repoUrl);
  }, [analyze, repoUrl]);

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
