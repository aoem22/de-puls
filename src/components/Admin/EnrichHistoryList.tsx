'use client';

import { useMemo, useState } from 'react';
import { getBundeslandLabel } from '@/lib/admin/types';
import type { EnrichHistoryFile } from '@/lib/admin/types';

interface Props {
  files: EnrichHistoryFile[];
  totalCount?: number;
}

type SortField = 'bundesland' | 'yearMonth' | 'articleCount' | 'completeness' | 'sizeBytes' | 'createdAt';
type SortDir = 'asc' | 'desc';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function relativeTime(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'gerade eben';
  if (mins < 60) return `vor ${mins} Min.`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `vor ${days} Tag${days > 1 ? 'en' : ''}`;
  const months = Math.floor(days / 30);
  return `vor ${months} Monat${months > 1 ? 'en' : ''}`;
}

function formatYearMonth(ym: string): string {
  if (!ym) return '\u2014';
  const [year, month] = ym.split('-');
  const d = new Date(Number(year), Number(month) - 1);
  return d.toLocaleDateString('de-DE', { month: 'short', year: 'numeric' });
}

function completenessRatio(file: EnrichHistoryFile): number | null {
  if (file.rawArticleCount == null || file.rawArticleCount === 0) return null;
  return file.articleCount / file.rawArticleCount;
}

function completenessColor(ratio: number): string {
  if (ratio >= 0.95) return '#22c55e'; // green
  if (ratio >= 0.8) return '#eab308'; // yellow
  return '#ef4444'; // red
}

function renderCompleteness(file: EnrichHistoryFile): { text: string; color: string } {
  if (file.rawArticleCount == null || file.rawArticleCount === 0) {
    return { text: '\u2014', color: 'var(--text-faint)' };
  }
  const pct = (file.articleCount / file.rawArticleCount) * 100;
  return {
    text: `${file.rawArticleCount.toLocaleString('de-DE')} / ${pct.toFixed(1)}%`,
    color: completenessColor(file.articleCount / file.rawArticleCount),
  };
}

function getSortValue(file: EnrichHistoryFile, field: SortField): string | number {
  switch (field) {
    case 'bundesland': return file.bundesland;
    case 'yearMonth': return file.yearMonth;
    case 'articleCount': return file.articleCount;
    case 'completeness': return completenessRatio(file) ?? -1;
    case 'sizeBytes': return file.sizeBytes;
    case 'createdAt': return new Date(file.createdAt).getTime();
  }
}

const COLUMNS: { field: SortField; label: string; align: 'left' | 'right'; hideClass?: string }[] = [
  { field: 'bundesland', label: 'Land', align: 'left' },
  { field: 'yearMonth', label: 'Datei', align: 'left' },
  { field: 'articleCount', label: 'Artikel', align: 'right' },
  { field: 'completeness', label: 'Vollst.', align: 'right', hideClass: 'hidden md:table-cell' },
  { field: 'yearMonth', label: 'Zeitraum', align: 'left', hideClass: 'hidden sm:table-cell' },
  { field: 'sizeBytes', label: 'Gr\u00f6\u00dfe', align: 'right' },
  { field: 'createdAt', label: 'Erstellt', align: 'right' },
];

export function EnrichHistoryList({ files, totalCount }: Props) {
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const sorted = useMemo(() => {
    const copy = [...files];
    copy.sort((a, b) => {
      const va = getSortValue(a, sortField);
      const vb = getSortValue(b, sortField);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [files, sortField, sortDir]);

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  if (files.length === 0) {
    return (
      <div>
        <label
          className="mb-2 block text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--text-muted)' }}
        >
          Angereicherte Dateien
        </label>
        <div
          className="rounded-xl border px-4 py-8 text-center text-sm"
          style={{
            borderColor: 'var(--border-subtle)',
            background: 'var(--card)',
            color: 'var(--text-faint)',
          }}
        >
          Keine angereicherten Dateien vorhanden.
        </div>
      </div>
    );
  }

  return (
    <div>
      <label
        className="mb-2 block text-xs font-semibold uppercase tracking-wider"
        style={{ color: 'var(--text-muted)' }}
      >
        Angereicherte Dateien ({totalCount != null && totalCount !== files.length ? `${files.length} von ${totalCount}` : files.length})
      </label>
      <div
        className="overflow-hidden rounded-xl border"
        style={{
          borderColor: 'var(--border-subtle)',
          background: 'var(--card)',
        }}
      >
        <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
          <table className="w-full text-xs">
            <thead>
              <tr
                className="sticky top-0 text-left"
                style={{
                  background: 'var(--card)',
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                {COLUMNS.map((col, i) => {
                  const isActive = col.field === sortField;
                  const arrow = isActive ? (sortDir === 'asc' ? ' \u2191' : ' \u2193') : '';

                  return (
                    <th
                      key={`${col.label}-${i}`}
                      className={`px-3 py-2 font-semibold select-none ${col.hideClass ?? ''} ${
                        col.align === 'right' ? 'text-right' : ''
                      }`}
                      style={{
                        color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                        cursor: 'pointer',
                      }}
                      onClick={() => handleSort(col.field)}
                    >
                      {col.label}{arrow}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((f, i) => {
                const comp = renderCompleteness(f);
                return (
                  <tr
                    key={`${f.path}-${i}`}
                    className="transition-colors hover:bg-white/5"
                    style={{
                      borderBottom: i < sorted.length - 1 ? '1px solid var(--border-subtle)' : undefined,
                    }}
                  >
                    {/* Land */}
                    <td
                      className="px-3 py-1.5 text-[11px]"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {getBundeslandLabel(f.bundesland)}
                    </td>
                    {/* Datei — clickable link */}
                    <td
                      className="max-w-[200px] truncate px-3 py-1.5 font-mono"
                      title={f.path}
                    >
                      <a
                        href={`/api/admin/enrich/download?path=${encodeURIComponent(f.path)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                        style={{ color: 'var(--accent)' }}
                      >
                        {f.filename}
                      </a>
                    </td>
                    {/* Artikel */}
                    <td className="px-3 py-1.5 text-right font-mono" style={{ color: 'var(--text-primary)' }}>
                      {f.articleCount.toLocaleString('de-DE')}
                    </td>
                    {/* Vollst. */}
                    <td
                      className="hidden px-3 py-1.5 text-right font-mono whitespace-nowrap md:table-cell"
                      style={{ color: comp.color }}
                      title={
                        f.rawArticleCount != null
                          ? `${f.articleCount.toLocaleString('de-DE')} von ${f.rawArticleCount.toLocaleString('de-DE')} (Roh-Artikeln)`
                          : 'Kein Roh-Vergleich'
                      }
                    >
                      {comp.text}
                    </td>
                    {/* Zeitraum */}
                    <td
                      className="hidden px-3 py-1.5 sm:table-cell"
                      style={{ color: 'var(--text-faint)' }}
                    >
                      {formatYearMonth(f.yearMonth)}
                    </td>
                    {/* Größe */}
                    <td className="px-3 py-1.5 text-right" style={{ color: 'var(--text-faint)' }}>
                      {formatBytes(f.sizeBytes)}
                    </td>
                    {/* Erstellt */}
                    <td
                      className="px-3 py-1.5 text-right whitespace-nowrap"
                      style={{ color: 'var(--text-faint)' }}
                      title={new Date(f.createdAt).toLocaleString('de-DE')}
                    >
                      {relativeTime(f.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
