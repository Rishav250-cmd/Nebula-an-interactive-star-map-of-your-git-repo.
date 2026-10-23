import { useEffect, useState } from 'react';
import { fetchRepositoryFile, type FileResponse } from '../api/client';
import { useGraphStore } from '../store/useGraphStore';

type FileLoadState =
  | { key: null; status: 'idle' }
  | { key: string; status: 'loading' }
  | { key: string; status: 'ready'; file: FileResponse }
  | { key: string; status: 'error'; message: string };

export function RightPanel() {
  const analysisId = useGraphStore((state) => state.analysisId);
  const selectedId = useGraphStore((state) => state.selectedId);
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
      {selectedId && <p className="code-file-path" title={selectedId}>{selectedId}</p>}
      {file && <p className="code-loc">{file.loc.toLocaleString()} lines</p>}
      {!selectedId && <p className="panel-placeholder">Select a file to view its code.</p>}
      {visibleState.status === 'loading' && <p className="panel-placeholder" role="status">Loading source…</p>}
      {visibleState.status === 'error' && <p className="code-error" role="alert">{visibleState.message}</p>}
      {file && (
        <pre
          className="code-content"
          role="region"
          tabIndex={0}
          aria-label={`Source code for ${selectedId}`}
        >
          <code>{file.content}</code>
        </pre>
      )}
    </aside>
  );
}
