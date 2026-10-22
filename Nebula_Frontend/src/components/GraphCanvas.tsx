import { useGraphStore } from '../store/useGraphStore';

export function GraphCanvas() {
  const graph = useGraphStore((state) => state.graph);
  const status = useGraphStore((state) => state.status);
  const error = useGraphStore((state) => state.error);

  if (status === 'idle' || status === 'loading') {
    return (
      <main className="graph-canvas" aria-label="Dependency graph canvas">
        <p className="graph-state">Loading galaxy...</p>
      </main>
    );
  }

  if (status === 'error') {
    return (
      <main className="graph-canvas" aria-label="Dependency graph canvas">
        <p className="graph-state graph-state--error" role="alert">
          {error ?? 'Could not load graph data.'}
        </p>
      </main>
    );
  }

  return (
    <main className="graph-canvas" aria-label="Dependency graph canvas">
      <div className="graph-placeholder">
        <span className="graph-orbit graph-orbit--outer" aria-hidden="true" />
        <span className="graph-orbit graph-orbit--middle" aria-hidden="true" />
        <span className="graph-orbit graph-orbit--inner" aria-hidden="true" />
        <span className="graph-core" aria-hidden="true">✦</span>
        <span className="graph-node graph-node--one" aria-hidden="true" />
        <span className="graph-node graph-node--two" aria-hidden="true" />
        <span className="graph-node graph-node--three" aria-hidden="true" />
        <p className="graph-placeholder-copy">
          {graph
            ? `${graph.repo} · ${graph.nodes.length} files · ${graph.edges.length} dependencies`
            : 'Your dependency map will appear here'}
        </p>
      </div>
    </main>
  );
}
