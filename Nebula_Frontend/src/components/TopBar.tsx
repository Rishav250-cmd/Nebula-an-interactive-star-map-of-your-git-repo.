import { useGraphStore } from '../store/useGraphStore';

export function TopBar() {
  const repoUrl = useGraphStore((state) => state.repoUrl);
  const setRepoUrl = useGraphStore((state) => state.setRepoUrl);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">✦</span>
        <div>
          <div className="brand-name">Nebula</div>
          <div className="brand-tagline">An interactive star map of git</div>
        </div>
      </div>
      <div className="repo-form">
        <label className="visually-hidden" htmlFor="repo-url">Repository URL</label>
        <input
          className="repo-input"
          id="repo-url"
          type="url"
          placeholder="https://github.com/owner/repo"
          value={repoUrl}
          onChange={(event) => setRepoUrl(event.target.value)}
        />
        <button
          className="analyze-button"
          type="button"
          onClick={() => console.log(repoUrl)}
        >
          Analyze
        </button>
      </div>
    </header>
  );
}
