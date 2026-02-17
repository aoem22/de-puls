'use client';

import { useState, useMemo } from 'react';
import { useEnrichFiles } from '@/lib/admin/hooks';
import { getBundeslandLabel } from '@/lib/admin/types';
import type { EnrichFile } from '@/lib/admin/types';

interface FileSelectorProps {
  selected: EnrichFile[];
  onChange: (files: EnrichFile[]) => void;
  disabled?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileSelector({ selected, onChange, disabled }: FileSelectorProps) {
  const { data: files, isLoading, error } = useEnrichFiles();
  const [expandedStates, setExpandedStates] = useState<Set<string>>(new Set());

  const selectedPaths = useMemo(() => new Set(selected.map((f) => f.path)), [selected]);

  const grouped = useMemo(() => {
    if (!files) return new Map<string, EnrichFile[]>();
    const map = new Map<string, EnrichFile[]>();
    for (const f of files) {
      const list = map.get(f.bundesland) || [];
      list.push(f);
      map.set(f.bundesland, list);
    }
    return map;
  }, [files]);

  const allBundeslaender = useMemo(() => Array.from(grouped.keys()).sort(), [grouped]);

  function toggleExpand(bl: string) {
    setExpandedStates((prev) => {
      const next = new Set(prev);
      if (next.has(bl)) next.delete(bl);
      else next.add(bl);
      return next;
    });
  }

  function toggleFile(file: EnrichFile) {
    if (selectedPaths.has(file.path)) {
      onChange(selected.filter((f) => f.path !== file.path));
    } else {
      onChange([...selected, file]);
    }
  }

  function toggleState(bl: string) {
    const stateFiles = grouped.get(bl) || [];
    const allSelected = stateFiles.every((f) => selectedPaths.has(f.path));
    if (allSelected) {
      const statePaths = new Set(stateFiles.map((f) => f.path));
      onChange(selected.filter((f) => !statePaths.has(f.path)));
    } else {
      const existing = new Set(selected.map((f) => f.path));
      const toAdd = stateFiles.filter((f) => !existing.has(f.path));
      onChange([...selected, ...toAdd]);
    }
  }

  function selectAll() {
    if (!files) return;
    onChange([...files]);
  }

  function deselectAll() {
    onChange([]);
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-10 animate-pulse rounded-lg"
            style={{ background: 'var(--border-subtle)' }}
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border p-4 text-sm" style={{ borderColor: '#ef4444', color: '#ef4444' }}>
        Failed to load files: {error.message}
      </div>
    );
  }

  if (!files || files.length === 0) {
    return (
      <div className="rounded-lg border p-4 text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
        No raw files found in data/pipeline/
      </div>
    );
  }

  const totalArticles = selected.reduce((sum, f) => sum + f.articleCount, 0);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Files ({selected.length} selected, {totalArticles.toLocaleString()} articles)
        </label>
        <div className="flex gap-2">
          <button
            onClick={selectAll}
            disabled={disabled}
            className="text-xs font-medium"
            style={{ color: 'var(--accent)' }}
          >
            Select all
          </button>
          <button
            onClick={deselectAll}
            disabled={disabled}
            className="text-xs font-medium"
            style={{ color: 'var(--text-faint)' }}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="space-y-1 max-h-[420px] overflow-y-auto custom-scrollbar rounded-xl border p-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--card)' }}>
        {allBundeslaender.map((bl) => {
          const stateFiles = grouped.get(bl) || [];
          const expanded = expandedStates.has(bl);
          const stateArticles = stateFiles.reduce((s, f) => s + f.articleCount, 0);
          const allChecked = stateFiles.every((f) => selectedPaths.has(f.path));
          const someChecked = stateFiles.some((f) => selectedPaths.has(f.path));

          return (
            <div key={bl}>
              <button
                onClick={() => toggleExpand(bl)}
                disabled={disabled}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium transition-colors hover:bg-white/5"
                style={{ color: 'var(--text-primary)' }}
              >
                <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                  {expanded ? '▾' : '▸'}
                </span>
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked; }}
                  onChange={(e) => { e.stopPropagation(); toggleState(bl); }}
                  disabled={disabled}
                  className="accent-[var(--accent)]"
                  onClick={(e) => e.stopPropagation()}
                />
                <span className="flex-1">{getBundeslandLabel(bl)}</span>
                <span className="text-xs font-normal tabular-nums" style={{ color: 'var(--text-faint)' }}>
                  {stateFiles.length} file{stateFiles.length !== 1 ? 's' : ''} · {stateArticles.toLocaleString()} art.
                </span>
              </button>

              {expanded && (
                <div className="ml-8 space-y-0.5 pb-1">
                  {stateFiles.map((file) => (
                    <label
                      key={file.path}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors hover:bg-white/5"
                      style={{
                        color: selectedPaths.has(file.path) ? 'var(--text-primary)' : 'var(--text-secondary)',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedPaths.has(file.path)}
                        onChange={() => toggleFile(file)}
                        disabled={disabled}
                        className="accent-[var(--accent)]"
                      />
                      <span className="flex-1 truncate font-mono">{file.filename}</span>
                      <span className="tabular-nums" style={{ color: 'var(--text-faint)' }}>
                        {file.articleCount.toLocaleString()} art.
                      </span>
                      <span className="tabular-nums" style={{ color: 'var(--text-faint)' }}>
                        {formatBytes(file.sizeBytes)}
                      </span>
                      {file.dateRange.earliest && (
                        <span className="tabular-nums" style={{ color: 'var(--text-faint)' }}>
                          {file.dateRange.earliest.slice(5)}–{file.dateRange.latest?.slice(5)}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
