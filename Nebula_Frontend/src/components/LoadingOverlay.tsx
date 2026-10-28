import { useEffect, useRef, useState } from 'react';
import type { AnalysisPhase, AnalysisProgressView } from '../store/useGraphStore';

type LoadingOverlayProps = {
  phase: Extract<AnalysisPhase, 'cloning' | 'parsing'>;
  phaseStartedAt: number | null;
  progress: AnalysisProgressView | null;
};

export function LoadingOverlay({ phase, phaseStartedAt, progress }: LoadingOverlayProps) {
  const analysisStartedAt = useRef<number | null>(phaseStartedAt);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (phase === 'cloning' || analysisStartedAt.current === null) {
      analysisStartedAt.current = phaseStartedAt ?? Date.now();
    }

    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [phase, phaseStartedAt]);

  const elapsedSeconds = analysisStartedAt.current === null
    ? 0
    : Math.floor(Math.max(0, now - analysisStartedAt.current) / 1000);
  const stageText = progress?.stage ?? (phase === 'cloning'
    ? 'Cloning repository'
    : 'Reading imports and building the graph');
  const percent = Math.max(0, Math.min(100, progress?.percent ?? 0));

  return (
    <div className="loading-overlay" role="status" aria-live="polite">
      <div className="galaxy-spinner" aria-hidden="true">
        <span className="galaxy-spinner-orbit galaxy-spinner-orbit--one" />
        <span className="galaxy-spinner-orbit galaxy-spinner-orbit--two" />
        <span className="galaxy-spinner-core" />
      </div>
      <p className="loading-stage">{stageText}</p>
      <div className="loading-progress" role="progressbar" aria-label={stageText} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="loading-percent">{percent}%</p>
      <p className="loading-elapsed">{elapsedSeconds} seconds elapsed</p>
    </div>
  );
}
