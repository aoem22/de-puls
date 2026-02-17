'use client';

import { useRef, useEffect } from 'react';

export interface EnrichLogLine {
  fileIndex?: number;
  text: string;
  isError?: boolean;
  isDone?: boolean;
  isFileHeader?: boolean;
}

interface EnrichLogViewerProps {
  logs: EnrichLogLine[];
  isRunning: boolean;
  fileCount: number;
  currentFileIndex: number;
  currentFileName: string;
  onAbort: () => void;
  onClear: () => void;
}

export function EnrichLogViewer({
  logs,
  isRunning,
  fileCount,
  currentFileIndex,
  currentFileName,
  onAbort,
  onClear,
}: EnrichLogViewerProps) {
  const logRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  useEffect(() => {
    if (autoScrollRef.current && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  function handleScroll() {
    if (!logRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logRef.current;
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 50;
  }

  if (logs.length === 0) return null;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Logs
          {isRunning && fileCount > 0 && (
            <span className="ml-2 font-normal normal-case" style={{ color: '#0ea5e9' }}>
              — File {currentFileIndex + 1}/{fileCount} | {currentFileName}
            </span>
          )}
          {!isRunning && logs.length > 0 && logs.some((l) => l.isDone) && (
            <span className="ml-2 font-normal normal-case" style={{ color: '#22c55e' }}>
              — Enrichment complete
            </span>
          )}
        </label>
        <div className="flex gap-2">
          {isRunning && (
            <button
              onClick={onAbort}
              className="rounded-lg border px-3 py-1 text-xs font-medium transition-colors"
              style={{ borderColor: '#ef4444', color: '#ef4444' }}
            >
              Abort
            </button>
          )}
          {!isRunning && logs.length > 0 && (
            <button
              onClick={onClear}
              className="text-xs font-medium"
              style={{ color: 'var(--text-faint)' }}
            >
              Clear logs
            </button>
          )}
        </div>
      </div>

      <div
        ref={logRef}
        onScroll={handleScroll}
        className="h-80 overflow-y-auto rounded-xl border font-mono text-xs leading-relaxed custom-scrollbar"
        style={{
          borderColor: 'var(--border-subtle)',
          background: '#0a0a0a',
          color: '#ccc',
        }}
      >
        <div className="p-3 space-y-0.5">
          {logs.map((line, i) => (
            <div
              key={i}
              className="flex gap-2 rounded px-1 py-0.5 hover:bg-white/5"
            >
              {line.isFileHeader && (
                <span className="w-full font-semibold" style={{ color: '#0ea5e9' }}>
                  {line.text}
                </span>
              )}
              {!line.isFileHeader && (
                <span
                  className="flex-1 break-all"
                  style={{
                    color: line.isError
                      ? '#ef4444'
                      : line.isDone
                        ? '#22c55e'
                        : '#ccc',
                  }}
                >
                  {line.text}
                </span>
              )}
            </div>
          ))}
          {isRunning && (
            <div className="flex items-center gap-2 px-1 py-0.5">
              <span className="animate-pulse" style={{ color: '#0ea5e9' }}>●</span>
              <span style={{ color: 'var(--text-faint)' }}>Processing...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
