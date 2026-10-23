import { useGraphStore } from '../store/useGraphStore';

type TopBarProps = {
  onAnalyze: () => void;
};

export function TopBar({ onAnalyze }: TopBarProps) {
  const repoUrl = useGraphStore((state) => state.repoUrl);
  const setRepoUrl = useGraphStore((state) => state.setRepoUrl);
  const status = useGraphStore((state) => state.status);
  const isLoading = status === 'loading';

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">✦</span>
        <div>
          <div className="brand-name">Nebula</div>
          <div className="brand-tagline">An interactive star map of git</div>
        </div>
      </div>
      <form
        className="repo-form"
        onSubmit={(event) => {
          event.preventDefault();
          onAnalyze();
        }}
      >
        <label className="visually-hidden" htmlFor="repo-url">Repository URL</label>
        <input
          className="repo-input"
          id="repo-url"
          type="url"
          placeholder="https://github.com/owner/repo"
          value={repoUrl}
          required
          disabled={isLoading}
          onChange={(event) => setRepoUrl(event.target.value)}
        />
        <button className="analyze-button" type="submit" disabled={isLoading || !repoUrl.trim()}>
          {isLoading ? 'Analyzing…' : 'Analyze'}
        </button>
      </form>
    </header>
  );
}
