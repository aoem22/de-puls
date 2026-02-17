'use client';

import { BUNDESLAENDER, getBundeslandLabel } from '@/lib/admin/types';
import { GERMAN_MONTHS } from '@/lib/admin/chunk-utils';
import { CRIME_CATEGORIES } from '@/lib/types/crime';

interface ComparisonToolbarProps {
  yearMonth: string;
  bundesland: string;
  onYearMonthChange: (ym: string) => void;
  onBundeslandChange: (bl: string) => void;
  category: string;
  subType: string;
  search: string;
  onCategoryChange: (cat: string) => void;
  onSubTypeChange: (st: string) => void;
  onSearchChange: (q: string) => void;
  availableSubTypes?: string[];
  currentIndex: number;
  total: number;
  onJump: (index: number) => void;
  onPrev: () => void;
  onNext: () => void;
  availableMonths?: string[];
  dataSource?: string;
}

/** Format "2026-02" → "2026 Februar" */
function formatYearMonth(ym: string): string {
  const [year, month] = ym.split('-');
  const name = GERMAN_MONTHS[month];
  if (!name) return ym;
  return `${year} ${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

export function ComparisonToolbar({
  yearMonth, bundesland, onYearMonthChange, onBundeslandChange,
  category, subType, search,
  onCategoryChange, onSubTypeChange, onSearchChange,
  availableSubTypes,
  currentIndex, total, onJump, onPrev, onNext,
  availableMonths, dataSource,
}: ComparisonToolbarProps) {
  const months = availableMonths ?? [];
  const subTypes = availableSubTypes ?? [];
  const hasArticles = total > 0;
  const displayIndex = hasArticles ? currentIndex + 1 : 0;
  const hasActiveFilters = !!(category || subType || search);

  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3"
      style={{
        borderColor: 'var(--border-subtle)',
        background: 'var(--card)',
      }}
    >
      {/* Month selector */}
      <select
        value={yearMonth}
        onChange={e => onYearMonthChange(e.target.value)}
        className="rounded-lg border px-2 py-1.5 text-sm"
        style={{
          borderColor: 'var(--border)',
          background: 'var(--card-inner)',
          color: 'var(--text-primary)',
        }}
      >
        {months.map(ym => (
          <option key={ym} value={ym}>{formatYearMonth(ym)}</option>
        ))}
      </select>

      {/* Bundesland selector */}
      <select
        value={bundesland}
        onChange={e => onBundeslandChange(e.target.value)}
        className="rounded-lg border px-2 py-1.5 text-sm"
        style={{
          borderColor: 'var(--border)',
          background: 'var(--card-inner)',
          color: 'var(--text-primary)',
        }}
      >
        <option value="">All Bundeslaender</option>
        {BUNDESLAENDER.map(bl => (
          <option key={bl} value={bl}>{getBundeslandLabel(bl)}</option>
        ))}
      </select>

      {/* Data source badge */}
      {dataSource && (
        <span
          className="rounded-md px-2 py-0.5 text-xs font-medium"
          style={{
            background: dataSource === 'database' ? 'rgba(59,130,246,0.15)' : 'rgba(34,197,94,0.15)',
            color: dataSource === 'database' ? '#3b82f6' : '#22c55e',
          }}
        >
          {dataSource === 'database' ? 'DB' : 'Files'}
        </span>
      )}

      {/* Separator */}
      <div className="mx-1 h-6 w-px" style={{ background: 'var(--border)' }} />

      {/* Category filter */}
      <select
        value={category}
        onChange={e => onCategoryChange(e.target.value)}
        className="rounded-lg border px-2 py-1.5 text-sm"
        style={{
          borderColor: category ? '#f59e0b' : 'var(--border)',
          background: 'var(--card-inner)',
          color: 'var(--text-primary)',
          maxWidth: 180,
        }}
      >
        <option value="">Alle Kategorien</option>
        {CRIME_CATEGORIES.map(c => (
          <option key={c.key} value={c.key}>{c.label}</option>
        ))}
      </select>

      {/* Sub type filter */}
      <select
        value={subType}
        onChange={e => onSubTypeChange(e.target.value)}
        className="rounded-lg border px-2 py-1.5 text-sm"
        style={{
          borderColor: subType ? '#f59e0b' : 'var(--border)',
          background: 'var(--card-inner)',
          color: 'var(--text-primary)',
          maxWidth: 180,
        }}
      >
        <option value="">Alle Sub-Types</option>
        {subTypes.map(s => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      {/* Keyword search */}
      <div className="relative">
        <input
          type="text"
          placeholder="Suche..."
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          className="rounded-lg border px-2 py-1.5 pl-7 text-sm"
          style={{
            borderColor: search ? '#f59e0b' : 'var(--border)',
            background: 'var(--card-inner)',
            color: 'var(--text-primary)',
            width: 160,
          }}
        />
        <svg
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2"
          width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          style={{ color: 'var(--text-faint)' }}
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </div>

      {/* Clear filters */}
      {hasActiveFilters && (
        <button
          onClick={() => { onCategoryChange(''); onSubTypeChange(''); onSearchChange(''); }}
          className="rounded-lg border px-2 py-1 text-xs font-medium"
          style={{
            borderColor: '#f59e0b',
            color: '#f59e0b',
            background: 'rgba(245,158,11,0.08)',
          }}
          title="Filter zurücksetzen"
        >
          ✕ Filter
        </button>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Navigation */}
      <div className="flex items-center gap-2">
        <button
          onClick={onPrev}
          disabled={!hasArticles || currentIndex <= 0}
          className="glass-button rounded-lg border px-2.5 py-1 text-sm font-medium disabled:opacity-30"
        >
          ←
        </button>

        <div className="flex items-center gap-1">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Article</span>
          <input
            type="number"
            min={hasArticles ? 1 : 0}
            max={hasArticles ? total : 0}
            value={displayIndex}
            onChange={e => {
              if (!hasArticles) return;
              const val = parseInt(e.target.value);
              if (val >= 1 && val <= total) onJump(val - 1);
            }}
            className="w-14 rounded-md border px-2 py-1 text-center text-sm tabular-nums"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--card-inner)',
              color: 'var(--text-primary)',
            }}
          />
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>of {total}</span>
        </div>

        <button
          onClick={onNext}
          disabled={!hasArticles || currentIndex >= total - 1}
          className="glass-button rounded-lg border px-2.5 py-1 text-sm font-medium disabled:opacity-30"
        >
          →
        </button>
      </div>
    </div>
  );
}
