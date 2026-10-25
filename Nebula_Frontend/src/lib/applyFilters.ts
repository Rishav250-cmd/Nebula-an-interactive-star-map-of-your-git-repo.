import type { GraphData } from '../types/graph';

/** What the user has switched OFF. Empty lists mean "show everything". */
export type GraphFilters = {
  hiddenFolders: string[];
  hiddenExtensions: string[];
};

export type FilterOption = { name: string; count: number };

export const EMPTY_FILTERS: GraphFilters = { hiddenFolders: [], hiddenExtensions: [] };

/** Label used for files without an extension, such as LICENSE or .gitignore. */
export const NO_EXTENSION = '(none)';

/** "src/components/App.tsx" -> ".tsx"; "README" and ".gitignore" -> "(none)". */
export function fileExtension(filePath: string): string {
  const name = filePath.split('/').pop() ?? filePath;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : NO_EXTENSION;
}

export function hasActiveFilters(filters: GraphFilters): boolean {
  return filters.hiddenFolders.length > 0 || filters.hiddenExtensions.length > 0;
}

/**
 * Returns the graph without the hidden files, and without any edge that
 * touches a hidden file. With no active filter it returns the SAME object,
 * so React does not rebuild the graph or restart the layout for nothing.
 *
 * `cycles` is deliberately left as it is: the cycles list uses its index
 * numbers, and they must keep matching the full graph.
 */
export function applyFilters(graph: GraphData | null, filters: GraphFilters): GraphData | null {
  if (!graph || !hasActiveFilters(filters)) return graph;

  const hiddenFolders = new Set(filters.hiddenFolders);
  const hiddenExtensions = new Set(filters.hiddenExtensions);

  const nodes = graph.nodes.filter(
    (node) => !hiddenFolders.has(node.folder) && !hiddenExtensions.has(fileExtension(node.id)),
  );
  const visibleIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter(
    (edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target),
  );

  return { ...graph, nodes, edges };
}

function countBy(values: string[]): FilterOption[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);

  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

/** The checkboxes to show: every top-level folder and file type in the graph, biggest first. */
export function getFilterOptions(graph: GraphData | null): {
  folders: FilterOption[];
  extensions: FilterOption[];
} {
  if (!graph) return { folders: [], extensions: [] };
  return {
    folders: countBy(graph.nodes.map((node) => node.folder)),
    extensions: countBy(graph.nodes.map((node) => fileExtension(node.id))),
  };
}
