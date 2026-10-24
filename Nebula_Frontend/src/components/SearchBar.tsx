import { useEffect, useId, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { searchRepositoryFiles, type SearchResult } from '../api/client';
import { useGraphStore } from '../store/useGraphStore';
import type { CallGraphNode } from '../types/graph';

type PendingSymbol = Extract<SearchResult, { type: 'symbol' }>;

function SymbolIcon({ kind }: { kind: string }) {
  if (kind === 'class') {
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
        <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2" stroke="currentColor" strokeWidth="1.4" />
        <path d="M5 5.25h6M5 8h6M5 10.75h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M5.25 3.25 1.75 8l3.5 4.75M10.75 3.25 14.25 8l-3.5 4.75M9.25 2.25l-2.5 11.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function matchesSymbol(node: CallGraphNode, symbol: PendingSymbol): boolean {
  return !node.external
    && node.file === symbol.path
    && node.name === symbol.name
    && node.line === symbol.line;
}

export function SearchBar() {
  const analysisId = useGraphStore((state) => state.analysisId);
  const status = useGraphStore((state) => state.status);
  const focusNode = useGraphStore((state) => state.focusNode);
  const setFocusLine = useGraphStore((state) => state.setFocusLine);
  const viewMode = useGraphStore((state) => state.viewMode);
  const callGraph = useGraphStore((state) => state.callGraph);
  const callGraphStatus = useGraphStore((state) => state.callGraphStatus);
  const selectFunction = useGraphStore((state) => state.selectFunction);
  const listboxId = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pendingSymbol, setPendingSymbol] = useState<PendingSymbol | null>(null);

  useEffect(() => {
    if (!pendingSymbol || viewMode !== 'function') return;
    if (callGraphStatus === 'loading' || callGraphStatus === 'idle') return;

    const match = callGraphStatus === 'ready'
      ? callGraph?.nodes.find((node) => matchesSymbol(node, pendingSymbol))
      : undefined;
    selectFunction(match?.id ?? null);
    setPendingSymbol(null);
  }, [callGraph, callGraphStatus, pendingSymbol, selectFunction, viewMode]);

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
          setResults([
            ...nextResults.filter((result) => result.type === 'file'),
            ...nextResults.filter((result) => result.type === 'symbol'),
          ]);
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

  useEffect(() => {
    if (!isOpen || !results[activeIndex]) return;
    document.getElementById(`${listboxId}-option-${activeIndex}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, isOpen, listboxId, results]);

  const chooseResult = (result: SearchResult) => {
    focusNode(result.path);
    if (result.type === 'symbol') {
      setFocusLine(result.line);
      setPendingSymbol(viewMode === 'function' ? result : null);
    } else {
      setFocusLine(null);
      setPendingSymbol(null);
    }
    setQuery('');
    setResults([]);
    setIsOpen(false);
  };

  const indexedResults = results.map((result, index) => ({ result, index }));
  const fileResults = indexedResults.filter(({ result }) => result.type === 'file');
  const symbolResults = indexedResults.filter(({ result }) => result.type === 'symbol');
  const hasSymbols = symbolResults.length > 0;

  const renderResult = ({ result, index }: { result: SearchResult; index: number }) => (
    <li key={`${result.type}:${result.path}:${result.type === 'symbol' ? `${result.line}:${result.name}` : result.name}`}>
      <button
        id={`${listboxId}-option-${index}`}
        className={`search-result${index === activeIndex ? ' search-result--active' : ''}${result.type === 'symbol' ? ' search-result--symbol' : ''}`}
        type="button"
        role="option"
        aria-label={result.type === 'symbol'
          ? `${result.kind} ${result.name}, ${result.path}:${result.line}`
          : `${result.name}, ${result.path}`}
        aria-selected={index === activeIndex}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => chooseResult(result)}
      >
        {result.type === 'symbol' ? (
          <>
            <span className={`search-result-icon search-result-icon--${result.kind === 'class' ? 'class' : 'function'}`}>
              <SymbolIcon kind={result.kind} />
            </span>
            <span className="search-result-symbol-copy">
              <span className="search-result-name">{result.name}</span>
              <span className="search-result-path">{result.path}:{result.line}</span>
            </span>
          </>
        ) : (
          <>
            <span className="search-result-name">{result.name}</span>
            <span className="search-result-path">{result.path}</span>
          </>
        )}
      </button>
    </li>
  );

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
            <ul
              className="search-results"
              id={listboxId}
              role="listbox"
              aria-label={hasSymbols ? 'Repository files and symbols' : 'Repository files'}
            >
              {hasSymbols && fileResults.length > 0 && (
                <li className="search-results-group" role="presentation">Files</li>
              )}
              {fileResults.map(renderResult)}
              {hasSymbols && <li className="search-results-group" role="presentation">Symbols</li>}
              {symbolResults.map(renderResult)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
