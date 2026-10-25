import { useCallback, useEffect, useState } from 'react';
import './App.css';
import { fetchMockGraph } from './api/client';
import { generateMockGraph } from './data/generateMock';
import { GraphCanvas } from './components/GraphCanvas';
import { LeftPanel } from './components/LeftPanel';
import { RightPanel } from './components/RightPanel';
import { SplashScreen } from './components/SplashScreen';
import { TopBar } from './components/TopBar';
import { useGraphStore } from './store/useGraphStore';

export default function App() {
  const [showSplash, setShowSplash] = useState(shouldShowSplash);
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

  useEffect(() => {
    if (!showSplash) return;

    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
    };
  }, [showSplash]);

  const handleAnalyze = useCallback((url: string) => {
    void analyze(url);
  }, [analyze]);

  const handleSplashDone = useCallback(() => {
    try {
      window.sessionStorage.setItem('nebula_splash_seen', '1');
    } catch {
      // The splash still completes when browser storage is unavailable.
    }
    setShowSplash(false);
  }, []);

  return (
    <>
      <div className="app-shell" inert={showSplash} aria-hidden={showSplash}>
        <TopBar onAnalyze={handleAnalyze} />
        <div className="workspace">
          <LeftPanel />
          <GraphCanvas />
          <RightPanel />
        </div>
      </div>
      {showSplash && <SplashScreen onDone={handleSplashDone} />}
    </>
  );
}

function shouldShowSplash() {
  if (new URLSearchParams(window.location.search).get('nosplash') === '1') {
    return false;
  }

  try {
    return window.sessionStorage.getItem('nebula_splash_seen') !== '1';
  } catch {
    return true;
  }
}
