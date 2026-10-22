import { useEffect } from 'react';
import './App.css';
import { fetchMockGraph } from './api/client';
import { generateMockGraph } from './data/generateMock';
import { GraphCanvas } from './components/GraphCanvas';
import { LeftPanel } from './components/LeftPanel';
import { RightPanel } from './components/RightPanel';
import { TopBar } from './components/TopBar';
import { useGraphStore } from './store/useGraphStore';

export default function App() {
  const setGraph = useGraphStore((state) => state.setGraph);
  const setStatus = useGraphStore((state) => state.setStatus);

  useEffect(() => {
    let isMounted = true;
    setStatus('loading');

    if (new URLSearchParams(window.location.search).get('big') === '1') {
      setGraph(generateMockGraph());
      setStatus('ready');
      return () => {
        isMounted = false;
      };
    }

    fetchMockGraph()
      .then((graph) => {
        if (!isMounted) return;
        setGraph(graph);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (!isMounted) return;
        const message = error instanceof Error ? error.message : 'Could not load graph data.';
        setStatus('error', message);
      });

    return () => {
      isMounted = false;
    };
  }, [setGraph, setStatus]);

  return (
    <div className="app-shell">
      <TopBar />
      <div className="workspace">
        <LeftPanel />
        <GraphCanvas />
        <RightPanel />
      </div>
    </div>
  );
}
