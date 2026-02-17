'use client';

import { useMemo, useState } from 'react';
import { getBundeslandLabel } from '@/lib/admin/types';
import type { GeocodeHistoryFile } from '@/lib/admin/types';

interface Props {
  files: GeocodeHistoryFile[];
  totalCount?: number;
}

type SortField = 'bundesland' | 'yearMonth' | 'articleCount' | 'geocodedCount' | 'geocodedRate' | 'sizeBytes' | 'createdAt';
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
  if (!ym) return '—';
  const [year, month] = ym.split('-');
  const d = new Date(Number(year), Number(month) - 1);
  return d.toLocaleDateString('de-DE', { month: 'short', year: 'numeric' });
}

function geocodedRate(file: GeocodeHistoryFile): number {
  if (file.articleCount === 0) return 0;
  return file.geocodedCount / file.articleCount;
}

function rateColor(rate: number): string {
  if (rate >= 0.9) return '#22c55e';
  if (rate >= 0.65) return '#eab308';
  return '#ef4444';
}

function getSortValue(file: GeocodeHistoryFile, field: SortField): string | number {
  switch (field) {
    case 'bundesland': return file.bundesland;
    case 'yearMonth': return file.yearMonth;
    case 'articleCount': return file.articleCount;
    case 'geocodedCount': return file.geocodedCount;
    case 'geocodedRate': return geocodedRate(file);
    case 'sizeBytes': return file.sizeBytes;
    case 'createdAt': return new Date(file.createdAt).getTime();
  }
}

const COLUMNS: { field: SortField; label: string; align: 'left' | 'right'; hideClass?: string }[] = [
  { field: 'bundesland', label: 'Land', align: 'left' },
  { field: 'yearMonth', label: 'Datei', align: 'left' },
  { field: 'articleCount', label: 'Artikel', align: 'right' },
  { field: 'geocodedCount', label: 'Geocoded', align: 'right' },
  { field: 'geocodedRate', label: 'Rate', align: 'right', hideClass: 'hidden md:table-cell' },
  { field: 'yearMonth', label: 'Zeitraum', align: 'left', hideClass: 'hidden sm:table-cell' },
  { field: 'sizeBytes', label: 'Größe', align: 'right' },
  { field: 'createdAt', label: 'Aktualisiert', align: 'right' },
];

export function GeocodeHistoryList({ files, totalCount }: Props) {
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
          Geocoded Dateien
        </label>
        <div
          className="rounded-xl border px-4 py-8 text-center text-sm"
          style={{
            borderColor: 'var(--border-subtle)',
            background: 'var(--card)',
            color: 'var(--text-faint)',
          }}
        >
          Keine geocodierten Dateien vorhanden.
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
        Geocoded Dateien ({totalCount != null && totalCount !== files.length ? `${files.length} of ${totalCount}` : files.length})
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
                  const arrow = isActive ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

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
                const rate = geocodedRate(f);
                return (
                  <tr
                    key={`${f.path}-${i}`}
                    className="transition-colors hover:bg-white/5"
                    style={{
                      borderBottom: i < sorted.length - 1 ? '1px solid var(--border-subtle)' : undefined,
                    }}
                  >
                    <td
                      className="px-3 py-1.5 text-[11px]"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {getBundeslandLabel(f.bundesland)}
                    </td>
                    <td
                      className="max-w-[220px] truncate px-3 py-1.5 font-mono"
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
                    <td className="px-3 py-1.5 text-right font-mono" style={{ color: 'var(--text-primary)' }}>
                      {f.articleCount.toLocaleString('de-DE')}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono" style={{ color: 'var(--text-primary)' }}>
                      {f.geocodedCount.toLocaleString('de-DE')}
                    </td>
                    <td
                      className="hidden px-3 py-1.5 text-right font-mono whitespace-nowrap md:table-cell"
                      style={{ color: rateColor(rate) }}
                    >
                      {(rate * 100).toFixed(1)}%
                    </td>
                    <td
                      className="hidden px-3 py-1.5 sm:table-cell"
                      style={{ color: 'var(--text-faint)' }}
                    >
                      {formatYearMonth(f.yearMonth)}
                    </td>
                    <td className="px-3 py-1.5 text-right" style={{ color: 'var(--text-faint)' }}>
                      {formatBytes(f.sizeBytes)}
                    </td>
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
