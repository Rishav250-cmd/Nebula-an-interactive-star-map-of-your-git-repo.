import { useEffect, useMemo, useState } from 'react';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import { fetchRepositoryFile, type FileResponse } from '../api/client';
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
  const adjacency = useMemo(() => buildAdjacency(graph), [graph]);
  const [fileState, setFileState] = useState<FileLoadState>({ key: null, status: 'idle' });
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
          message: fileError instanceof Error ? fileError.message : 'Could not load this file.',
        });
      });

    return () => controller.abort();
  }, [analysisId, requestKey, selectedId]);

  const visibleState = !requestKey
    ? { key: null, status: 'idle' } as const
    : fileState.key === requestKey
      ? fileState
      : { key: requestKey, status: 'loading' } as const;
  const file = visibleState.status === 'ready' ? visibleState.file : null;

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
      {!selectedId && <p className="panel-placeholder">Select a file to view its code.</p>}
      {visibleState.status === 'loading' && <p className="panel-placeholder" role="status">Loading source…</p>}
      {visibleState.status === 'error' && <p className="code-error" role="alert">{visibleState.message}</p>}
      {file && (
        <div
          className="code-content"
          role="region"
          tabIndex={0}
          aria-label={`Source code for ${selectedId}`}
        >
          <SyntaxHighlighter
            language={syntaxLanguage(file.language, selectedId ?? '')}
            style={vscDarkPlus}
            showLineNumbers
            showInlineLineNumbers={false}
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
