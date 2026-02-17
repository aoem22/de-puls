'use client';

import type { MetricKey } from '@/lib/admin/types';

interface MetricCardProps {
  label: string;
  metricKey: MetricKey;
  value: number | null;
  helpText: string;
  tone: string;
  isSelected: boolean;
  onSelect: (key: MetricKey) => void;
}

function MetricCard({ label, metricKey, value, helpText, tone, isSelected, onSelect }: MetricCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(metricKey)}
      className="relative rounded-2xl border p-4 text-left transition-all duration-200"
      style={{
        borderColor: isSelected ? tone : 'var(--border-subtle)',
        background: 'linear-gradient(160deg, var(--card) 0%, var(--card-elevated) 100%)',
        boxShadow: isSelected ? `0 0 16px ${tone}66, inset 0 0 0 1px ${tone}44` : 'none',
        cursor: 'pointer',
      }}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ background: tone }} />
        <p
          className="text-[10px] font-semibold uppercase tracking-[0.2em]"
          style={{ color: 'var(--text-faint)' }}
        >
          {label}
        </p>
        {isSelected && (
          <svg
            className="ml-auto h-3.5 w-3.5"
            style={{ color: tone }}
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M8 11L3 6h10L8 11z" />
          </svg>
        )}
      </div>
      <div
        className="text-2xl font-bold tabular-nums leading-none"
        style={{ color: 'var(--text-primary)' }}
      >
        {value == null ? '...' : value.toLocaleString('de-DE')}
      </div>
      <p className="mt-2 truncate text-xs" style={{ color: 'var(--text-muted)' }}>
        {helpText}
      </p>
    </button>
  );
}

interface MetricCardsProps {
  stats: { totalScraped: number; totalEnriched: number; totalGeocoded: number; totalJunk: number } | undefined;
  selectedMetric: MetricKey | null;
  onSelectMetric: (key: MetricKey | null) => void;
}

export function MetricCards({ stats, selectedMetric, onSelectMetric }: MetricCardsProps) {
  const handleSelect = (key: MetricKey) => {
    onSelectMetric(selectedMetric === key ? null : key);
  };

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <MetricCard
        label="Scraped"
        metricKey="scraped"
        value={stats?.totalScraped ?? null}
        helpText="Raw articles collected"
        tone="#0891b2"
        isSelected={selectedMetric === 'scraped'}
        onSelect={handleSelect}
      />
      <MetricCard
        label="Enriched"
        metricKey="enriched"
        value={stats?.totalEnriched ?? null}
        helpText="LLM-processed articles"
        tone="#22c55e"
        isSelected={selectedMetric === 'enriched'}
        onSelect={handleSelect}
      />
      <MetricCard
        label="Geocoded"
        metricKey="geocoded"
        value={stats?.totalGeocoded ?? null}
        helpText="With lat/lon coordinates"
        tone="#f97316"
        isSelected={selectedMetric === 'geocoded'}
        onSelect={handleSelect}
      />
      <MetricCard
        label="Junk Filtered"
        metricKey="junk"
        value={stats?.totalJunk ?? null}
        helpText="Removed by classification"
        tone="#ef4444"
        isSelected={selectedMetric === 'junk'}
        onSelect={handleSelect}
      />
    </div>
  );
}
