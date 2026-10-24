import { useGraphStore } from '../store/useGraphStore';

const EMPTY_CYCLES: string[][] = [];

function shortName(path: string): string {
  return path.split(/[\\/]/).at(-1) || path;
}

export function CyclesPanel() {
  const cycles = useGraphStore((state) => state.graph?.cycles ?? EMPTY_CYCLES);
  const selectedCycleIndex = useGraphStore((state) => state.selectedCycleIndex);
  const selectCycle = useGraphStore((state) => state.selectCycle);
  const focusNode = useGraphStore((state) => state.focusNode);

  return (
    <section className="cycles-panel" aria-labelledby="cycles-title">
      <div className="cycles-panel-heading">
        <h3 className="panel-section-title" id="cycles-title">Circular imports</h3>
        <span className="cycles-count" aria-label={`${cycles.length} circular import cycles`}>
          {cycles.length}
        </span>
      </div>
      {cycles.length === 0 ? (
        <p className="cycles-empty">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="m3 8 3.2 3.2L13 4.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
          </svg>
          <span>No circular imports found</span>
        </p>
      ) : (
        <ol className="cycles-list">
          {cycles.map((cycle, index) => {
            const isSelected = selectedCycleIndex === index;
            const filesToShow = cycle.slice(0, 3);
            const fileSummary = filesToShow.map(shortName).join(', ');

            return (
              <li
                className={`cycles-item${isSelected ? ' cycles-item--selected' : ''}`}
                key={`${index}:${cycle.join('|')}`}
                title={cycle.join('\n')}
              >
                <button
                  className="cycles-item-toggle"
                  type="button"
                  aria-pressed={isSelected}
                  aria-expanded={isSelected}
                  onClick={() => selectCycle(index)}
                >
                  <span className="cycles-item-name">Cycle {index + 1}</span>
                  <span className="cycles-item-size">{cycle.length} files</span>
                </button>
                <div className="cycles-item-preview" title={cycle.join('\n')}>
                  <span>{fileSummary}</span>
                  {cycle.length > 3 && <span className="cycles-item-more">+{cycle.length - 3} more</span>}
                </div>
                {isSelected && (
                  <ul className="cycle-file-list">
                    {filesToShow.map((path) => (
                      <li key={path}>
                        <button
                          className="cycle-file-button"
                          type="button"
                          title={path}
                          onClick={() => focusNode(path)}
                        >
                          {shortName(path)}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
