import { useMemo } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import type { HealthFile } from '../types/graph';

type PathfinderStep = {
  file: HealthFile;
  kind: 'hotspot' | 'god' | 'cycle' | 'complexity';
  reason: string;
};

function buildSteps(files: HealthFile[]): PathfinderStep[] {
  const candidates: PathfinderStep[] = [];
  for (const file of files) {
    if (file.isHotspot) {
      candidates.push({
        file,
        kind: 'hotspot',
        reason: `High churn (${file.churn ?? 0}) × complexity (C${file.maxComplexity}).`,
      });
      continue;
    }
    if (file.isGodFile) {
      candidates.push({ file, kind: 'god', reason: `Large file (${file.loc} LOC) with high complexity.` });
      continue;
    }
    if (file.inCycle) {
      candidates.push({ file, kind: 'cycle', reason: 'Part of a circular import cycle; break the dependency loop.' });
      continue;
    }
    if (file.maxComplexity >= 20) {
      candidates.push({ file, kind: 'complexity', reason: `High complexity (C${file.maxComplexity}); add tests before changing it.` });
    }
  }

  const kindOrder = { hotspot: 0, god: 1, cycle: 2, complexity: 3 };
  return candidates
    .sort((left, right) => kindOrder[left.kind] - kindOrder[right.kind]
      || (right.file.hotspotScore ?? 0) - (left.file.hotspotScore ?? 0)
      || left.file.healthScore - right.file.healthScore
      || left.file.id.localeCompare(right.file.id))
    .slice(0, 5);
}

export function PathfinderPanel() {
  const healthReport = useGraphStore((state) => state.healthReport);
  const focusNode = useGraphStore((state) => state.focusNode);
  const steps = useMemo(() => buildSteps(healthReport?.files ?? []), [healthReport]);

  return (
    <section className="pathfinder-panel" aria-labelledby="pathfinder-title">
      <div className="pathfinder-panel__header">
        <h3 id="pathfinder-title">Pathfinder</h3>
        <span>Start with these</span>
      </div>
      {!healthReport ? (
        <p className="pathfinder-panel__empty" role="status">Waiting for repository health…</p>
      ) : steps.length > 0 ? (
        <ol>
          {steps.map((step) => (
            <li key={step.file.id}>
              <div className="pathfinder-panel__step">
                <span className="pathfinder-panel__path" title={step.file.id}>{step.file.id}</span>
                <p>{step.reason}</p>
              </div>
              <button type="button" onClick={() => focusNode(step.file.id)} aria-label={`Focus ${step.file.id}`}>
                Focus
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="pathfinder-panel__empty">No priority files found. The repository is a good place to start.</p>
      )}
    </section>
  );
}
