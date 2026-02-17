'use client';

import { useMemo } from 'react';

/* ── Population data (2023 census, in millions) ────────────── */
const POPULATION: Record<string, number> = {
  'baden-wuerttemberg': 11_280_000,
  'bayern': 13_370_000,
  'berlin': 3_760_000,
  'brandenburg': 2_570_000,
  'bremen': 680_000,
  'hamburg': 1_910_000,
  'hessen': 6_390_000,
  'mecklenburg-vorpommern': 1_630_000,
  'niedersachsen': 8_140_000,
  'nordrhein-westfalen': 18_140_000,
  'rheinland-pfalz': 4_160_000,
  'saarland': 990_000,
  'sachsen': 4_090_000,
  'sachsen-anhalt': 2_190_000,
  'schleswig-holstein': 2_950_000,
  'thueringen': 2_120_000,
};
const TOTAL_POPULATION = Object.values(POPULATION).reduce((a, b) => a + b, 0);

/* States with dedicated scrapers get a "Verifiziert" badge */
const VERIFIED_STATES = new Set(['berlin', 'bayern', 'sachsen-anhalt', 'sachsen', 'hamburg']);

const MONTH_NAMES = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

/* ── Types ──────────────────────────────────────────────────── */
interface ScrapeStatsProps {
  selectedYear: number;
  selectedBl: string | null;
  activeDayData: Record<string, number>;
  byDay: Record<string, number>;
  byBundesland: Record<string, Record<string, number>>;
}

/* ── Helpers ────────────────────────────────────────────────── */
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

/* ── Component ──────────────────────────────────────────────── */
export function ScrapeStats({ selectedYear, selectedBl, activeDayData, byDay, byBundesland }: ScrapeStatsProps) {
  void byDay;
  void byBundesland;

  const total = useMemo(() => countForYear(activeDayData, selectedYear), [activeDayData, selectedYear]);

  /* Previous year total (for the same data source) */
  const prevTotal = useMemo(() => countForYear(activeDayData, selectedYear - 1), [activeDayData, selectedYear]);

  /* YoY change */
  const yoy = useMemo(() => {
    if (prevTotal === 0) return null;
    return ((total - prevTotal) / prevTotal) * 100;
  }, [total, prevTotal]);

  /* Per 100k population */
  const per100k = useMemo(() => {
    const pop = selectedBl ? (POPULATION[selectedBl] ?? TOTAL_POPULATION) : TOTAL_POPULATION;
    return (total / pop) * 100_000;
  }, [total, selectedBl]);

  /* Monthly coverage bars */
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

  const isVerified = selectedBl !== null && VERIFIED_STATES.has(selectedBl);

  return (
    <div
      className="flex flex-col gap-4 rounded-2xl border p-5"
      style={{
        borderColor: 'var(--border-subtle)',
        background: 'linear-gradient(160deg, var(--card) 0%, var(--card-elevated) 100%)',
      }}
    >
      {/* ── Total Articles ───────────────────────────────── */}
      <div>
        <p
          className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em]"
          style={{ color: 'var(--text-faint)' }}
        >
          Artikel {selectedYear}
        </p>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {total.toLocaleString('de-DE')}
          </span>
          {yoy !== null ? (
            <span
              className="text-sm font-semibold"
              style={{ color: yoy > 0 ? '#ef4444' : '#22c55e' }}
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

      {/* ── Per 100k Rate ────────────────────────────────── */}
      <div>
        <p
          className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.2em]"
          style={{ color: 'var(--text-faint)' }}
        >
          Pro 100.000 Einw.
        </p>
        <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
          {per100k.toFixed(1)}
        </span>
      </div>

      {/* ── Coverage Bars ────────────────────────────────── */}
      <div>
        <div className="mb-1.5 flex items-center gap-2">
          <p
            className="text-[10px] font-semibold uppercase tracking-[0.2em]"
            style={{ color: 'var(--text-faint)' }}
          >
            Abdeckung
          </p>
          {isVerified && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase"
              style={{ background: 'rgba(34, 197, 94, 0.15)', color: '#22c55e' }}
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0Zm3.78 5.28a.75.75 0 0 0-1.06-1.06L7 7.94 5.28 6.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.06 0l4.25-4.25Z" />
              </svg>
              Verifiziert
            </span>
          )}
        </div>

        <div className="flex items-end gap-[3px]" style={{ height: 48 }}>
          {months.map((count, i) => {
            const isFuture = i > currentMonth;
            const isFlagged = flagged.includes(i);
            const height = isFuture ? 4 : Math.max(4, (count / maxCount) * 48);

            let fill: string;
            if (isFuture) fill = 'var(--card-inner)';
            else if (isFlagged) fill = '#ef4444';
            else fill = 'var(--accent)';

            return (
              <div
                key={i}
                className="group relative flex-1 rounded-sm transition-opacity"
                style={{
                  height,
                  background: fill,
                  opacity: isFuture ? 0.3 : 1,
                }}
                title={`${MONTH_NAMES[i]}: ${count.toLocaleString('de-DE')} Artikel`}
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
            Lücken: {flagged.map((i) => MONTH_NAMES[i]).join(', ')}
          </p>
        )}
      </div>
    </div>
  );
}
