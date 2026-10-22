export function GraphCanvas() {
  return (
    <main className="graph-canvas" aria-label="Dependency graph canvas">
      <div className="graph-placeholder" aria-hidden="true">
        <span className="graph-orbit graph-orbit--outer" />
        <span className="graph-orbit graph-orbit--middle" />
        <span className="graph-orbit graph-orbit--inner" />
        <span className="graph-core">✦</span>
        <span className="graph-node graph-node--one" />
        <span className="graph-node graph-node--two" />
        <span className="graph-node graph-node--three" />
        <p className="graph-placeholder-copy">Your dependency map will appear here</p>
      </div>
    </main>
  );
}
