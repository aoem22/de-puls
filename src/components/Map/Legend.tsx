'use client';

import type { MetricConfig, DistrictData } from '../../../lib/types/district';
import { getLegendStops, getBivariateLegendColors } from '../../../lib/utils/colorScale';

interface LegendProps {
  metric: MetricConfig;
  compareMetric: MetricConfig | null;
  data: DistrictData[];
}

export function Legend({ metric, compareMetric, data }: LegendProps) {
  // Show bivariate legend when comparing
  if (compareMetric) {
    const colors = getBivariateLegendColors();

    return (
      <div className="bg-[#1a1a1a]/95 backdrop-blur-sm rounded-lg shadow-xl border border-[#333] p-3">
        <h3 className="text-xs font-semibold text-white mb-2 text-center">
          Korrelation
        </h3>

        {/* 2x2 bivariate legend grid */}
        <div className="relative">
          {/* Y-axis label (Metric A - Primary) */}
          <div
            className="absolute -left-1 top-1/2 -translate-y-1/2 -rotate-90 text-[9px] text-zinc-400 whitespace-nowrap origin-center"
            style={{ transform: 'translateX(-50%) rotate(-90deg)' }}
          >
            {metric.labelDe} →
          </div>

          {/* Grid container */}
          <div className="ml-4">
            {/* X-axis label (Metric B - Compare) */}
            <div className="text-[9px] text-zinc-400 text-center mb-1">
              {compareMetric.labelDe} →
            </div>

            {/* 2x2 grid */}
            <div className="grid grid-cols-2 gap-0.5 w-fit mx-auto">
              {/* Top row: High A */}
              <div
                className="w-8 h-8 md:w-10 md:h-10 rounded-sm border border-[#444]"
                style={{ backgroundColor: colors.highLow }}
                title={`Hoch ${metric.labelDe}, Niedrig ${compareMetric.labelDe}`}
              />
              <div
                className="w-8 h-8 md:w-10 md:h-10 rounded-sm border border-[#444]"
                style={{ backgroundColor: colors.highHigh }}
                title={`Hoch ${metric.labelDe}, Hoch ${compareMetric.labelDe}`}
              />
              {/* Bottom row: Low A */}
              <div
                className="w-8 h-8 md:w-10 md:h-10 rounded-sm border border-[#444]"
                style={{ backgroundColor: colors.lowLow }}
                title={`Niedrig ${metric.labelDe}, Niedrig ${compareMetric.labelDe}`}
              />
              <div
                className="w-8 h-8 md:w-10 md:h-10 rounded-sm border border-[#444]"
                style={{ backgroundColor: colors.lowHigh }}
                title={`Niedrig ${metric.labelDe}, Hoch ${compareMetric.labelDe}`}
              />
            </div>

            {/* Corner labels */}
            <div className="flex justify-between text-[8px] text-zinc-500 mt-1 px-1">
              <span>Niedrig</span>
              <span>Hoch</span>
            </div>
          </div>
        </div>

        {/* Legend explanation */}
        <div className="mt-2 pt-2 border-t border-[#333] space-y-1">
          <div className="flex items-center gap-2 text-[9px]">
            <div
              className="w-3 h-3 rounded-sm"
              style={{ backgroundColor: colors.highHigh }}
            />
            <span className="text-zinc-300">Beide hoch (korreliert)</span>
          </div>
          <div className="flex items-center gap-2 text-[9px]">
            <div
              className="w-3 h-3 rounded-sm"
              style={{ backgroundColor: colors.lowLow }}
            />
            <span className="text-zinc-300">Beide niedrig</span>
          </div>
          <div className="flex items-center gap-2 text-[9px]">
            <div
              className="w-3 h-3 rounded-sm"
              style={{ backgroundColor: colors.highLow }}
            />
            <span className="text-zinc-400">Nur {metric.labelDe} hoch</span>
          </div>
          <div className="flex items-center gap-2 text-[9px]">
            <div
              className="w-3 h-3 rounded-sm"
              style={{ backgroundColor: colors.lowHigh }}
            />
            <span className="text-zinc-400">Nur {compareMetric.labelDe} hoch</span>
          </div>
        </div>
      </div>
    );
  }

  // Standard single-metric legend
  const stops = getLegendStops(metric, data, 5);

  if (stops.length === 0) {
    return null;
  }

  return (
    <div className="bg-[#1a1a1a]/95 backdrop-blur-sm rounded-lg shadow-xl border border-[#333] p-3 md:min-w-[160px]">
      <h3 className="text-xs md:text-sm font-semibold text-white mb-2">
        {metric.labelDe}
      </h3>

      {/* Horizontal layout on mobile, vertical on desktop */}
      <div className="flex md:flex-col gap-1 md:gap-0.5">
        {stops.map((stop, index) => (
          <div key={index} className="flex flex-col md:flex-row items-center gap-0.5 md:gap-2 flex-1 md:flex-none">
            <div
              className="w-full md:w-6 h-3 md:h-4 rounded-sm border border-[#444]"
              style={{ backgroundColor: stop.color }}
            />
            <span className="text-[9px] md:text-xs text-zinc-300 font-mono hidden md:inline">
              {stop.label}
            </span>
          </div>
        ))}
      </div>

      {/* Mobile labels - just min and max */}
      <div className="flex md:hidden justify-between mt-1 text-[9px] text-zinc-400 font-mono">
        <span>{stops[0]?.label}</span>
        <span>{stops[stops.length - 1]?.label}</span>
      </div>

      {metric.isDiverging && (
        <p className="text-[9px] md:text-[10px] text-zinc-400 mt-2 leading-tight">
          <span className="text-teal-400">Teal</span> = niedriger · <span className="text-orange-400">Orange</span> = höher
        </p>
      )}
    </div>
  );
}
