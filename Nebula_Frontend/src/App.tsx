import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { SplashScreen, SPLASH_TIMING } from './components/SplashScreen';
import { TopBar } from './components/TopBar';
import { useGraphStore } from './store/useGraphStore';

const MemoizedGraphCanvas = memo(GraphCanvas);
const MemoizedLeftPanel = memo(LeftPanel);
const MemoizedTopBar = memo(TopBar);
const LazyRightPanel = lazy(() => import('./components/RightPanel').then((module) => ({ default: module.RightPanel })));
const RightPanel = memo(LazyRightPanel);

type SplashPhase = 'loading' | 'travel' | 'reveal' | 'done';
type RevealOrigin = { x: number; y: number };

export default function App() {
  const [showSplash, setShowSplash] = useState(shouldShowSplash);
  const [splashPhase, setSplashPhase] = useState<SplashPhase>(() => showSplash ? 'loading' : 'done');
  const [revealOrigin, setRevealOrigin] = useState<RevealOrigin | null>(null);
  const [reducedMotionReveal, setReducedMotionReveal] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(260);
  const [rightPanelWidth, setRightPanelWidth] = useState(380);
  const appShellRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const analyze = useGraphStore((state) => state.analyze);
  const setGraph = useGraphStore((state) => state.setGraph);
  const setStatus = useGraphStore((state) => state.setStatus);

  const handleSplashPhaseChange = useCallback((
    nextPhase: SplashPhase,
    nextOrigin?: RevealOrigin,
    reducedMotion = false,
  ) => {
    setSplashPhase(nextPhase);
    if (nextOrigin) setRevealOrigin(nextOrigin);
    setReducedMotionReveal(reducedMotion);
  }, []);

  const handleSplashDone = useCallback(() => {
    try {
      window.sessionStorage.setItem('nebula_splash_seen', '1');
    } catch {
      // Keep the completed app usable when browser storage is unavailable.
    }
    setSplashPhase('done');
    setShowSplash(false);
  }, []);

  useLayoutEffect(() => {
    if (!showSplash || splashPhase !== 'reveal' || !revealOrigin) return;
    const appShell = appShellRef.current;
    if (!appShell) {
      handleSplashDone();
      return;
    }

    const { x, y } = revealOrigin;
    const animation = appShell.animate(
      reducedMotionReveal
        ? [
          { opacity: 0, transform: 'none', clipPath: 'none' },
          { opacity: 1, transform: 'none', clipPath: 'none' },
        ]
        : [
          {
            opacity: 0,
            transform: `scale(${SPLASH_TIMING.appStartScale})`,
            clipPath: `circle(0px at ${x}px ${y}px)`,
          },
          {
            opacity: 1,
            transform: 'scale(1)',
            clipPath: `circle(150% at ${x}px ${y}px)`,
          },
        ],
      {
        duration: reducedMotionReveal
          ? SPLASH_TIMING.reducedMotionFadeMs
          : SPLASH_TIMING.appRevealMs,
        easing: SPLASH_TIMING.revealEasing,
        fill: 'forwards',
      },
    );
    let active = true;
    void animation.finished.then(() => {
      if (active) handleSplashDone();
    }).catch(() => {});

    return () => {
      active = false;
      animation.cancel();
    };
  }, [handleSplashDone, reducedMotionReveal, revealOrigin, showSplash, splashPhase]);

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

  return (
    <>
      <div
        className={[
          'app-shell',
          showSplash ? 'app-shell--locked' : '',
          showSplash && splashPhase === 'reveal' ? 'app-shell--revealing' : '',
          showSplash && reducedMotionReveal ? 'app-shell--crossfade' : '',
        ].filter(Boolean).join(' ')}
        style={{
          '--reveal-x': `${revealOrigin?.x ?? 0}px`,
          '--reveal-y': `${revealOrigin?.y ?? 0}px`,
        } as CSSProperties}
        ref={appShellRef}
        inert={showSplash}
        aria-hidden={showSplash}
      >
        <MemoizedTopBar onAnalyze={handleAnalyze} headerLogoVisible={!showSplash || splashPhase === 'reveal'} />
        <div
          className="workspace"
          ref={workspaceRef}
          style={{
            '--left-panel-width': `${leftPanelWidth}px`,
            '--right-panel-width': `${rightPanelWidth}px`,
          } as CSSProperties}
        >
          <MemoizedLeftPanel />
          <PanelResizeHandle
            side="left"
            value={leftPanelWidth}
            min={200}
            max={520}
            oppositeWidth={rightPanelWidth}
            workspaceRef={workspaceRef}
            onChange={setLeftPanelWidth}
          />
          <MemoizedGraphCanvas />
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
      {showSplash && (
        <SplashScreen
          appShellRef={appShellRef}
          onPhaseChange={handleSplashPhaseChange}
        />
      )}
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
  const dragSession = useRef<{ bounds: DOMRect; gutterWidth: number; min: number; max: number } | null>(null);
  const pendingClientX = useRef<number | null>(null);
  const animationFrame = useRef<number | null>(null);

  const getLimits = useCallback((measuredBounds?: DOMRect) => {
    const workspace = workspaceRef.current;
    if (!workspace) return { min, max };
    const bounds = measuredBounds ?? workspace.getBoundingClientRect();
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
    (clientX: number, session = dragSession.current) => {
      const workspace = workspaceRef.current;
      if (!workspace) return;
      const bounds = session?.bounds ?? workspace.getBoundingClientRect();
      const width =
        side === 'left'
          ? clientX - bounds.left - (session?.gutterWidth ?? 0) / 2
          : bounds.right - clientX - (session?.gutterWidth ?? 0) / 2;
      const limits = session ?? getLimits(bounds);
      onChange(Math.round(Math.min(limits.max, Math.max(limits.min, width))));
    },
    [getLimits, onChange, side, workspaceRef],
  );

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = workspaceRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const limits = getLimits(bounds);
    dragSession.current = {
      bounds,
      gutterWidth: event.currentTarget.getBoundingClientRect().width,
      min: limits.min,
      max: limits.max,
    };
    resizeTo(event.clientX);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    pendingClientX.current = event.clientX;
    if (animationFrame.current !== null) return;
    animationFrame.current = window.requestAnimationFrame(() => {
      animationFrame.current = null;
      const clientX = pendingClientX.current;
      pendingClientX.current = null;
      if (clientX !== null && dragSession.current) resizeTo(clientX);
    });
  };

  const finishPointerResize = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragSession.current) return;
    if (animationFrame.current !== null) window.cancelAnimationFrame(animationFrame.current);
    animationFrame.current = null;
    pendingClientX.current = null;
    resizeTo(event.clientX);
    dragSession.current = null;
  };

  useEffect(() => () => {
    if (animationFrame.current !== null) window.cancelAnimationFrame(animationFrame.current);
  }, []);

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
      onPointerUp={finishPointerResize}
      onPointerCancel={finishPointerResize}
      onKeyDown={handleKeyDown}
    >
      <span className="panel-resizer__grip" aria-hidden="true" />
    </div>
  );
}

function shouldShowSplash() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('splash') === '1') return true;
  if (params.get('nosplash') === '1') return false;

  try {
    if (window.sessionStorage.getItem('nebula_splash_seen') === '1') return false;
    // Claim the session at first render so a hot reload won't replay the splash.
    window.sessionStorage.setItem('nebula_splash_seen', '1');
    return true;
  } catch {
    return true;
  }
}
