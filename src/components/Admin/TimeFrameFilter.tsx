'use client';

import type { EnrichFile } from '@/lib/admin/types';

interface TimeFrameFilterProps {
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  selectedFiles: EnrichFile[];
  disabled?: boolean;
}

export function TimeFrameFilter({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  selectedFiles,
  disabled,
}: TimeFrameFilterProps) {
  // Compute article count within date range
  const totalArticles = selectedFiles.reduce((s, f) => s + f.articleCount, 0);

  // Auto-detect range from selected files
  let minDate: string | null = null;
  let maxDate: string | null = null;
  for (const f of selectedFiles) {
    if (f.dateRange.earliest && (!minDate || f.dateRange.earliest < minDate)) minDate = f.dateRange.earliest;
    if (f.dateRange.latest && (!maxDate || f.dateRange.latest > maxDate)) maxDate = f.dateRange.latest;
  }

  function autoFill() {
    if (minDate) onDateFromChange(minDate);
    if (maxDate) onDateToChange(maxDate);
  }

  function clearDates() {
    onDateFromChange('');
    onDateToChange('');
  }

  const hasFilter = dateFrom || dateTo;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Date Filter
          {!hasFilter && (
            <span className="ml-2 font-normal normal-case" style={{ color: 'var(--text-faint)' }}>
              (optional)
            </span>
          )}
        </label>
        <div className="flex gap-2">
          {minDate && (
            <button
              onClick={autoFill}
              disabled={disabled}
              className="text-xs font-medium"
              style={{ color: 'var(--accent)' }}
            >
              Auto-fill
            </button>
          )}
          {hasFilter && (
            <button
              onClick={clearDates}
              disabled={disabled}
              className="text-xs font-medium"
              style={{ color: 'var(--text-faint)' }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => onDateFromChange(e.target.value)}
          disabled={disabled}
          className="rounded-lg border px-3 py-1.5 text-xs font-medium"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--card)',
            color: 'var(--text-primary)',
            colorScheme: 'dark',
          }}
        />
        <span className="text-xs" style={{ color: 'var(--text-faint)' }}>to</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => onDateToChange(e.target.value)}
          disabled={disabled}
          className="rounded-lg border px-3 py-1.5 text-xs font-medium"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--card)',
            color: 'var(--text-primary)',
            colorScheme: 'dark',
          }}
        />
        <span className="text-xs tabular-nums" style={{ color: 'var(--text-faint)' }}>
          {totalArticles.toLocaleString()} articles total
        </span>
      </div>
    </div>
  );
}
