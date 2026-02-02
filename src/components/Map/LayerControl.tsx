'use client';

import type { MetricKey } from '../../../lib/types/district';
import { METRICS } from '../../../lib/types/district';

interface LayerControlProps {
  selectedMetric: MetricKey;
  compareMetric: MetricKey | null;
  correlation: number | null;
  onMetricChange: (metric: MetricKey) => void;
  onCompareMetricChange: (metric: MetricKey | null) => void;
}

// Get correlation strength label
function getCorrelationLabel(r: number): { label: string; color: string } {
  const abs = Math.abs(r);
  if (abs >= 0.7) return { label: 'Stark', color: r > 0 ? '#22c55e' : '#ef4444' };
  if (abs >= 0.4) return { label: 'Mittel', color: r > 0 ? '#84cc16' : '#f97316' };
  if (abs >= 0.2) return { label: 'Schwach', color: '#eab308' };
  return { label: 'Keine', color: '#71717a' };
}

export function LayerControl({
  selectedMetric,
  compareMetric,
  correlation,
  onMetricChange,
  onCompareMetricChange,
}: LayerControlProps) {
  const metrics = Object.values(METRICS);

  return (
    <div className="bg-[#141414]/95 backdrop-blur-sm rounded-lg shadow-xl border border-[#262626] p-3 space-y-3">
      {/* Primary metric selector */}
      <div>
        <label
          htmlFor="metric-select"
          className="block text-xs md:text-sm font-semibold text-zinc-200 mb-1.5"
        >
          Primär-Indikator
        </label>
        <select
          id="metric-select"
          value={selectedMetric}
          onChange={(e) => onMetricChange(e.target.value as MetricKey)}
          className="w-full px-3 py-2.5 md:py-2 text-sm bg-[#0a0a0a] border border-[#333] rounded-md shadow-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 appearance-none cursor-pointer"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 12px center',
          }}
        >
          {metrics.map((metric) => (
            <option key={metric.key} value={metric.key}>
              {metric.labelDe}
            </option>
          ))}
        </select>
      </div>

      {/* Comparison metric selector */}
      <div>
        <label
          htmlFor="compare-select"
          className="block text-xs md:text-sm font-semibold text-zinc-200 mb-1.5"
        >
          Vergleichen mit
        </label>
        <select
          id="compare-select"
          value={compareMetric || ''}
          onChange={(e) => {
            const value = e.target.value;
            onCompareMetricChange(value ? (value as MetricKey) : null);
          }}
          className="w-full px-3 py-2.5 md:py-2 text-sm bg-[#0a0a0a] border border-[#333] rounded-md shadow-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-pink-500/50 focus:border-pink-500 appearance-none cursor-pointer"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 12px center',
          }}
        >
          <option value="">– Keinen –</option>
          {metrics
            .filter((m) => m.key !== selectedMetric)
            .map((metric) => (
              <option key={metric.key} value={metric.key}>
                {metric.labelDe}
              </option>
            ))}
        </select>
      </div>

      {/* Correlation display */}
      {correlation !== null && (
        <div className="pt-2 border-t border-[#333]">
          <div className="text-xs text-zinc-400 mb-1">Korrelation</div>
          <div className="flex items-center justify-between">
            <span
              className="text-2xl font-bold"
              style={{ color: getCorrelationLabel(correlation).color }}
            >
              {correlation >= 0 ? '+' : ''}{correlation.toFixed(2)}
            </span>
            <span
              className="text-xs px-2 py-1 rounded"
              style={{
                backgroundColor: getCorrelationLabel(correlation).color + '20',
                color: getCorrelationLabel(correlation).color,
              }}
            >
              {getCorrelationLabel(correlation).label}
              {correlation > 0 ? ' positiv' : correlation < 0 ? ' negativ' : ''}
            </span>
          </div>
          <p className="text-[9px] text-zinc-500 mt-1.5 leading-tight">
            {Math.abs(correlation) >= 0.4
              ? 'Bezirke mit hohem Wert in einem Indikator haben tendenziell auch ' +
                (correlation > 0 ? 'hohe' : 'niedrige') +
                ' Werte im anderen.'
              : 'Kein starker linearer Zusammenhang zwischen den Indikatoren.'}
          </p>
        </div>
      )}

      {/* Info text when not comparing */}
      {!compareMetric && (
        <p className="text-[10px] text-zinc-500 leading-tight hidden md:block">
          {METRICS[selectedMetric].description}
        </p>
      )}
    </div>
  );
}
