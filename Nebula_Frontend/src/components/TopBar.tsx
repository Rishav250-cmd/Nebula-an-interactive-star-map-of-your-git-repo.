import { useGraphStore } from '../store/useGraphStore';

const EXAMPLE_REPOSITORIES = [
  { label: 'expressjs/express', url: 'https://github.com/expressjs/express' },
  { label: 'sindresorhus/ky', url: 'https://github.com/sindresorhus/ky' },
  { label: 'sindresorhus/is', url: 'https://github.com/sindresorhus/is' },
];

function repositoryName(repositoryUrl: string): string {
  try {
    const pathParts = new URL(repositoryUrl).pathname.split('/').filter(Boolean);
    const [owner, repository] = pathParts;
    if (owner && repository) return `${owner}/${repository.replace(/\.git$/i, '')}`;
  } catch {
    // Keep the backend value visible if it is not a URL.
  }

  return repositoryUrl;
}

type TopBarProps = {
  onAnalyze: (url: string) => void;
};

export function TopBar({ onAnalyze }: TopBarProps) {
  const repoUrl = useGraphStore((state) => state.repoUrl);
  const setRepoUrl = useGraphStore((state) => state.setRepoUrl);
  const status = useGraphStore((state) => state.status);
  const phase = useGraphStore((state) => state.phase);
  const graph = useGraphStore((state) => state.graph);
  const warnings = useGraphStore((state) => state.warnings);
  const isLoading = status === 'loading';
  const hasGraph = phase === 'ready' && graph !== null;

  const submitUrl = (url: string) => {
    setRepoUrl(url);
    onAnalyze(url);
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 48 48" focusable="false">
            <path className="brand-constellation-line" d="M24 5.5 39 14v20L24 42.5 9 34V14L24 5.5Z" />
            <path className="brand-constellation-line" d="m9 14 15 8.5L39 14M9 34l15-11.5L39 34M24 5.5v17" />
            <circle className="brand-star brand-star--teal" cx="24" cy="5.5" r="2.8" />
            <circle className="brand-star brand-star--violet" cx="39" cy="14" r="2.5" />
            <circle className="brand-star brand-star--teal" cx="39" cy="34" r="2.8" />
            <circle className="brand-star brand-star--violet" cx="24" cy="42.5" r="2.5" />
            <circle className="brand-star brand-star--teal" cx="9" cy="34" r="2.8" />
            <circle className="brand-star brand-star--violet" cx="9" cy="14" r="2.5" />
            <path className="brand-constellation-core" d="m24 15 2.2 6.8 6.8 2.2-6.8 2.2-2.2 6.8-2.2-6.8L15 24l6.8-2.2L24 15Z" />
          </svg>
        </span>
        <div>
          <div className="brand-name">Nebula</div>
          <div className="brand-tagline">Mapping the constellations of your codebase.</div>
        </div>
      </div>
      <form
        className="repo-form"
        onSubmit={(event) => {
          event.preventDefault();
          submitUrl(repoUrl);
        }}
      >
        <label className="visually-hidden" htmlFor="repo-url">Repository URL</label>
        <input
          className="repo-input"
          id="repo-url"
          type="text"
          autoComplete="url"
          placeholder="https://github.com/owner/repo"
          value={repoUrl}
          disabled={isLoading}
          onChange={(event) => setRepoUrl(event.target.value)}
        />
        <button className="analyze-button" type="submit" disabled={isLoading || !repoUrl.trim()}>
          {isLoading ? 'Analyzing…' : 'Analyze'}
        </button>
        <div className="example-repositories" aria-label="Example repositories">
          <span>Try:</span>
          {EXAMPLE_REPOSITORIES.map((repository) => (
            <button
              className="example-chip"
              type="button"
              key={repository.url}
              disabled={isLoading}
              onClick={() => submitUrl(repository.url)}
            >
              {repository.label}
            </button>
          ))}
        </div>
      </form>
      {hasGraph && (
        <div className="repo-summary" aria-live="polite">
          <div className="repo-summary-name" title={graph.repo} aria-label={graph.repo}>
            {repositoryName(graph.repo)}
          </div>
          <div className="repo-summary-counts">
            {graph.nodes.length.toLocaleString()} nodes · {graph.edges.length.toLocaleString()} edges
          </div>
          {warnings.length > 0 && (
            <details className="warnings-details">
              <summary>{warnings.length} {warnings.length === 1 ? 'file' : 'files'} skipped</summary>
              <ul className="warnings-list">
                {warnings.map((warning, index) => (
                  <li key={`${warning.file}-${index}`}>
                    <strong>{warning.file}</strong>
                    <span>{warning.message}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </header>
  );
}
