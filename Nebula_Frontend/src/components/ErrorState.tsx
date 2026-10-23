type ErrorStateProps = {
  error: string;
  lastUrl: string | null;
  onRetry: (url: string) => void;
};

export function ErrorState({ error, lastUrl, onRetry }: ErrorStateProps) {
  return (
    <section className="error-state" role="alert" aria-live="assertive">
      <span className="error-state-icon" aria-hidden="true">!</span>
      <h2>We couldn’t map this repository.</h2>
      <p className="error-state-message">{error}</p>
      {lastUrl && (
        <button className="retry-button" type="button" onClick={() => onRetry(lastUrl)}>
          Retry
        </button>
      )}
    </section>
  );
}
