import { useGraphStore } from '../store/useGraphStore';

export function RepositoryHealthCard() {
  const graph = useGraphStore((state) => state.graph);
  const analysisId = useGraphStore((state) => state.analysisId);
  const healthReport = useGraphStore((state) => state.healthReport);

  if (!graph) return null;

  const score = healthReport?.score;
  const tone = score == null ? 'unknown' : score >= 90 ? 'good' : score >= 80 ? 'watch' : 'risk';

  return (
    <section className={`repo-health-card repo-health-card--${tone}`} aria-labelledby="repo-health-title">
      <h3 id="repo-health-title">Repo health</h3>
      {healthReport ? (
        <>
          <div className="repo-health-card__main">
            <div className="repo-health-card__grade" title={`Health score ${healthReport.score} out of 100`}>
              {healthReport.grade ?? '—'}
            </div>
            <div className="repo-health-card__stats">
              <span><strong>{healthReport.summary.hotspotFiles}</strong> hotspots</span>
              <span><strong>{healthReport.summary.godFiles}</strong> god files</span>
              <span><strong>{healthReport.summary.cycleFiles}</strong> circular imports</span>
            </div>
          </div>
          <div className="repo-health-card__score">
            <span>{healthReport.score}/100</span>
            {healthReport.lowConfidence && <span>low confidence</span>}
          </div>
          {!healthReport.historyAvailable && (
            <p className="repo-health-card__note">No Git history; hotspot counts exclude churn.</p>
          )}
        </>
      ) : (
        <div className="repo-health-card__loading" role="status">
          {analysisId ? 'Calculating repository health…' : 'Health report is unavailable for this graph.'}
        </div>
      )}
    </section>
  );
}
