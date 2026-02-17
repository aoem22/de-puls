'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { BUNDESLAENDER, getBundeslandLabel } from '@/lib/admin/types';
import { usePersistedState, useEnrichFiles, useEnrichHistory } from '@/lib/admin/hooks';
import {
  PERIODS,
  type Period,
  computeRange,
  currentMonthISO,
  currentYearValue,
  formatRange,
  todayISO,
} from '@/lib/admin/date-range';
import { useEnrichProcess } from './AdminProcessContext';
import { ModelPicker, type Provider } from './ModelPicker';
import { EnrichLogViewer } from './EnrichLogViewer';
import { EnrichHistoryList } from './EnrichHistoryList';
import { EnrichHeatmap } from './EnrichHeatmap';
import type { EnrichEstimate } from '@/lib/admin/types';

const DEFAULT_MODELS: Record<Provider, string> = {
  openrouter: 'x-ai/grok-4-fast',
  deepseek: 'deepseek-chat',
};

/** Try to extract date range from filename (e.g. .chunk_2023-01-01_2023-01-31.json) */
function extractDatesFromFilename(filename: string): { start: string; end: string } | null {
  const match = filename.match(/(\d{4}-\d{2}-\d{2})[_.](\d{4}-\d{2}-\d{2})/);
  if (match) return { start: match[1], end: match[2] };
  return null;
}

/** Check if two date ranges overlap */
function rangesOverlap(
  a: { start: string; end: string },
  b: { start: string; end: string }
): boolean {
  return a.start <= b.end && a.end >= b.start;
}

export function EnrichPanel() {
  // Period + date state
  const [period, setPeriod] = usePersistedState<Period>('enrich.period', 'month');
  const [dateVal, setDateVal] = usePersistedState('enrich.dateVal', todayISO());
  const [monthVal, setMonthVal] = usePersistedState('enrich.monthVal', currentMonthISO());
  const [yearVal, setYearVal] = usePersistedState('enrich.yearVal', currentYearValue());

  // Bundesland selection
  const [selectedArr, setSelectedArr] = usePersistedState<string[]>(
    'enrich.selected', [...BUNDESLAENDER]
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

  // Provider + Model + estimate
  const [provider, setProvider] = usePersistedState<Provider>('enrich.provider', 'openrouter');
  const [selectedModel, setSelectedModel] = usePersistedState('enrich.model', DEFAULT_MODELS[provider]);
  const [modelPricing, setModelPricing] = useState<{ prompt: number; completion: number }>({ prompt: 0, completion: 0 });
  const [estimate, setEstimate] = useState<EnrichEstimate | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const estimateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Process state from context (survives navigation)
  const { isRunning, logs, currentFileIndex, currentFileName, fileCount, start, stop, clearLogs } = useEnrichProcess();

  // Data
  const { data: allFiles } = useEnrichFiles();
  const { data: enrichHistory, mutate: mutateHistory } = useEnrichHistory();

  // Read heatmap filter state (shared via persisted keys)
  const [heatmapBl] = usePersistedState<string | null>('enrich.heatmap.bl', null);
  const [heatmapYear] = usePersistedState('enrich.heatmap.year', new Date().getFullYear());

  const filteredEnrichFiles = useMemo(() => {
    const files = enrichHistory?.files ?? [];
    return files.filter(f => {
      if (heatmapBl && f.bundesland !== heatmapBl) return false;
      if (heatmapYear && !f.yearMonth.startsWith(String(heatmapYear))) return false;
      return true;
    });
  }, [enrichHistory?.files, heatmapBl, heatmapYear]);

  // Computed
  const dateRange = useMemo(
    () => computeRange(period, dateVal, monthVal, yearVal),
    [period, dateVal, monthVal, yearVal]
  );

  const allSelected = BUNDESLAENDER.every((s) => selected.has(s));

  // Match files by selected states + date range
  const matchedFiles = useMemo(() => {
    if (!allFiles) return [];
    return allFiles.filter((f) => {
      // Skip enriched output files sitting alongside raw files
      if (f.filename.includes('_enriched')) return false;
      if (!selected.has(f.bundesland)) return false;

      // Date overlap check
      const fileDates =
        f.dateRange.earliest && f.dateRange.latest
          ? { start: f.dateRange.earliest, end: f.dateRange.latest }
          : extractDatesFromFilename(f.filename);

      if (fileDates) {
        return rangesOverlap(dateRange, fileDates);
      }
      // Include files with unknown date range
      return true;
    });
  }, [allFiles, selected, dateRange]);

  const totalArticles = matchedFiles.reduce((s, f) => s + f.articleCount, 0);

  // Debounced estimate calculation
  useEffect(() => {
    if (estimateTimerRef.current) clearTimeout(estimateTimerRef.current);

    if (totalArticles === 0 || (modelPricing.prompt === 0 && modelPricing.completion === 0)) {
      setEstimate(null);
      return;
    }

    setEstimateLoading(true);
    estimateTimerRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          articleCount: String(totalArticles),
          promptPrice: String(modelPricing.prompt),
          completionPrice: String(modelPricing.completion),
        });
        const res = await fetch(`/api/admin/enrich/estimate?${params}`);
        if (res.ok) setEstimate(await res.json());
      } catch {
        // ignore fetch errors for estimates
      } finally {
        setEstimateLoading(false);
      }
    }, 300);

    return () => {
      if (estimateTimerRef.current) clearTimeout(estimateTimerRef.current);
    };
  }, [totalArticles, modelPricing]);

  function handleModelChange(modelId: string, pricing: { prompt: number; completion: number }) {
    setSelectedModel(modelId);
    setModelPricing(pricing);
  }

  function handleProviderChange(p: Provider) {
    setProvider(p);
    setSelectedModel(DEFAULT_MODELS[p]);
    setModelPricing({ prompt: 0, completion: 0 });
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
    if (allSelected) setSelected(new Set());
    else setSelected(new Set([...BUNDESLAENDER]));
  }

  const handleStart = useCallback(() => {
    if (matchedFiles.length === 0 || isRunning) return;
    start({
      files: matchedFiles.map((f) => ({ path: f.path, absolutePath: f.absolutePath })),
      model: selectedModel !== DEFAULT_MODELS[provider] ? selectedModel : undefined,
      provider: provider !== 'openrouter' ? provider : undefined,
    });
  }, [matchedFiles, selectedModel, provider, isRunning, start]);

  // Revalidate history when enrichment finishes
  const prevRunning = useRef(isRunning);
  useEffect(() => {
    if (prevRunning.current && !isRunning) {
      mutateHistory();
    }
    prevRunning.current = isRunning;
  }, [isRunning, mutateHistory]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Enricher
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          Zeitraum und Bundesl&auml;nder w&auml;hlen, dann LLM-Enrichment starten. Artikel
          werden klassifiziert, mit Orts- und Kriminalit&auml;tsdaten angereichert und nach
          Vorfall gruppiert.
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
                Mo {dateRange.start} &mdash; So {dateRange.end}
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

      {/* Bundesland grid */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-muted)' }}
          >
            Bundesl&auml;nder
          </label>
          <button
            onClick={toggleAll}
            disabled={isRunning}
            className="text-xs font-medium"
            style={{ color: 'var(--accent)' }}
          >
            {allSelected ? 'Keine ausw\u00e4hlen' : 'Alle ausw\u00e4hlen'}
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
                  {isSelected ? '\u2713' : '\u25CB'}
                </span>
                {getBundeslandLabel(slug)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Model + Cost + Summary + Start */}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Left: summary stats */}
        <div
          className="flex items-center gap-4 rounded-xl border px-4 py-3"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--card)' }}
        >
          <div>
            <div className="text-2xl font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {matchedFiles.length}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-faint)' }}>Dateien</div>
          </div>
          <div className="h-8 w-px" style={{ background: 'var(--border-subtle)' }} />
          <div>
            <div className="text-2xl font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {totalArticles.toLocaleString('de-DE')}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-faint)' }}>Artikel</div>
          </div>
          {estimate && (
            <>
              <div className="h-8 w-px" style={{ background: 'var(--border-subtle)' }} />
              <div>
                <div className="text-2xl font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                  ${estimate.estimatedCostUsd.toFixed(2)}
                </div>
                <div className="text-xs" style={{ color: 'var(--text-faint)' }}>gesch&auml;tzt</div>
              </div>
              <div className="h-8 w-px" style={{ background: 'var(--border-subtle)' }} />
              <div>
                <div className="text-2xl font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                  ~{Math.ceil(estimate.estimatedTimeSeconds / 60)} Min.
                </div>
                <div className="text-xs" style={{ color: 'var(--text-faint)' }}>Dauer</div>
              </div>
            </>
          )}
          {estimateLoading && !estimate && (
            <>
              <div className="h-8 w-px" style={{ background: 'var(--border-subtle)' }} />
              <div className="h-6 w-16 animate-pulse rounded" style={{ background: 'var(--border-subtle)' }} />
            </>
          )}
        </div>

        {/* Right: model + start */}
        <div className="space-y-3">
          <ModelPicker
            value={selectedModel}
            onChange={handleModelChange}
            disabled={isRunning}
            provider={provider}
            onProviderChange={handleProviderChange}
          />

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
              ? `Verarbeite Datei ${currentFileIndex + 1}/${fileCount}...`
              : matchedFiles.length === 0
                ? 'Keine Dateien f\u00fcr diese Auswahl'
                : `Enrichment starten (${matchedFiles.length} Dateien)`}
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
              Abbrechen
            </button>
          )}
        </div>
      </div>

      {/* Log viewer */}
      <EnrichLogViewer
        logs={logs}
        isRunning={isRunning}
        fileCount={fileCount}
        currentFileIndex={currentFileIndex}
        currentFileName={currentFileName}
        onAbort={stop}
        onClear={clearLogs}
      />

      {/* Enrichment coverage heatmap */}
      {enrichHistory && (
        <EnrichHeatmap
          byDay={enrichHistory.byDay}
          byBundesland={enrichHistory.byBundesland}
        />
      )}

      {/* Enrichment history table */}
      <EnrichHistoryList files={filteredEnrichFiles} totalCount={enrichHistory?.files?.length} />
    </div>
  );
}
