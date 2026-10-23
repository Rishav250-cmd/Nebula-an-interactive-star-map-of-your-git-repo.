import { useEffect, useId, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { searchRepositoryFiles, type SearchResult } from '../api/client';
import { useGraphStore } from '../store/useGraphStore';

export function SearchBar() {
  const analysisId = useGraphStore((state) => state.analysisId);
  const status = useGraphStore((state) => state.status);
  const focusNode = useGraphStore((state) => state.focusNode);
  const listboxId = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const searchQuery = query.trim();
    if (!analysisId || status !== 'ready' || !searchQuery) {
      setResults([]);
      setError(null);
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    setIsSearching(true);
    const timeoutId = window.setTimeout(() => {
      setError(null);
      searchRepositoryFiles(analysisId, searchQuery, controller.signal)
        .then((nextResults) => {
          if (controller.signal.aborted) return;
          setResults(nextResults);
          setActiveIndex(0);
        })
        .catch((searchError: unknown) => {
          if (controller.signal.aborted || (searchError instanceof DOMException && searchError.name === 'AbortError')) return;
          setResults([]);
          setError(searchError instanceof Error ? searchError.message : 'Search failed.');
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsSearching(false);
        });
    }, 180);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [analysisId, query, status]);

  const chooseResult = (result: SearchResult) => {
    focusNode(result.path);
    setQuery('');
    setResults([]);
    setIsOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setIsOpen(false);
      return;
    }

    if (event.key === 'ArrowDown' && results.length > 0) {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === 'ArrowUp' && results.length > 0) {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && isOpen && results[activeIndex]) {
      event.preventDefault();
      chooseResult(results[activeIndex]);
    }
  };

  const canSearch = Boolean(analysisId && status === 'ready');
  const showDropdown = isOpen && Boolean(query.trim());

  return (
    <div className="search-control">
      <label className="panel-section-title" htmlFor="file-search">Search files</label>
      <input
        id="file-search"
        className="search-input"
        type="search"
        placeholder={canSearch ? 'Type a file name…' : 'Analyze a repo to search'}
        value={query}
        disabled={!canSearch}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={showDropdown && results.length > 0 ? listboxId : undefined}
        aria-expanded={showDropdown}
        aria-activedescendant={showDropdown && results[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined}
        onChange={(event) => {
          setQuery(event.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={(event) => {
          const nextTarget = event.relatedTarget;
          if (nextTarget instanceof Node && event.currentTarget.parentElement?.contains(nextTarget)) return;
          setIsOpen(false);
        }}
        onKeyDown={handleKeyDown}
      />
      {showDropdown && (
        <div className="search-dropdown">
          {isSearching && <p className="search-message" role="status">Searching files…</p>}
          {error && <p className="search-message search-message--error" role="alert">{error}</p>}
          {!isSearching && !error && results.length === 0 && (
            <p className="search-message" role="status">No matching files</p>
          )}
          {results.length > 0 && (
            <ul className="search-results" id={listboxId} role="listbox" aria-label="Repository files">
              {results.map((result, index) => (
                <li key={result.path}>
                  <button
                    id={`${listboxId}-option-${index}`}
                    className={`search-result${index === activeIndex ? ' search-result--active' : ''}`}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => chooseResult(result)}
                  >
                    <span className="search-result-name">{result.name}</span>
                    <span className="search-result-path">{result.path}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
