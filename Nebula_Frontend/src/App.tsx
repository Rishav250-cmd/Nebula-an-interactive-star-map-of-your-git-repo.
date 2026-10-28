import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type {
  CSSProperties,
  KeyboardEvent,
  PointerEvent,
  RefObject,
} from 'react';
import './App.css';
import { fetchMockGraph } from './api/client';
import { generateMockGraph } from './data/generateMock';
import { GraphCanvas } from './components/GraphCanvas';
import { LeftPanel } from './components/LeftPanel';
import { SplashScreen } from './components/SplashScreen';
import { TopBar } from './components/TopBar';
import { useGraphStore } from './store/useGraphStore';

const RightPanel = lazy(() => import('./components/RightPanel').then((module) => ({ default: module.RightPanel })));


export default function App() {
  const [showSplash, setShowSplash] = useState(shouldShowSplash);
  const [leftPanelWidth, setLeftPanelWidth] = useState(260);
  const [rightPanelWidth, setRightPanelWidth] = useState(380);
  const workspaceRef = useRef<HTMLDivElement>(null);
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
        <div
          className="workspace"
          ref={workspaceRef}
          style={{
            '--left-panel-width': `${leftPanelWidth}px`,
            '--right-panel-width': `${rightPanelWidth}px`,
          } as CSSProperties}
        >
          <LeftPanel />
          <PanelResizeHandle
            side="left"
            value={leftPanelWidth}
            min={200}
            max={520}
            oppositeWidth={rightPanelWidth}
            workspaceRef={workspaceRef}
            onChange={setLeftPanelWidth}
          />
          <GraphCanvas />
          <PanelResizeHandle
            side="right"
            value={rightPanelWidth}
            min={260}
            max={620}
            oppositeWidth={leftPanelWidth}
            workspaceRef={workspaceRef}
            onChange={setRightPanelWidth}
          />
          <Suspense fallback={(
            <aside className="side-panel side-panel--right" aria-label="Code panel">
              <p className="panel-placeholder" role="status">Loading code panel…</p>
            </aside>
          )}>
            <RightPanel />
          </Suspense>
        </div>
      </div>
      {showSplash && <SplashScreen onDone={handleSplashDone} />}
    </>
  );
}

type PanelSide = 'left' | 'right';

type PanelResizeHandleProps = {
  side: PanelSide;
  value: number;
  min: number;
  max: number;
  oppositeWidth: number;
  workspaceRef: RefObject<HTMLDivElement | null>;
  onChange: (value: number) => void;
};

function PanelResizeHandle({
  side,
  value,
  min,
  max,
  oppositeWidth,
  workspaceRef,
  onChange,
}: PanelResizeHandleProps) {
  const getLimits = useCallback(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return { min, max };
    const bounds = workspace.getBoundingClientRect();
    const isMobile = window.matchMedia('(max-width: 760px)').matches;
    const isCompact = window.matchMedia('(max-width: 1000px)').matches;
    const otherPanelWidth = side === 'left' && isMobile ? 0 : oppositeWidth;
    const graphMinimum = isCompact ? 180 : 280;
    const available =
      bounds.width - otherPanelWidth - graphMinimum - (isCompact ? 12 : 16);
    const responsiveMax = isMobile ? Math.min(max, 320) : max;
    return { min, max: Math.max(min, Math.min(responsiveMax, available)) };
  }, [max, min, oppositeWidth, side, workspaceRef]);

  const resizeTo = useCallback(
    (clientX: number, gutterWidth: number) => {
      const workspace = workspaceRef.current;
      if (!workspace) return;
      const bounds = workspace.getBoundingClientRect();
      const width =
        side === 'left'
          ? clientX - bounds.left - gutterWidth / 2
          : bounds.right - clientX - gutterWidth / 2;
      const limits = getLimits();
      onChange(Math.round(Math.min(limits.max, Math.max(limits.min, width))));
    },
    [getLimits, onChange, side, workspaceRef],
  );

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeTo(event.clientX, event.currentTarget.getBoundingClientRect().width);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      resizeTo(event.clientX, event.currentTarget.getBoundingClientRect().width);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction = side === 'left' ? 1 : -1;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const adjustment = event.key === 'ArrowRight' ? 16 : -16;
      const limits = getLimits();
      onChange(
        Math.min(
          limits.max,
          Math.max(limits.min, value + adjustment * direction),
        ),
      );
    } else if (event.key === 'Home') {
      event.preventDefault();
      onChange(getLimits().min);
    } else if (event.key === 'End') {
      event.preventDefault();
      onChange(getLimits().max);
    }
  };

  return (
    <div
      className={`panel-resizer panel-resizer--${side}`}
      role="separator"
      aria-label={`Resize ${side} panel`}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${value} pixels`}
      tabIndex={0}
      title={`Drag to resize ${side} panel`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onKeyDown={handleKeyDown}
    >
      <span className="panel-resizer__grip" aria-hidden="true" />
    </div>
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
