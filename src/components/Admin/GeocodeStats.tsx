'use client';

import { useMemo } from 'react';

const POPULATION: Record<string, number> = {
  'baden-wuerttemberg': 11_280_000,
  bayern: 13_370_000,
  berlin: 3_760_000,
  brandenburg: 2_570_000,
  bremen: 680_000,
  hamburg: 1_910_000,
  hessen: 6_390_000,
  'mecklenburg-vorpommern': 1_630_000,
  niedersachsen: 8_140_000,
  'nordrhein-westfalen': 18_140_000,
  'rheinland-pfalz': 4_160_000,
  saarland: 990_000,
  sachsen: 4_090_000,
  'sachsen-anhalt': 2_190_000,
  'schleswig-holstein': 2_950_000,
  thueringen: 2_120_000,
};
const TOTAL_POPULATION = Object.values(POPULATION).reduce((a, b) => a + b, 0);
const MONTH_NAMES = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

interface GeocodeStatsProps {
  selectedYear: number;
  selectedBl: string | null;
  activeDayData: Record<string, number>;
}

function countForYear(dayData: Record<string, number>, year: number): number {
  let total = 0;
  for (const [key, val] of Object.entries(dayData)) {
    if (key.startsWith(String(year))) total += val;
  }
  return total;
}

function monthCounts(dayData: Record<string, number>, year: number): number[] {
  const counts = new Array(12).fill(0);
  for (const [key, val] of Object.entries(dayData)) {
    if (!key.startsWith(String(year))) continue;
    const month = parseInt(key.slice(5, 7), 10) - 1;
    if (month >= 0 && month < 12) counts[month] += val;
  }
  return counts;
}

export function GeocodeStats({ selectedYear, selectedBl, activeDayData }: GeocodeStatsProps) {
  const total = useMemo(() => countForYear(activeDayData, selectedYear), [activeDayData, selectedYear]);
  const prevTotal = useMemo(() => countForYear(activeDayData, selectedYear - 1), [activeDayData, selectedYear]);

  const yoy = useMemo(() => {
    if (prevTotal === 0) return null;
    return ((total - prevTotal) / prevTotal) * 100;
  }, [total, prevTotal]);

  const per100k = useMemo(() => {
    const pop = selectedBl ? (POPULATION[selectedBl] ?? TOTAL_POPULATION) : TOTAL_POPULATION;
    return (total / pop) * 100_000;
  }, [total, selectedBl]);

  const months = useMemo(() => monthCounts(activeDayData, selectedYear), [activeDayData, selectedYear]);

  const now = new Date();
  const currentMonth = now.getFullYear() === selectedYear ? now.getMonth() : 11;

  const { maxCount, flagged } = useMemo(() => {
    const pastMonths = months.slice(0, currentMonth + 1).filter((c) => c > 0);
    const avg = pastMonths.length > 0 ? pastMonths.reduce((a, b) => a + b, 0) / pastMonths.length : 0;
    const maxCount = Math.max(...months, 1);
    const flagged: number[] = [];
    for (let i = 0; i <= currentMonth; i++) {
      if (avg > 0 && months[i] < avg * 0.5) flagged.push(i);
    }
    return { maxCount, flagged };
  }, [months, currentMonth]);

  return (
    <div
      className="flex flex-col gap-4 rounded-2xl border p-5"
      style={{
        borderColor: 'var(--border-subtle)',
        background: 'linear-gradient(160deg, var(--card) 0%, var(--card-elevated) 100%)',
      }}
    >
      <div>
        <p
          className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em]"
          style={{ color: 'var(--text-faint)' }}
        >
          Geocoded {selectedYear}
        </p>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {total.toLocaleString('de-DE')}
          </span>
          {yoy !== null ? (
            <span
              className="text-sm font-semibold"
              style={{ color: yoy > 0 ? '#22c55e' : '#ef4444' }}
            >
              {yoy > 0 ? '+' : ''}{yoy.toFixed(1)}%
            </span>
          ) : (
            <span className="text-sm" style={{ color: 'var(--text-faint)' }}>—</span>
          )}
        </div>
        {prevTotal > 0 && (
          <p className="mt-0.5 text-[10px]" style={{ color: 'var(--text-faint)' }}>
            vs. {prevTotal.toLocaleString('de-DE')} in {selectedYear - 1}
          </p>
        )}
      </div>

      <div>
        <p
          className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.2em]"
          style={{ color: 'var(--text-faint)' }}
        >
          Pro 100,000 pop.
        </p>
        <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
          {per100k.toFixed(1)}
        </span>
      </div>

      <div>
        <p
          className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.2em]"
          style={{ color: 'var(--text-faint)' }}
        >
          Coverage
        </p>

        <div className="flex items-end gap-[3px]" style={{ height: 48 }}>
          {months.map((count, i) => {
            const isFuture = i > currentMonth;
            const isFlagged = flagged.includes(i);
            const height = isFuture ? 4 : Math.max(4, (count / maxCount) * 48);

            let fill: string;
            if (isFuture) fill = 'var(--card-inner)';
            else if (isFlagged) fill = '#ef4444';
            else fill = '#f97316';

            return (
              <div
                key={i}
                className="group relative flex-1 rounded-sm transition-opacity"
                style={{
                  height,
                  background: fill,
                  opacity: isFuture ? 0.3 : 1,
                }}
                title={`${MONTH_NAMES[i]}: ${count.toLocaleString('de-DE')} records`}
              />
            );
          })}
        </div>

        <div className="mt-1 flex justify-between text-[8px]" style={{ color: 'var(--text-faint)' }}>
          {MONTH_NAMES.map((m) => (
            <span key={m}>{m[0]}</span>
          ))}
        </div>

        {flagged.length > 0 && (
          <p className="mt-1.5 text-[10px] font-medium" style={{ color: '#ef4444' }}>
            Gaps: {flagged.map((i) => MONTH_NAMES[i]).join(', ')}
          </p>
        )}
      </div>
    </div>
  );
}
