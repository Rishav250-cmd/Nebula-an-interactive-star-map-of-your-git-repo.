import { useMemo } from 'react';
import { buildAdjacency } from '../lib/graphHighlight';
import { useGraphStore } from '../store/useGraphStore';
import { ImportList } from './ImportList';
import { SearchBar } from './SearchBar';

export function LeftPanel() {
  const graph = useGraphStore((state) => state.graph);
  const selectedId = useGraphStore((state) => state.selectedId);
  const selectedNode = graph?.nodes.find((node) => node.id === selectedId) ?? null;
  const adjacency = useMemo(() => buildAdjacency(graph), [graph]);
  const relations = useMemo(() => (
    selectedId
      ? {
        imports: [...(adjacency.imports.get(selectedId) ?? [])],
        importers: [...(adjacency.importers.get(selectedId) ?? [])],
      }
      : { imports: [], importers: [] }
  ), [adjacency, selectedId]);

  return (
    <aside className="side-panel side-panel--left" aria-labelledby="explore-title">
      <h2 className="panel-title" id="explore-title">Explore</h2>
      <SearchBar />
      <section className="dependencies-section" aria-labelledby="dependencies-title">
        <h3 className="panel-section-title" id="dependencies-title">Dependencies</h3>
        {selectedId ? (
          <p className="selected-file-path" title={selectedId}>{selectedId}</p>
        ) : (
          <p className="relation-empty">Select a file on the map or search by name.</p>
        )}
        <ImportList
          title="Imports"
          paths={relations.imports}
          emptyMessage={selectedNode ? 'This file has no imports.' : 'Select a file to inspect its imports.'}
        />
        <ImportList
          title="Imported by"
          paths={relations.importers}
          emptyMessage={selectedNode ? 'No files import this file.' : 'Select a file to inspect its importers.'}
        />
      </section>
    </aside>
  );
}
