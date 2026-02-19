'use client';

import { useCallback, useMemo, useRef, useEffect } from 'react';
import { BUNDESLAENDER, getBundeslandLabel } from '@/lib/admin/types';
import { usePersistedState, useGeocodeHistory } from '@/lib/admin/hooks';
import {
  PERIODS,
  type Period,
  computeRange,
  currentMonthISO,
  currentYearValue,
  formatRange,
  todayISO,
} from '@/lib/admin/date-range';
import { useGeocodeProcess } from './AdminProcessContext';
import { EnrichLogViewer } from './EnrichLogViewer';
import { GeocodeHeatmap } from './GeocodeHeatmap';
import { GeocodeHistoryList } from './GeocodeHistoryList';

function rangesOverlap(
  a: { start: string; end: string },
  b: { start: string; end: string },
): boolean {
  return a.start <= b.end && a.end >= b.start;
}

function monthRange(ym: string): { start: string; end: string } | null {
  if (!/^\d{4}-\d{2}$/.test(ym)) return null;
  const [yearText, monthText] = ym.split('-');
  const year = Number(yearText);
  const month = Number(monthText) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;

  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export function GeocodePanel() {
  const [period, setPeriod] = usePersistedState<Period>('geocode.period', 'month');
  const [dateVal, setDateVal] = usePersistedState('geocode.dateVal', todayISO());
  const [monthVal, setMonthVal] = usePersistedState('geocode.monthVal', currentMonthISO());
  const [yearVal, setYearVal] = usePersistedState('geocode.yearVal', currentYearValue());

  const [selectedArr, setSelectedArr] = usePersistedState<string[]>(
    'geocode.selected', [...BUNDESLAENDER],
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
    [setSelectedArr],
  );

  const [maxRps, setMaxRps] = usePersistedState<number>('geocode.maxRps', 5);
  const [force, setForce] = usePersistedState<boolean>('geocode.force', false);

  const {
    isRunning,
    logs,
    currentFileIndex,
    currentFileName,
    fileCount,
    start,
    stop,
    clearLogs,
  } = useGeocodeProcess();

  const { data: history, mutate: mutateHistory } = useGeocodeHistory();
  const [heatmapBl] = usePersistedState<string | null>('geocode.heatmap.bl', null);
  const [heatmapYear] = usePersistedState('geocode.heatmap.year', new Date().getFullYear());

  const dateRange = useMemo(
    () => computeRange(period, dateVal, monthVal, yearVal),
    [period, dateVal, monthVal, yearVal],
  );

  const allSelected = BUNDESLAENDER.every((s) => selected.has(s));

  const matchedFiles = useMemo(() => {
    const files = history?.files ?? [];
    return files.filter((file) => {
      if (!selected.has(file.bundesland)) return false;

      const sourceRange =
        file.dateRange.start && file.dateRange.end
          ? { start: file.dateRange.start, end: file.dateRange.end }
          : monthRange(file.yearMonth);

      if (!sourceRange) return true;
      return rangesOverlap(dateRange, sourceRange);
    });
  }, [history?.files, selected, dateRange]);

  const historyFiles = useMemo(() => {
    const files = history?.files ?? [];
    return files.filter((file) => {
      if (heatmapBl && file.bundesland !== heatmapBl) return false;
      if (heatmapYear && !file.yearMonth.startsWith(String(heatmapYear))) return false;
      return true;
    });
  }, [history?.files, heatmapBl, heatmapYear]);

  const totalArticles = useMemo(
    () => matchedFiles.reduce((sum, file) => sum + file.articleCount, 0),
    [matchedFiles],
  );

  const totalGeocoded = useMemo(
    () => matchedFiles.reduce((sum, file) => sum + file.geocodedCount, 0),
    [matchedFiles],
  );

  const pendingGeocode = Math.max(0, totalArticles - totalGeocoded);

  const handleStart = useCallback(() => {
    if (matchedFiles.length === 0 || isRunning) return;
    start({
      files: matchedFiles.map((f) => ({ path: f.path })),
      maxRps,
      force,
    });
  }, [matchedFiles, isRunning, start, maxRps, force]);

  const prevRunning = useRef(isRunning);
  useEffect(() => {
    if (prevRunning.current && !isRunning) {
      mutateHistory();
    }
    prevRunning.current = isRunning;
  }, [isRunning, mutateHistory]);

  function toggleState(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set([...BUNDESLAENDER]));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Geocoder
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          Select period and states, then geocode enriched records with HERE API.
          Existing coordinates are skipped unless force mode is enabled.
        </p>
      </div>

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
                  borderColor: period === p.key ? 'var(--accent)' : 'var(--border)',
                  background: period === p.key ? 'var(--accent)' : 'var(--card)',
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
              {Array.from({ length: 5 }, (_, i) => currentYearValue() - i).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
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
            const isSelected = selected.has(slug);

            return (
              <button
                key={slug}
                onClick={() => toggleState(slug)}
                disabled={isRunning}
                className="relative rounded-xl border px-3 py-2 text-left text-sm font-medium transition-all"
                style={{
                  borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                  background: isSelected
                    ? 'color-mix(in srgb, var(--accent) 12%, transparent)'
                    : 'var(--card)',
                  color: isSelected ? 'var(--accent)' : 'var(--text-secondary)',
                  cursor: isRunning ? 'not-allowed' : 'pointer',
                  boxShadow: isSelected ? '0 0 0 1px var(--accent)' : undefined,
                }}
              >
                <span className="mr-1.5 inline-block w-4 text-center">
                  {isSelected ? '✓' : '○'}
                </span>
                {getBundeslandLabel(slug)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div
          className="flex flex-wrap items-center gap-4 rounded-xl border px-4 py-3"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--card)' }}
        >
          <div>
            <div className="text-2xl font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {matchedFiles.length}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-faint)' }}>Files</div>
          </div>
          <div className="h-8 w-px" style={{ background: 'var(--border-subtle)' }} />
          <div>
            <div className="text-2xl font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {totalArticles.toLocaleString('de-DE')}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-faint)' }}>Enriched records</div>
          </div>
          <div className="h-8 w-px" style={{ background: 'var(--border-subtle)' }} />
          <div>
            <div className="text-2xl font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {totalGeocoded.toLocaleString('de-DE')}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-faint)' }}>Geocoded</div>
          </div>
          <div className="h-8 w-px" style={{ background: 'var(--border-subtle)' }} />
          <div>
            <div className="text-2xl font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {pendingGeocode.toLocaleString('de-DE')}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-faint)' }}>Need geocode</div>
          </div>
        </div>

        <div className="space-y-3">
          <div
            className="rounded-xl border px-3 py-2"
            style={{ borderColor: 'var(--border-subtle)', background: 'var(--card)' }}
          >
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Throughput (req/s)
            </label>
            <input
              type="number"
              min={0.1}
              max={25}
              step={0.1}
              value={maxRps}
              onChange={(e) => setMaxRps(Math.max(0.1, Math.min(25, Number(e.target.value) || 0.1)))}
              disabled={isRunning}
              className="w-full rounded-lg border px-2 py-1.5 text-sm"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--card-elevated)',
                color: 'var(--text-primary)',
              }}
            />
            <p className="mt-1 text-[10px]" style={{ color: 'var(--text-faint)' }}>
              HERE free tier: 250K/month, 5 req/s.
            </p>
            <label className="mt-2 flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={force}
                onChange={(e) => setForce(e.target.checked)}
                disabled={isRunning}
              />
              Force re-geocode existing coordinates
            </label>
          </div>

          <button
            onClick={handleStart}
            disabled={matchedFiles.length === 0 || isRunning}
            className="w-full rounded-xl border px-5 py-2.5 text-sm font-semibold transition-all"
            style={{
              borderColor: 'var(--accent)',
              background: matchedFiles.length === 0 || isRunning ? 'var(--card)' : 'var(--accent)',
              color: matchedFiles.length === 0 || isRunning ? 'var(--text-faint)' : '#fff',
              cursor: matchedFiles.length === 0 || isRunning ? 'not-allowed' : 'pointer',
            }}
          >
            {isRunning
              ? `Processing file ${currentFileIndex + 1}/${fileCount}...`
              : matchedFiles.length === 0
                ? 'No files for this selection'
                : `Start geocoding (${matchedFiles.length} files)`}
          </button>

          {isRunning && (
            <button
              onClick={stop}
              className="w-full rounded-xl border px-4 py-2 text-sm font-medium transition-all"
              style={{
                borderColor: '#ef4444',
                background: 'transparent',
                color: '#ef4444',
                cursor: 'pointer',
              }}
            >
              Abort
            </button>
          )}
        </div>
      </div>

      <EnrichLogViewer
        logs={logs}
        isRunning={isRunning}
        fileCount={fileCount}
        currentFileIndex={currentFileIndex}
        currentFileName={currentFileName}
        onAbort={stop}
        onClear={clearLogs}
      />

      {history && (
        <GeocodeHeatmap
          byDay={history.byDay}
          byBundesland={history.byBundesland}
          pointsByDay={history.pointsByDay}
        />
      )}

      <GeocodeHistoryList files={historyFiles} totalCount={history?.files?.length} />
    </div>
  );
}
