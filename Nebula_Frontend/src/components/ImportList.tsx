import { useGraphStore } from '../store/useGraphStore';

type ImportListProps = {
  title: string;
  paths: string[];
  emptyMessage: string;
};

export function ImportList({ title, paths, emptyMessage }: ImportListProps) {
  const selectedId = useGraphStore((state) => state.selectedId);
  const focusNode = useGraphStore((state) => state.focusNode);

  return (
    <section className="relation-section" aria-label={title}>
      <h3 className="relation-title">
        {title}
        <span className="relation-count">{paths.length}</span>
      </h3>
      {paths.length === 0 ? (
        <p className="relation-empty">{emptyMessage}</p>
      ) : (
        <ul className="relation-list">
          {paths.map((path) => (
            <li key={path}>
              <button
                className={`relation-button${selectedId === path ? ' relation-button--selected' : ''}`}
                type="button"
                title={`Focus ${path}`}
                onClick={() => focusNode(path)}
              >
                {path}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
