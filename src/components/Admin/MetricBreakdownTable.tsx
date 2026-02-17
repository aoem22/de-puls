'use client';

import { useState } from 'react';
import { useMetricBreakdown } from '@/lib/admin/hooks';
import { getBundeslandLabel } from '@/lib/admin/types';
import type { MetricKey, BreakdownRow } from '@/lib/admin/types';

type Tab = 'month' | 'pipeline_run' | 'bundesland';

const TABS: { key: Tab; label: string }[] = [
  { key: 'month', label: 'By Month' },
  { key: 'pipeline_run', label: 'By Pipeline Run' },
  { key: 'bundesland', label: 'By Bundesland' },
];

const METRIC_TONES: Record<MetricKey, string> = {
  scraped: '#0891b2',
  enriched: '#22c55e',
  geocoded: '#f97316',
  junk: '#ef4444',
};

function formatDimensionValue(tab: Tab, value: string): string {
  if (tab === 'bundesland') {
    if (value === 'unknown') return 'Unbekannt';
    return getBundeslandLabel(value);
  }
  if (tab === 'month' && /^\d{4}-\d{2}$/.test(value)) {
    const [y, m] = value.split('-');
    const date = new Date(Number(y), Number(m) - 1);
    return date.toLocaleDateString('de-DE', { year: 'numeric', month: 'short' });
  }
  return value;
}

interface MetricBreakdownTableProps {
  metric: MetricKey;
}

export function MetricBreakdownTable({ metric }: MetricBreakdownTableProps) {
  const { data, isLoading, error } = useMetricBreakdown(metric);
  const [activeTab, setActiveTab] = useState<Tab>('month');

  const tone = METRIC_TONES[metric];
  const showGeocoded = metric === 'enriched' || metric === 'geocoded';

  let rows: BreakdownRow[] = [];
  if (data) {
    if (activeTab === 'month') rows = data.byMonth;
    else if (activeTab === 'pipeline_run') rows = data.byPipelineRun;
    else rows = data.byBundesland;
  }

  // Filter out tabs with no data
  const availableTabs = TABS.filter(t => {
    if (!data) return true;
    if (t.key === 'month') return data.byMonth.length > 0;
    if (t.key === 'pipeline_run') return data.byPipelineRun.length > 0;
    if (t.key === 'bundesland') return data.byBundesland.length > 0;
    return true;
  });

  // Auto-select first available tab if current has no data
  const effectiveTab = availableTabs.some(t => t.key === activeTab)
    ? activeTab
    : (availableTabs[0]?.key ?? 'month');

  if (effectiveTab !== activeTab && data) {
    // Re-derive rows for effective tab
    if (effectiveTab === 'month') rows = data.byMonth;
    else if (effectiveTab === 'pipeline_run') rows = data.byPipelineRun;
    else rows = data.byBundesland;
  }

  const maxTotal = Math.max(...rows.map(r => r.total), 1);

  return (
    <div
      className="rounded-2xl border p-4"
      style={{
        borderColor: 'var(--border-subtle)',
        background: 'linear-gradient(160deg, var(--card) 0%, var(--card-elevated) 100%)',
      }}
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <p
          className="text-[10px] font-semibold uppercase tracking-[0.2em]"
          style={{ color: 'var(--text-faint)' }}
        >
          {metric} Breakdown
        </p>
      </div>

      {/* Tab pills */}
      <div className="mb-4 flex gap-1.5">
        {availableTabs.map(tab => {
          const isActive = (effectiveTab === tab.key);
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className="rounded-full px-3 py-1 text-xs font-medium transition-all duration-150"
              style={{
                background: isActive ? `${tone}22` : 'transparent',
                color: isActive ? tone : 'var(--text-muted)',
                border: `1px solid ${isActive ? `${tone}44` : 'var(--border-subtle)'}`,
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {isLoading && (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="h-8 animate-pulse rounded-lg"
              style={{ background: 'var(--loading-skeleton)' }}
            />
          ))}
        </div>
      )}

      {error && (
        <p className="text-sm" style={{ color: '#ef4444' }}>
          Failed to load breakdown: {error.message}
        </p>
      )}

      {!isLoading && !error && rows.length === 0 && (
        <p className="py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          {metric === 'junk'
            ? 'Junk count is cache-based — no detailed breakdown available.'
            : 'No data available for this dimension.'}
        </p>
      )}

      {!isLoading && !error && rows.length > 0 && (
        <div className="space-y-1.5">
          {/* Column headers */}
          <div className="flex items-center gap-2 px-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
            <span className="w-36 shrink-0">Dimension</span>
            <span className="flex-1" />
            <span className="w-16 text-right">Total</span>
            {showGeocoded && <span className="w-16 text-right">Geocoded</span>}
          </div>

          {rows.map((row) => {
            const pct = (row.total / maxTotal) * 100;
            return (
              <div
                key={row.dimension_value}
                className="flex items-center gap-2 rounded-lg px-1 py-1.5"
                style={{ background: 'var(--card-inner, transparent)' }}
              >
                <span
                  className="w-36 shrink-0 truncate text-xs font-medium"
                  style={{ color: 'var(--text-secondary)' }}
                  title={row.dimension_value}
                >
                  {formatDimensionValue(effectiveTab, row.dimension_value)}
                </span>

                {/* Bar */}
                <div className="relative h-4 flex-1 overflow-hidden rounded" style={{ background: `${tone}11` }}>
                  <div
                    className="absolute inset-y-0 left-0 rounded transition-all duration-300"
                    style={{ width: `${pct}%`, background: `${tone}44` }}
                  />
                  {showGeocoded && row.geocoded > 0 && (
                    <div
                      className="absolute inset-y-0 left-0 rounded transition-all duration-300"
                      style={{ width: `${(row.geocoded / maxTotal) * 100}%`, background: `${tone}88` }}
                    />
                  )}
                </div>

                <span
                  className="w-16 text-right text-xs font-bold tabular-nums"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {row.total.toLocaleString('de-DE')}
                </span>

                {showGeocoded && (
                  <span
                    className="w-16 text-right text-xs tabular-nums"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {row.geocoded.toLocaleString('de-DE')}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
