'use client';

import { useMemo, useState } from 'react';
import { getBundeslandLabel } from '@/lib/admin/types';
import type { ScrapeMonthRow } from '@/lib/admin/types';

interface Props {
  rows: ScrapeMonthRow[];
  totalCount?: number;
}

type SortField = 'bundesland' | 'yearMonth' | 'articleCount' | 'completeness' | 'sizeBytes' | 'modifiedAt';
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
  // "2024-01" → "Jan 2024"
  const [year, month] = ym.split('-');
  const d = new Date(Number(year), Number(month) - 1);
  return d.toLocaleDateString('de-DE', { month: 'short', year: 'numeric' });
}

function completenessRatio(row: ScrapeMonthRow): number | null {
  if (row.presseportalCount == null || row.presseportalCount === 0) return null;
  return row.articleCount / row.presseportalCount;
}

function completenessColor(ratio: number): string {
  if (ratio >= 0.95) return '#22c55e'; // green
  if (ratio >= 0.8) return '#eab308'; // yellow
  return '#ef4444'; // red
}

function renderCompleteness(row: ScrapeMonthRow): { text: string; color: string } {
  if (row.presseportalCount == null) {
    return { text: '—', color: 'var(--text-faint)' };
  }
  if (row.presseportalCount === 0) {
    return { text: '—', color: 'var(--text-faint)' };
  }
  const pct = (row.articleCount / row.presseportalCount) * 100;
  return {
    text: `${row.presseportalCount.toLocaleString('de-DE')} / ${pct.toFixed(1)}%`,
    color: completenessColor(row.articleCount / row.presseportalCount),
  };
}

function getSortValue(row: ScrapeMonthRow, field: SortField): string | number {
  switch (field) {
    case 'bundesland': return row.bundesland;
    case 'yearMonth': return row.yearMonth;
    case 'articleCount': return row.articleCount;
    case 'completeness': return completenessRatio(row) ?? -1;
    case 'sizeBytes': return row.sizeBytes;
    case 'modifiedAt': return new Date(row.modifiedAt).getTime();
  }
}

const COLUMNS: { field: SortField; label: string; align: 'left' | 'right'; hideClass?: string }[] = [
  { field: 'bundesland', label: 'Land', align: 'left' },
  { field: 'yearMonth', label: 'Datei', align: 'left' },
  { field: 'articleCount', label: 'Artikel', align: 'right' },
  { field: 'completeness', label: 'Vollst.', align: 'right', hideClass: 'hidden md:table-cell' },
  { field: 'yearMonth', label: 'Zeitraum', align: 'left', hideClass: 'hidden sm:table-cell' },
  { field: 'sizeBytes', label: 'Größe', align: 'right' },
  { field: 'modifiedAt', label: 'Erstellt', align: 'right' },
];

export function ScrapeHistoryList({ rows, totalCount }: Props) {
  const [sortField, setSortField] = useState<SortField>('modifiedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const va = getSortValue(a, sortField);
      const vb = getSortValue(b, sortField);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortField, sortDir]);

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  if (rows.length === 0) {
    return (
      <div>
        <label
          className="mb-2 block text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--text-muted)' }}
        >
          Scrape-Dateien
        </label>
        <div
          className="rounded-xl border px-4 py-8 text-center text-sm"
          style={{
            borderColor: 'var(--border-subtle)',
            background: 'var(--card)',
            color: 'var(--text-faint)',
          }}
        >
          Keine Scrapes vorhanden — nutze die Steuerung oben, um zu starten.
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
        Scrape-Dateien ({totalCount != null && totalCount !== rows.length ? `${rows.length} von ${totalCount}` : rows.length})
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
              {sorted.map((row, i) => {
                const comp = renderCompleteness(row);
                return (
                  <tr
                    key={`${row.filePath}-${i}`}
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
                      {getBundeslandLabel(row.bundesland)}
                    </td>
                    {/* Datei — clickable link */}
                    <td
                      className="max-w-[200px] truncate px-3 py-1.5 font-mono"
                      title={row.filePath}
                    >
                      <a
                        href={`/api/admin/scrape/download?path=${encodeURIComponent(row.filePath)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                        style={{ color: 'var(--accent)' }}
                      >
                        {row.filename}
                      </a>
                    </td>
                    {/* Artikel */}
                    <td className="px-3 py-1.5 text-right font-mono" style={{ color: 'var(--text-primary)' }}>
                      {row.articleCount.toLocaleString('de-DE')}
                    </td>
                    {/* Vollst. */}
                    <td
                      className="hidden px-3 py-1.5 text-right font-mono whitespace-nowrap md:table-cell"
                      style={{ color: comp.color }}
                      title={
                        row.presseportalCount != null
                          ? `${row.articleCount.toLocaleString('de-DE')} von ${row.presseportalCount.toLocaleString('de-DE')} (Presseportal)`
                          : 'Kein Presseportal-Vergleich'
                      }
                    >
                      {comp.text}
                    </td>
                    {/* Zeitraum */}
                    <td
                      className="hidden px-3 py-1.5 sm:table-cell"
                      style={{ color: 'var(--text-faint)' }}
                    >
                      {formatYearMonth(row.yearMonth)}
                    </td>
                    {/* Größe */}
                    <td className="px-3 py-1.5 text-right" style={{ color: 'var(--text-faint)' }}>
                      {formatBytes(row.sizeBytes)}
                    </td>
                    {/* Erstellt */}
                    <td
                      className="px-3 py-1.5 text-right whitespace-nowrap"
                      style={{ color: 'var(--text-faint)' }}
                      title={new Date(row.modifiedAt).toLocaleString('de-DE')}
                    >
                      {relativeTime(row.modifiedAt)}
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
