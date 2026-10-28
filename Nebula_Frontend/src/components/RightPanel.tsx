import { useEffect, useMemo, useRef, useState } from 'react';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import { errorForDisplay, fetchRepositoryFile, type FileResponse } from '../api/client';
import { useGraphStore } from '../store/useGraphStore';
import { buildAdjacency } from '../lib/graphHighlight';

SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('jsx', jsx);
SyntaxHighlighter.registerLanguage('typescript', typescript);
SyntaxHighlighter.registerLanguage('tsx', tsx);

const HIGHLIGHT_LANGUAGES: Record<string, string> = {
  js: 'javascript',
  javascript: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  typescript: 'typescript',
  tsx: 'tsx',
};

function syntaxLanguage(language: string, path: string): string | undefined {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  return HIGHLIGHT_LANGUAGES[extension] ?? HIGHLIGHT_LANGUAGES[language.toLowerCase()];
}

type FileLoadState =
  | { key: null; status: 'idle' }
  | { key: string; status: 'loading' }
  | { key: string; status: 'ready'; file: FileResponse }
  | { key: string; status: 'error'; message: string };

export function RightPanel() {
  const analysisId = useGraphStore((state) => state.analysisId);
  const graph = useGraphStore((state) => state.graph);
  const selectedId = useGraphStore((state) => state.selectedId);
  const focusLine = useGraphStore((state) => state.focusLine);
  const setFocusLine = useGraphStore((state) => state.setFocusLine);
  const adjacency = useMemo(() => buildAdjacency(graph), [graph]);
  const codeViewportRef = useRef<HTMLDivElement | null>(null);
  const [fileState, setFileState] = useState<FileLoadState>({ key: null, status: 'idle' });
  const [fileRetry, setFileRetry] = useState(0);
  const [flashedLine, setFlashedLine] = useState<number | null>(null);
  const requestKey = analysisId && selectedId ? `${analysisId}\0${selectedId}` : null;

  useEffect(() => {
    if (!analysisId || !selectedId || !requestKey) {
      setFileState({ key: null, status: 'idle' });
      return;
    }

    const controller = new AbortController();
    setFileState({ key: requestKey, status: 'loading' });

    fetchRepositoryFile(analysisId, selectedId, controller.signal)
      .then((nextFile) => {
        setFileState({ key: requestKey, status: 'ready', file: nextFile });
      })
      .catch((fileError: unknown) => {
        if (fileError instanceof DOMException && fileError.name === 'AbortError') return;
        setFileState({
          key: requestKey,
          status: 'error',
          message: errorForDisplay(fileError),
        });
      });

    return () => controller.abort();
  }, [analysisId, fileRetry, requestKey, selectedId]);

  const visibleState = !requestKey
    ? { key: null, status: 'idle' } as const
    : fileState.key === requestKey
      ? fileState
      : { key: requestKey, status: 'loading' } as const;
  const file = visibleState.status === 'ready' ? visibleState.file : null;

  useEffect(() => {
    if (!focusLine || !file || !codeViewportRef.current) return;
    setFlashedLine(focusLine);
    let frameId = 0;
    const timeoutId = window.setTimeout(() => setFlashedLine(null), 1_500);
    frameId = requestAnimationFrame(() => {
      const viewport = codeViewportRef.current;
      const target = viewport?.querySelector<HTMLElement>(`[data-line-number="${focusLine}"]`);
      if (!viewport || !target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    });
    return () => {
      cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [file, focusLine, selectedId]);

  return (
    <aside className="side-panel side-panel--right" aria-labelledby="code-title">
      <div className="code-panel-header">
        <h2 className="panel-title" id="code-title">Code</h2>
        {file && <span className="code-language">{file.language}</span>}
      </div>
      {selectedId && graph?.nodes.some((node) => node.id === selectedId) && (
        <p className="relation-count-chip" aria-label="Selected file relationships">
          {adjacency.imports.get(selectedId)?.size ?? 0} imports · {adjacency.importers.get(selectedId)?.size ?? 0} importers
        </p>
      )}
      {selectedId && <p className="code-file-path" title={selectedId}>{selectedId}</p>}
      {file && <p className="code-loc">{file.loc.toLocaleString()} lines</p>}
      {file?.functions && file.functions.length > 0 && (
        <div className="function-complexity-list" aria-label="Functions and complexity">
          {file.functions.map((fn) => (
            <button
              type="button"
              className="function-complexity-badge"
              key={`${fn.name}:${fn.line}`}
              title={`${fn.kind} · lines ${fn.line}–${fn.endLine}`}
              aria-label={`${fn.name}, complexity ${fn.complexity}, line ${fn.line}`}
              onClick={() => setFocusLine(fn.line)}
            >
              <span>{fn.name}</span><b>C{fn.complexity}</b>
            </button>
          ))}
        </div>
      )}
      {!selectedId && <p className="panel-placeholder">Select a file to view its code.</p>}
      {visibleState.status === 'loading' && <p className="panel-placeholder" role="status">Loading source…</p>}
      {visibleState.status === 'error' && (
        <div className="code-error" role="alert">
          <p>{visibleState.message}</p>
          <button type="button" onClick={() => setFileRetry((attempt) => attempt + 1)}>Retry source</button>
        </div>
      )}
      {file && (
        <div
          className="code-content"
          ref={codeViewportRef}
          role="region"
          tabIndex={0}
          aria-label={`Source code for ${selectedId}`}
        >
          <SyntaxHighlighter
            language={syntaxLanguage(file.language, selectedId ?? '')}
            style={vscDarkPlus}
            showLineNumbers
            showInlineLineNumbers={false}
            wrapLines
            lineProps={(lineNumber) => ({
              'data-line-number': lineNumber,
              className: flashedLine === lineNumber ? 'code-line--flash' : undefined,
              style: { display: 'block' },
            })}
            lineNumberContainerStyle={{
              position: 'sticky',
              left: 0,
              zIndex: 1,
              float: 'left',
              paddingRight: '10px',
              backgroundColor: '#0d1020',
            }}
            lineNumberStyle={{ color: '#7b849b' }}
            wrapLongLines={false}
            customStyle={{
              width: 'max-content',
              minWidth: '100%',
              margin: 0,
              padding: 0,
              overflow: 'visible',
              background: 'transparent',
              fontSize: 'inherit',
              lineHeight: 'inherit',
            }}
            codeTagProps={{ style: { whiteSpace: 'pre', font: 'inherit' } }}
          >
            {file.content}
          </SyntaxHighlighter>
        </div>
      )}
    </aside>
  );
}
