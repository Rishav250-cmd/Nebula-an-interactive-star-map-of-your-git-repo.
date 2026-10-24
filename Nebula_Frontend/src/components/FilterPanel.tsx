import { useMemo } from 'react';
import {
  applyFilters,
  getFilterOptions,
  hasActiveFilters,
  type FilterOption,
} from '../lib/applyFilters';
import { folderColor } from '../lib/graphStyle';
import { useGraphStore } from '../store/useGraphStore';

type CheckboxListProps = {
  label: string;
  options: FilterOption[];
  hidden: string[];
  onToggle: (name: string) => void;
  colorFor?: (name: string) => string;
  displayName?: (name: string) => string;
};

function CheckboxList({ label, options, hidden, onToggle, colorFor, displayName }: CheckboxListProps) {
  return (
    <fieldset className="filter-group">
      <legend className="filter-group-title">{label}</legend>
      <ul className="filter-list">
        {options.map((option) => (
          <li key={option.name}>
            <label className="filter-option">
              <input
                type="checkbox"
                checked={!hidden.includes(option.name)}
                onChange={() => onToggle(option.name)}
              />
              {colorFor && (
                <span
                  className="filter-swatch"
                  style={{ backgroundColor: colorFor(option.name) }}
                  aria-hidden="true"
                />
              )}
              <span className="filter-option-name">{displayName ? displayName(option.name) : option.name}</span>
              <span className="filter-option-count">{option.count}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

export function FilterPanel() {
  const graph = useGraphStore((state) => state.graph);
  const filters = useGraphStore((state) => state.filters);
  const toggleFolderFilter = useGraphStore((state) => state.toggleFolderFilter);
  const toggleExtensionFilter = useGraphStore((state) => state.toggleExtensionFilter);
  const resetFilters = useGraphStore((state) => state.resetFilters);

  const options = useMemo(() => getFilterOptions(graph), [graph]);
  const allFolders = useMemo(() => graph?.nodes.map((node) => node.folder) ?? [], [graph]);
  const visibleCount = useMemo(() => applyFilters(graph, filters)?.nodes.length ?? 0, [graph, filters]);

  const totalCount = graph?.nodes.length ?? 0;
  const isFiltered = hasActiveFilters(filters);
  const hiddenCount = filters.hiddenFolders.length + filters.hiddenExtensions.length;

  return (
    <details className="filter-panel" open>
      <summary className="filter-summary">
        <span className="panel-section-title">Filters</span>
        {isFiltered && <span className="filter-badge">{hiddenCount} hidden</span>}
      </summary>

      {!graph ? (
        <p className="relation-empty">Analyze a repository to filter its files.</p>
      ) : (
        <>
          <div className="filter-status">
            <span aria-live="polite">
              Showing {visibleCount} of {totalCount} files
            </span>
            <button type="button" className="filter-reset" onClick={resetFilters} disabled={!isFiltered}>
              Reset
            </button>
          </div>

          {isFiltered && visibleCount === 0 && (
            <p className="relation-empty">No files match these filters. Tick a box or press Reset.</p>
          )}

          <CheckboxList
            label="Folders"
            options={options.folders}
            hidden={filters.hiddenFolders}
            onToggle={toggleFolderFilter}
            colorFor={(folder) => folderColor(folder, allFolders)}
            displayName={(folder) => (folder === '.' ? '(root files)' : folder)}
          />
          <CheckboxList
            label="File types"
            options={options.extensions}
            hidden={filters.hiddenExtensions}
            onToggle={toggleExtensionFilter}
          />
        </>
      )}
    </details>
  );
}
