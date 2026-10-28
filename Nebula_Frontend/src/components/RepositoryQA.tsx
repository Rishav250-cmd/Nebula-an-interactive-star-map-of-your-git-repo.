import { useEffect, useRef, useState, type FormEvent } from 'react';
import { askRepositoryQuestion } from '../api/client';
import { useGraphStore } from '../store/useGraphStore';
import type { RepositoryQAResponse } from '../types/graph';

const SUGGESTIONS = [
  'Where is authentication handled?',
  'Where are API routes defined?',
];

export function RepositoryQA() {
  const graph = useGraphStore((state) => state.graph);
  const analysisId = useGraphStore((state) => state.analysisId);
  const focusNode = useGraphStore((state) => state.focusNode);
  const setQAFilePaths = useGraphStore((state) => state.setQAFilePaths);
  const clearQAHighlights = useGraphStore((state) => state.clearQAHighlights);
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<RepositoryQAResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    setQuestion('');
    setResult(null);
    setError(null);
    setLoading(false);
    clearQAHighlights();
    return () => requestRef.current?.abort();
  }, [analysisId, clearQAHighlights]);

  async function submitQuestion(value = question) {
    const trimmed = value.trim();
    if (!analysisId || !graph || trimmed.length < 3 || loading) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setQuestion(trimmed);
    setLoading(true);
    setError(null);
    setResult(null);
    clearQAHighlights();
    try {
      const response = await askRepositoryQuestion(analysisId, trimmed, controller.signal);
      if (controller.signal.aborted) return;
      setResult(response);
      setQAFilePaths(response.matches.map((match) => match.path));
    } catch (requestError: unknown) {
      if (controller.signal.aborted) return;
      setError(requestError instanceof Error ? requestError.message : 'Could not search this repository.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitQuestion();
  }

  return (
    <section className="repository-qa" aria-labelledby="repository-qa-title">
      <div className="repository-qa__heading">
        <div>
          <h3 className="panel-section-title" id="repository-qa-title">Repository Q&amp;A</h3>
          <p className="repository-qa__description">Ask about this codebase. Supporting files light up on the map.</p>
        </div>
        {result && (
          <div className="repository-qa__heading-actions">
            <span className="repository-qa__count">{result.matches.length} files</span>
            <button
              type="button"
              className="repository-qa__clear"
              onClick={() => { setResult(null); clearQAHighlights(); }}
              aria-label="Clear Q&A results and map highlights"
            >Clear</button>
          </div>
        )}
      </div>
      <form className="repository-qa__form" onSubmit={handleSubmit}>
        <textarea
          className="repository-qa__input"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={graph ? 'Where is authentication handled?' : 'Analyze a repository to ask a question'}
          aria-label="Ask a question about the repository"
          maxLength={300}
          rows={2}
          disabled={!graph || loading}
        />
        <button className="repository-qa__ask" type="submit" disabled={!graph || loading || question.trim().length < 3}>
          {loading ? 'Searching…' : 'Ask'}
        </button>
      </form>
      {!result && !loading && !error && (
        <div className="repository-qa__suggestions" aria-label="Suggested questions">
          {SUGGESTIONS.map((suggestion) => (
            <button key={suggestion} type="button" onClick={() => void submitQuestion(suggestion)} disabled={!graph}>
              {suggestion}
            </button>
          ))}
        </div>
      )}
      {loading && <p className="repository-qa__status" role="status">Searching source files for evidence…</p>}
      {error && <p className="repository-qa__error" role="alert">{error}</p>}
      {result && (
        <div className="repository-qa__results" aria-live="polite">
          <p className="repository-qa__answer">{result.answer}</p>
          {result.matches.length > 0 && (
            <ul className="repository-qa__matches">
              {result.matches.map((match) => (
                <li key={`${match.path}:${match.line}`}>
                  <button
                    type="button"
                    className="repository-qa__file"
                    title={`Focus ${match.path} on the map`}
                    onClick={() => focusNode(match.path)}
                  >
                    <span>{match.path}</span><small>:L{match.line}</small>
                  </button>
                  <code>{match.snippet}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
