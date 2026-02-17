'use client';

import { useRef, useEffect, useCallback, useMemo } from 'react';
import { BUNDESLAENDER, getBundeslandLabel } from '@/lib/admin/types';
import { useScrapeHistory, usePersistedState } from '@/lib/admin/hooks';
import {
  PERIODS,
  type Period,
  computeRange,
  currentMonthISO,
  currentYearValue,
  formatRange,
  todayISO,
} from '@/lib/admin/date-range';
import { useScrapeProcess } from './AdminProcessContext';
import { ScrapeHeatmap } from './ScrapeHeatmap';
import { ScrapeHistoryList } from './ScrapeHistoryList';

/** States with dedicated scrapers (not presseportal) */
const DEDICATED_STATES = new Set([
  'berlin',
  'brandenburg',
  'bayern',
  'sachsen-anhalt',
  'sachsen',
]);

const STATE_COLORS: Record<string, string> = {
  'baden-wuerttemberg': '#3b82f6',
  bayern: '#f59e0b',
  berlin: '#ef4444',
  brandenburg: '#dc2626',
  bremen: '#22c55e',
  hamburg: '#0891b2',
  hessen: '#a855f7',
  'mecklenburg-vorpommern': '#ec4899',
  niedersachsen: '#14b8a6',
  'nordrhein-westfalen': '#f97316',
  'rheinland-pfalz': '#6366f1',
  saarland: '#84cc16',
  sachsen: '#e879f9',
  'sachsen-anhalt': '#fb923c',
  'schleswig-holstein': '#38bdf8',
  thueringen: '#a78bfa',
};

export function ScrapePanel() {
  const [period, setPeriod] = usePersistedState<Period>('scrape.period', 'week');
  const [dateVal, setDateVal] = usePersistedState('scrape.dateVal', todayISO());
  const [monthVal, setMonthVal] = usePersistedState('scrape.monthVal', currentMonthISO());
  const [yearVal, setYearVal] = usePersistedState('scrape.yearVal', currentYearValue());
  const [selectedArr, setSelectedArr] = usePersistedState<string[]>(
    'scrape.selected', [...BUNDESLAENDER]
  );
  const selected = useMemo(() => new Set(selectedArr), [selectedArr]);
  const setSelected = useCallback(
    (v: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      setSelectedArr((prev) => {
        const prevSet = new Set(prev);
        const next = typeof v === 'function' ? v(prevSet) : v;
        return [...next];
      });
    },
    [setSelectedArr]
  );

  // Process state from context (survives navigation)
  const { isRunning, logs, doneStates, allDone, start, stop, clearLogs } = useScrapeProcess();

  const logRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const { data: history, mutate: mutateHistory } = useScrapeHistory();

  // Heatmap filter state (lifted from ScrapeHeatmap so we can filter the history list)
  const [heatmapYear, setHeatmapYear] = usePersistedState('scrape.heatmap.year', new Date().getFullYear());
  const [heatmapBl, setHeatmapBl] = usePersistedState<string | null>('scrape.heatmap.bl', null);

  // Auto-sync year to most recent year with data if the current selection has none
  const yearSyncedRef = useRef(false);
  useEffect(() => {
    if (yearSyncedRef.current || !history?.rows.length) return;
    const rowYears = new Set(history.rows.map((r) => parseInt(r.yearMonth.slice(0, 4), 10)));
    if (!rowYears.has(heatmapYear)) {
      const sorted = Array.from(rowYears).sort((a, b) => b - a);
      if (sorted.length > 0) setHeatmapYear(sorted[0]);
    }
    yearSyncedRef.current = true;
  }, [history?.rows, heatmapYear, setHeatmapYear]);

  const allSelected = BUNDESLAENDER.every((s) => selected.has(s));

  const dateRange = useMemo(
    () => computeRange(period, dateVal, monthVal, yearVal),
    [period, dateVal, monthVal, yearVal]
  );

  // Filter history rows by heatmap selections
  const filteredRows = useMemo(() => {
    let rows = history?.rows ?? [];
    if (heatmapBl !== null) {
      rows = rows.filter((r) => r.bundesland === heatmapBl);
    }
    const prefix = String(heatmapYear);
    rows = rows.filter((r) => r.yearMonth.startsWith(prefix));
    return rows;
  }, [history?.rows, heatmapBl, heatmapYear]);

  // Auto-scroll log viewer
  useEffect(() => {
    if (autoScrollRef.current && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  // Revalidate history periodically while scraping, and once when done
  useEffect(() => {
    if (allDone) {
      mutateHistory();
      return;
    }
    if (!isRunning) return;

    // Poll every 10s while scraping so heatmap numbers update live
    const interval = setInterval(() => mutateHistory(), 10_000);
    return () => clearInterval(interval);
  }, [isRunning, allDone, mutateHistory]);

  function handleLogScroll() {
    if (!logRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logRef.current;
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 50;
  }

  function toggleState(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(BUNDESLAENDER));
    }
  }

  function handleStart() {
    if (selected.size === 0 || isRunning) return;
    autoScrollRef.current = true;
    start({
      bundeslaender: Array.from(selected),
      startDate: dateRange.start,
      endDate: dateRange.end,
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1
          className="text-xl font-bold"
          style={{ color: 'var(--text-primary)' }}
        >
          Scraper
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          Trigger scrapes for selected states and time period. Presseportal and
          dedicated scrapers are dispatched automatically.
        </p>
      </div>

      {/* Period selector */}
      <div>
        <label
          className="mb-2 block text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--text-muted)' }}
        >
          Zeitraum
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                disabled={isRunning}
                className="rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
                style={{
                  borderColor:
                    period === p.key ? 'var(--accent)' : 'var(--border)',
                  background:
                    period === p.key ? 'var(--accent)' : 'var(--card)',
                  color: period === p.key ? '#fff' : 'var(--text-secondary)',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {period === 'day' && (
            <input
              type="date"
              value={dateVal}
              onChange={(e) => setDateVal(e.target.value)}
              disabled={isRunning}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--card)',
                color: 'var(--text-primary)',
                colorScheme: 'dark',
              }}
            />
          )}
          {period === 'week' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={dateVal}
                onChange={(e) => setDateVal(e.target.value)}
                disabled={isRunning}
                className="rounded-lg border px-3 py-1.5 text-xs font-medium"
                style={{
                  borderColor: 'var(--border)',
                  background: 'var(--card)',
                  color: 'var(--text-primary)',
                  colorScheme: 'dark',
                }}
              />
              <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                Mo {dateRange.start} — So {dateRange.end}
              </span>
            </div>
          )}
          {period === 'month' && (
            <input
              type="month"
              value={monthVal}
              onChange={(e) => setMonthVal(e.target.value)}
              disabled={isRunning}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--card)',
                color: 'var(--text-primary)',
                colorScheme: 'dark',
              }}
            />
          )}
          {period === 'year' && (
            <select
              value={yearVal}
              onChange={(e) => setYearVal(Number(e.target.value))}
              disabled={isRunning}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--card)',
                color: 'var(--text-primary)',
                colorScheme: 'dark',
              }}
            >
              {Array.from({ length: currentYearValue() - 2000 + 1 }, (_, i) => currentYearValue() - i).map(
                (y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                )
              )}
            </select>
          )}

          <span
            className="text-xs font-mono"
            style={{ color: 'var(--text-muted)' }}
          >
            {formatRange(dateRange.start, dateRange.end, period)}
          </span>
        </div>
      </div>

      {/* Bundesland grid */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-muted)' }}
          >
            Bundesländer
          </label>
          <button
            onClick={toggleAll}
            disabled={isRunning}
            className="text-xs font-medium"
            style={{ color: 'var(--accent)' }}
          >
            {allSelected ? 'Keine auswählen' : 'Alle auswählen'}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {BUNDESLAENDER.map((slug) => {
            const isDedicated = DEDICATED_STATES.has(slug);
            const isSelected = selected.has(slug);
            const isDone = doneStates.has(slug);

            return (
              <button
                key={slug}
                onClick={() => toggleState(slug)}
                disabled={isRunning}
                title={
                  isDedicated
                    ? 'Eigener Scraper (nicht Presseportal)'
                    : undefined
                }
                className="relative rounded-xl border px-3 py-2 text-left text-sm font-medium transition-all"
                style={{
                  borderColor: isSelected
                    ? 'var(--accent)'
                    : 'var(--border)',
                  background: isSelected
                    ? 'color-mix(in srgb, var(--accent) 12%, transparent)'
                    : 'var(--card)',
                  color: isSelected
                    ? 'var(--accent)'
                    : 'var(--text-secondary)',
                  cursor: isRunning ? 'not-allowed' : 'pointer',
                  boxShadow: isSelected
                    ? '0 0 0 1px var(--accent)'
                    : undefined,
                }}
              >
                <span className="mr-1.5 inline-block w-4 text-center">
                  {isDone
                    ? '✔'
                    : isSelected
                      ? '✓'
                      : '○'}
                </span>
                {getBundeslandLabel(slug)}
                {isDedicated && (
                  <span
                    className="ml-1.5 inline-block rounded px-1 py-0.5 text-[9px] font-bold uppercase leading-none"
                    style={{
                      background: 'var(--border-subtle)',
                      color: 'var(--text-faint)',
                    }}
                  >
                    eigen
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <p
          className="mt-2 text-[11px]"
          style={{ color: 'var(--text-faint)' }}
        >
          eigen = eigener Scraper (nicht Presseportal)
        </p>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={handleStart}
          disabled={selected.size === 0 || isRunning}
          className="rounded-xl border px-5 py-2.5 text-sm font-semibold transition-all"
          style={{
            borderColor: 'var(--accent)',
            background:
              selected.size === 0 || isRunning
                ? 'var(--card)'
                : 'var(--accent)',
            color:
              selected.size === 0 || isRunning
                ? 'var(--text-faint)'
                : '#fff',
            cursor:
              selected.size === 0 || isRunning ? 'not-allowed' : 'pointer',
          }}
        >
          {isRunning
            ? `⏳ Läuft... (${doneStates.size}/${selected.size})`
            : `⚡ Scrape starten (${selected.size} Länder)`}
        </button>

        {isRunning && (
          <button
            onClick={stop}
            className="rounded-xl border px-4 py-2.5 text-sm font-medium transition-all"
            style={{
              borderColor: '#ef4444',
              background: 'transparent',
              color: '#ef4444',
              cursor: 'pointer',
            }}
          >
            ■ Abbrechen
          </button>
        )}
      </div>

      {/* Log viewer */}
      {logs.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--text-muted)' }}
            >
              Logs
              {allDone && (
                <span className="ml-2 font-normal normal-case" style={{ color: '#22c55e' }}>
                  — Alle Scraper fertig
                </span>
              )}
            </label>
            {!isRunning && logs.length > 0 && (
              <button
                onClick={clearLogs}
                className="text-xs font-medium"
                style={{ color: 'var(--text-faint)' }}
              >
                Logs löschen
              </button>
            )}
          </div>
          <div
            ref={logRef}
            onScroll={handleLogScroll}
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
                  {line.state && (
                    <span
                      className="w-24 shrink-0 truncate text-right"
                      style={{
                        color: STATE_COLORS[line.state] || '#888',
                      }}
                    >
                      [{line.state ? getBundeslandLabel(line.state).slice(0, 10) : ''}]
                    </span>
                  )}
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
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Scrape coverage heatmap */}
      {history && (
        <ScrapeHeatmap
          byDay={history.byDay}
          byBundesland={history.byBundesland}
          selectedYear={heatmapYear}
          onYearChange={setHeatmapYear}
          selectedBl={heatmapBl}
          onBlChange={setHeatmapBl}
        />
      )}

      {/* Historical scrape files */}
      <ScrapeHistoryList
        rows={filteredRows}
        totalCount={history?.rows.length ?? 0}
      />
    </div>
  );
}
