'use client';

import { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { BUNDESLAENDER, getBundeslandLabel } from '@/lib/admin/types';
import { usePersistedState } from '@/lib/admin/hooks';
import type { GeocodePoint } from '@/lib/admin/types';
import { GeocodeStats } from './GeocodeStats';

interface Props {
  byDay: Record<string, number>;
  byBundesland: Record<string, Record<string, number>>;
  pointsByDay: Record<string, GeocodePoint[]>;
}

const GeocodeHoverMap = dynamic(
  () => import('./GeocodeHoverMap').then((mod) => mod.GeocodeHoverMap),
  {
    loading: () => (
      <div
        className="mt-3 mx-auto w-full max-w-[560px] aspect-[4/2] animate-pulse rounded-xl border"
        style={{
          borderColor: 'var(--border-subtle)',
          background: 'var(--loading-skeleton)',
        }}
      />
    ),
  },
);

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const DAY_LABELS = ['Mo', '', 'Mi', '', 'Fr', '', ''];

const CELL_SIZE = 11;
const GAP = 2;
const STEP = CELL_SIZE + GAP;

const COLOR_EMPTY = 'var(--card-inner, rgba(255,255,255,0.06))';
const COLOR_LOW = 'rgba(249, 115, 22, 0.3)';
const COLOR_MED = 'rgba(249, 115, 22, 0.6)';
const COLOR_HIGH = 'rgba(249, 115, 22, 1.0)';

function getColor(count: number, min: number, max: number): string {
  if (count === 0) return COLOR_EMPTY;
  if (min === max) return COLOR_MED;
  const t = (count - min) / (max - min);
  if (t < 0.33) return COLOR_LOW;
  if (t < 0.66) return COLOR_MED;
  return COLOR_HIGH;
}

function formatDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getYears(byDay: Record<string, number>, byBundesland: Record<string, Record<string, number>>): number[] {
  const years = new Set<number>();
  for (const key of Object.keys(byDay)) {
    const y = parseInt(key.slice(0, 4), 10);
    if (!isNaN(y)) years.add(y);
  }
  for (const bl of Object.values(byBundesland)) {
    for (const key of Object.keys(bl)) {
      const y = parseInt(key.slice(0, 4), 10);
      if (!isNaN(y)) years.add(y);
    }
  }
  years.add(new Date().getFullYear());
  return Array.from(years).sort((a, b) => b - a);
}

interface DayCell {
  date: string;
  count: number;
  col: number;
  row: number;
}

function buildGrid(year: number, dayData: Record<string, number>): { cells: DayCell[]; monthStarts: Array<{ month: number; col: number }> } {
  const cells: DayCell[] = [];
  const monthStarts: Array<{ month: number; col: number }> = [];
  const seenMonths = new Set<number>();

  const jan1 = new Date(year, 0, 1);
  const jan1Dow = (jan1.getDay() + 6) % 7;
  const startDate = new Date(jan1);
  startDate.setDate(startDate.getDate() - jan1Dow);

  for (let week = 0; week < 53; week++) {
    for (let dow = 0; dow < 7; dow++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + week * 7 + dow);
      if (d.getFullYear() !== year) continue;

      const dateStr = d.toISOString().slice(0, 10);
      const count = dayData[dateStr] || 0;
      cells.push({ date: dateStr, count, col: week, row: dow });

      const month = d.getMonth();
      if (!seenMonths.has(month)) {
        seenMonths.add(month);
        monthStarts.push({ month, col: week });
      }
    }
  }

  return { cells, monthStarts };
}

export function GeocodeHeatmap({ byDay, byBundesland, pointsByDay }: Props) {
  const years = useMemo(() => getYears(byDay, byBundesland), [byDay, byBundesland]);
  const [selectedYear, setSelectedYear] = usePersistedState('geocode.heatmap.year', years[0] || new Date().getFullYear());
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [hoveredDay, setHoveredDay] = useState<string | null>(null);
  const [selectedBl, setSelectedBl] = usePersistedState<string | null>('geocode.heatmap.bl', null);

  const availableStates = useMemo(() => {
    return [...BUNDESLAENDER].sort((a, b) =>
      getBundeslandLabel(a).localeCompare(getBundeslandLabel(b)),
    );
  }, []);

  const activeDayData = useMemo(() => {
    if (selectedBl) return byBundesland[selectedBl] || {};
    return byDay;
  }, [selectedBl, byDay, byBundesland]);

  const { cells, monthStarts } = useMemo(
    () => buildGrid(selectedYear, activeDayData),
    [selectedYear, activeDayData],
  );

  const { minCount, maxCount } = useMemo(() => {
    const nonZero = cells.filter((c) => c.count > 0).map((c) => c.count);
    if (nonZero.length === 0) return { minCount: 0, maxCount: 0 };
    return { minCount: Math.min(...nonZero), maxCount: Math.max(...nonZero) };
  }, [cells]);

  const totalRecords = useMemo(() => cells.reduce((sum, c) => sum + c.count, 0), [cells]);
  const totalDays = useMemo(() => cells.filter((c) => c.count > 0).length, [cells]);
  const hoverPoints = useMemo(() => {
    if (!hoveredDay) return [];
    const points = pointsByDay[hoveredDay] ?? [];
    if (!selectedBl) return points;
    return points.filter((p) => p.bundesland === selectedBl);
  }, [hoveredDay, pointsByDay, selectedBl]);

  const allPoints = useMemo(() => {
    const yearPrefix = `${selectedYear}-`;
    const merged: GeocodePoint[] = [];

    for (const [day, points] of Object.entries(pointsByDay)) {
      if (!day.startsWith(yearPrefix)) continue;
      if (!selectedBl) {
        merged.push(...points);
      } else {
        merged.push(...points.filter((p) => p.bundesland === selectedBl));
      }
    }

    return merged;
  }, [pointsByDay, selectedYear, selectedBl]);

  const label = selectedBl
    ? getBundeslandLabel(selectedBl)
    : 'All';

  const mapPoints = hoveredDay ? hoverPoints : allPoints;
  const mapLabel = hoveredDay || `All days ${selectedYear}${selectedBl ? ` · ${label}` : ''}`;

  const LEFT_MARGIN = 28;
  const TOP_MARGIN = 18;
  const svgWidth = LEFT_MARGIN + 53 * STEP + 4;
  const svgHeight = TOP_MARGIN + 7 * STEP + 4;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <label
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--text-muted)' }}
        >
          Geocode Coverage
        </label>
        <div className="flex gap-1">
          {years.map((y) => (
            <button
              key={y}
              onClick={() => setSelectedYear(y)}
              className="rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors"
              style={{
                borderColor: y === selectedYear ? '#f97316' : 'var(--border)',
                background: y === selectedYear ? '#f97316' : 'transparent',
                color: y === selectedYear ? '#fff' : 'var(--text-secondary)',
              }}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        <button
          onClick={() => setSelectedBl(null)}
          className="rounded-lg border px-2 py-0.5 text-[10px] font-semibold uppercase transition-colors"
          style={{
            borderColor: selectedBl === null ? '#f97316' : 'var(--border)',
            background: selectedBl === null ? '#f97316' : 'transparent',
            color: selectedBl === null ? '#fff' : 'var(--text-muted)',
          }}
        >
          All
        </button>
        {availableStates.map((bl) => {
          const isActive = selectedBl === bl;
          const hasData = byBundesland[bl] && Object.keys(byBundesland[bl]).length > 0;
          return (
            <button
              key={bl}
              onClick={() => setSelectedBl(bl)}
              className="rounded-lg border px-2 py-0.5 text-[10px] font-medium transition-colors"
              style={{
                borderColor: isActive ? '#f97316' : 'var(--border)',
                background: isActive ? '#f97316' : 'transparent',
                color: isActive ? '#fff' : 'var(--text-muted)',
                opacity: !hasData && !isActive ? 0.4 : 1,
                borderStyle: !hasData && !isActive ? 'dashed' : 'solid',
              }}
            >
              {getBundeslandLabel(bl).slice(0, 14)}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <div
            className="relative overflow-x-auto rounded-xl border p-3"
            style={{
              borderColor: 'var(--border-subtle)',
              background: 'var(--card)',
            }}
          >
            <svg
              width={svgWidth}
              height={svgHeight}
              className="block"
              style={{ minWidth: svgWidth }}
            >
              {monthStarts.map(({ month, col }) => (
                <text
                  key={month}
                  x={LEFT_MARGIN + col * STEP}
                  y={12}
                  fill="var(--text-faint)"
                  fontSize={9}
                  fontFamily="inherit"
                >
                  {MONTHS[month]}
                </text>
              ))}

              {DAY_LABELS.map((lbl, i) =>
                lbl ? (
                  <text
                    key={i}
                    x={0}
                    y={TOP_MARGIN + i * STEP + CELL_SIZE - 1}
                    fill="var(--text-faint)"
                    fontSize={9}
                    fontFamily="inherit"
                  >
                    {lbl}
                  </text>
                ) : null,
              )}

              {cells.map((cell) => (
                <rect
                  key={cell.date}
                  x={LEFT_MARGIN + cell.col * STEP}
                  y={TOP_MARGIN + cell.row * STEP}
                  width={CELL_SIZE}
                  height={CELL_SIZE}
                  rx={2}
                  ry={2}
                  fill={getColor(cell.count, minCount, maxCount)}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) => {
                    const rect = (e.target as SVGRectElement).getBoundingClientRect();
                    const parent = (e.target as SVGRectElement).closest('.relative')!.getBoundingClientRect();
                    setHoveredDay(cell.date);
                    setTooltip({
                      x: rect.left - parent.left + rect.width / 2,
                      y: rect.top - parent.top - 4,
                      text: `${formatDate(cell.date)}: ${cell.count} geocoded records`,
                    });
                  }}
                  onMouseLeave={() => {
                    setTooltip(null);
                    setHoveredDay(null);
                  }}
                />
              ))}
            </svg>

            {tooltip && (
              <div
                className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg px-2.5 py-1.5 text-[11px] font-medium whitespace-nowrap"
                style={{
                  left: tooltip.x,
                  top: tooltip.y,
                  background: 'rgba(0, 0, 0, 0.88)',
                  color: '#fff',
                }}
              >
                {tooltip.text}
              </div>
            )}
          </div>

          <GeocodeHoverMap label={mapLabel} points={mapPoints} isHoveringDay={!!hoveredDay} />

          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
              {totalRecords.toLocaleString('de-DE')} geocoded records on {totalDays} days in {selectedYear}
              {selectedBl ? ` (${label})` : ''}
            </span>
            <div className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--text-faint)' }}>
              <span>Less</span>
              {[COLOR_EMPTY, COLOR_LOW, COLOR_MED, COLOR_HIGH].map((color, i) => (
                <span
                  key={i}
                  className="inline-block rounded-sm"
                  style={{ width: 10, height: 10, background: color }}
                />
              ))}
              <span>More</span>
            </div>
          </div>
        </div>

        <GeocodeStats
          selectedYear={selectedYear}
          selectedBl={selectedBl}
          activeDayData={activeDayData}
        />
      </div>
    </div>
  );
}
