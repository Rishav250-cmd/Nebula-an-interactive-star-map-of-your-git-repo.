import type { FolderLegend } from '../lib/graphStyle';

type GraphLegendProps = {
  legend: FolderLegend;
};

export function GraphLegend({ legend }: GraphLegendProps) {
  if (legend.entries.length === 0) return null;
  const otherBackground = legend.otherColors.length > 1
    ? `linear-gradient(90deg, ${legend.otherColors.map((color, index) => {
      const start = Math.round((index / legend.otherColors.length) * 100);
      const end = Math.round(((index + 1) / legend.otherColors.length) * 100);
      return `${color} ${start}% ${end}%`;
    }).join(', ')})`
    : legend.otherColors[0] ?? '#667085';

  return (
    <aside className="graph-legend" aria-label="Graph legend">
      <div className="graph-legend-title">Folders</div>
      <ul className="graph-legend-list">
        {legend.entries.map((entry) => (
          <li className="graph-legend-item" key={entry.folder}>
            <span className="graph-legend-swatch" style={{ backgroundColor: entry.color }} aria-hidden="true" />
            <span>{entry.folder === '.' ? '(root)' : entry.folder}</span>
          </li>
        ))}
        {legend.otherCount > 0 && (
          <li className="graph-legend-item">
            <span
              className="graph-legend-swatch graph-legend-swatch--other"
              style={{ background: otherBackground }}
              aria-hidden="true"
            />
            <span>other</span>
          </li>
        )}
      </ul>
      <div className="graph-legend-size">size = lines of code</div>
      <div className="graph-legend-relations" aria-label="Selected file relationship colors">
        <span><i className="graph-legend-ring graph-legend-ring--selected" />selected</span>
        <span><i className="graph-legend-ring graph-legend-ring--imports" />imports</span>
        <span><i className="graph-legend-ring graph-legend-ring--importers" />importers</span>
      </div>
    </aside>
  );
}
