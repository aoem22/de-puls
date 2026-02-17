'use client';

import { useMemo, useState } from 'react';
import germanyBoundary from '../../../lib/data/geo/germany-boundary.json';

// ────────────────────────── Types ──────────────────────────

interface TopCity {
  city: string;
  count: number;
  previousCount: number;
  rankChange: number | null;
}

interface CityPoint {
  city: string;
  lat: number;
  lon: number;
}

interface TopKreis {
  kreisAgs: string;
  kreisName: string;
  count: number;
  previousCount: number;
  rankChange: number | null;
}

interface KreisPoint {
  kreis_ags: string;
  lat: number;
  lon: number;
}

interface CityLeaguePanelProps {
  topCities: TopCity[];
  topCityPoints: CityPoint[];
  topKreise: TopKreis[];
  topKreisPoints: KreisPoint[];
  periodLabel: string;
  categoryLabel: string;
  isYearView: boolean;
}

// Generic row for the reusable table
interface LeagueRow {
  key: string;
  label: string;
  count: number;
  rankChange: number | null;
}

// ────────────────────────── Projection ──────────────────────────

const LON_MIN = 5.85;
const LON_MAX = 15.05;
const LAT_MIN = 47.25;
const LAT_MAX = 55.1;

const SVG_W = 300;
const SVG_H = 380;
const PAD = 12;

function projectX(lon: number): number {
  return PAD + ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * (SVG_W - 2 * PAD);
}

function projectY(lat: number): number {
  return PAD + ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * (SVG_H - 2 * PAD);
}

// ────────────────────────── SVG Germany outline ──────────────────────────

function buildGermanyPath(): string {
  const geometry = (germanyBoundary as unknown as GeoJSON.Feature<GeoJSON.MultiPolygon>).geometry;
  const outerRing = geometry.coordinates[0][0];

  const parts: string[] = [];
  for (let i = 0; i < outerRing.length; i++) {
    const [lon, lat] = outerRing[i];
    const x = projectX(lon).toFixed(1);
    const y = projectY(lat).toFixed(1);
    parts.push(i === 0 ? `M${x},${y}` : `L${x},${y}`);
  }
  parts.push('Z');
  return parts.join('');
}

// ────────────────────────── Shared sub-components ──────────────────────────

function RankArrow({ change, isYearView }: { change: number | null; isYearView: boolean }) {
  if (isYearView || change === null) {
    return (
      <span
        className="inline-flex w-8 items-center justify-center text-[11px] font-semibold"
        style={{ color: 'var(--text-faint)' }}
      >
        {isYearView ? '' : 'NEU'}
      </span>
    );
  }
  if (change === 0) {
    return (
      <span
        className="inline-flex w-8 items-center justify-center text-[11px] font-semibold"
        style={{ color: 'var(--text-faint)' }}
      >
        &mdash;
      </span>
    );
  }
  const up = change > 0;
  return (
    <span
      className="inline-flex w-8 items-center justify-center gap-0.5 text-[11px] font-bold tabular-nums"
      style={{ color: up ? '#22c55e' : '#ef4444' }}
    >
      {up ? '\u25B2' : '\u25BC'}
      {Math.abs(change)}
    </span>
  );
}

function LeagueTable({
  title,
  nameHeader,
  rows,
  isYearView,
  hoveredKey,
  onHover,
}: {
  title: string;
  nameHeader: string;
  rows: LeagueRow[];
  isYearView: boolean;
  hoveredKey: string | null;
  onHover: (key: string | null) => void;
}) {
  if (rows.length === 0) {
    return (
      <div>
        <h3
          className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em]"
          style={{ color: 'var(--text-faint)' }}
        >
          {title}
        </h3>
        <p
          className="rounded-lg border px-3 py-2 text-xs"
          style={{ borderColor: 'var(--border-inner)', color: 'var(--text-faint)' }}
        >
          Keine Daten
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <h3
        className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em]"
        style={{ color: 'var(--text-faint)' }}
      >
        {title}
      </h3>
      <table className="w-full text-sm" style={{ borderCollapse: 'separate', borderSpacing: '0 2px' }}>
        <thead>
          <tr
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-faint)' }}
          >
            <th className="w-7 pb-1 text-center">#</th>
            <th className="pb-1 text-left">{nameHeader}</th>
            {!isYearView && <th className="w-10 pb-1 text-center">Trend</th>}
            <th className="w-14 pb-1 text-right">Vorf.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const isHovered = hoveredKey === row.key;
            return (
              <tr
                key={row.key}
                onMouseEnter={() => onHover(row.key)}
                onMouseLeave={() => onHover(null)}
                className="cursor-default transition-colors"
                style={{
                  background: isHovered
                    ? 'color-mix(in srgb, var(--accent) 8%, transparent)'
                    : idx % 2 === 0
                      ? 'var(--card)'
                      : 'var(--card-inner)',
                  borderLeft: isHovered ? '2px solid var(--accent)' : '2px solid transparent',
                }}
              >
                <td
                  className="rounded-l-md py-1 text-center text-xs font-bold tabular-nums"
                  style={{ color: idx < 3 ? 'var(--accent)' : 'var(--text-muted)' }}
                >
                  {idx + 1}
                </td>
                <td
                  className="truncate py-1 text-[13px]"
                  style={{ color: 'var(--text-primary)', maxWidth: 140 }}
                >
                  {row.label}
                </td>
                {!isYearView && (
                  <td className="py-1 text-center">
                    <RankArrow change={row.rankChange} isYearView={isYearView} />
                  </td>
                )}
                <td
                  className="rounded-r-md py-1 text-right font-semibold tabular-nums text-[13px]"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {row.count.toLocaleString('de-DE')}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ────────────────────────── Mini Map ──────────────────────────

function GermanyMiniMap({
  cityPoints,
  kreisPoints,
  hoveredKey,
  hoveredSource,
}: {
  cityPoints: CityPoint[];
  kreisPoints: KreisPoint[];
  hoveredKey: string | null;
  hoveredSource: 'city' | 'kreis' | null;
}) {
  const germanyPath = useMemo(() => buildGermanyPath(), []);

  const cityGroups = useMemo(() => {
    const map = new Map<string, Array<{ x: number; y: number }>>();
    for (const pt of cityPoints) {
      const arr = map.get(pt.city) ?? [];
      arr.push({ x: projectX(pt.lon), y: projectY(pt.lat) });
      map.set(pt.city, arr);
    }
    return map;
  }, [cityPoints]);

  const kreisGroups = useMemo(() => {
    const map = new Map<string, Array<{ x: number; y: number }>>();
    for (const pt of kreisPoints) {
      const arr = map.get(pt.kreis_ags) ?? [];
      arr.push({ x: projectX(pt.lon), y: projectY(pt.lat) });
      map.set(pt.kreis_ags, arr);
    }
    return map;
  }, [kreisPoints]);

  // Show the dot set that matches the hovered source, or city dots by default
  const activeGroups = hoveredSource === 'kreis' ? kreisGroups : cityGroups;

  return (
    <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="h-full w-full">
      <defs>
        <filter id="dot-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <path d={germanyPath} fill="#1a1a1a" stroke="#333" strokeWidth="1.2" />

      {Array.from(activeGroups.entries()).map(([key, coords]) => {
        const isHovered = hoveredKey === key;
        const dimmed = hoveredKey != null && !isHovered;

        return coords.map((pt, i) => (
          <circle
            key={`${key}-${i}`}
            cx={pt.x}
            cy={pt.y}
            r={isHovered ? 3.5 : 1.5}
            fill="var(--accent)"
            opacity={dimmed ? 0.12 : isHovered ? 1 : 0.45}
            filter={isHovered ? 'url(#dot-glow)' : undefined}
            className={isHovered ? 'league-dot-pulse' : undefined}
            style={{ transition: 'r 0.2s, opacity 0.2s' }}
          />
        ));
      })}
    </svg>
  );
}

// ────────────────────────── Main Panel ──────────────────────────

export function CityLeaguePanel({
  topCities,
  topCityPoints,
  topKreise,
  topKreisPoints,
  periodLabel,
  categoryLabel,
  isYearView,
}: CityLeaguePanelProps) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [hoveredSource, setHoveredSource] = useState<'city' | 'kreis' | null>(null);

  const cityRows: LeagueRow[] = useMemo(
    () =>
      topCities.map((c) => ({
        key: c.city,
        label: c.city,
        count: c.count,
        rankChange: c.rankChange,
      })),
    [topCities],
  );

  const kreisRows: LeagueRow[] = useMemo(
    () =>
      topKreise.map((k) => ({
        key: k.kreisAgs,
        label: k.kreisName,
        count: k.count,
        rankChange: k.rankChange,
      })),
    [topKreise],
  );

  const hasData = topCities.length > 0 || topKreise.length > 0;

  if (!hasData) {
    return (
      <article
        className="rounded-2xl border p-4"
        style={{
          borderColor: 'var(--border-subtle)',
          background: 'linear-gradient(145deg, var(--card) 0%, var(--card-elevated) 100%)',
        }}
      >
        <h2
          className="text-[11px] font-bold uppercase tracking-[0.2em]"
          style={{ color: 'var(--text-faint)' }}
        >
          Rangliste
        </h2>
        <p
          className="mt-3 rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--border-inner)', color: 'var(--text-faint)' }}
        >
          Keine Daten im gew&auml;hlten Zeitraum.
        </p>
      </article>
    );
  }

  return (
    <article
      className="rounded-2xl border p-4"
      style={{
        borderColor: 'var(--border-subtle)',
        background: 'linear-gradient(145deg, var(--card) 0%, var(--card-elevated) 100%)',
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <h2
          className="text-[11px] font-bold uppercase tracking-[0.2em]"
          style={{ color: 'var(--text-faint)' }}
        >
          Rangliste
        </h2>
        <span
          className="rounded-md px-2 py-0.5 text-[10px] font-bold"
          style={{
            background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
            color: 'var(--accent)',
          }}
        >
          {periodLabel}
        </span>
        <span className="ml-auto text-[10px]" style={{ color: 'var(--text-faint)' }}>
          {categoryLabel}
        </span>
      </div>

      {/* Grid: City Table | Sep | Kreis Table | Sep | Map */}
      <div className="mt-3 grid gap-0 lg:grid-cols-[1fr_auto_1fr_auto_0.8fr]">
        {/* City table */}
        <div className="pr-3">
          <LeagueTable
            title="Top St&auml;dte"
            nameHeader="Stadt"
            rows={cityRows}
            isYearView={isYearView}
            hoveredKey={hoveredSource === 'city' ? hoveredKey : null}
            onHover={(key) => {
              setHoveredKey(key);
              setHoveredSource(key ? 'city' : null);
            }}
          />
        </div>

        {/* Separator */}
        <div
          className="my-4 lg:my-0 hidden lg:block"
          style={{ width: 1, background: 'var(--border-subtle)' }}
        />

        {/* Kreis table */}
        <div className="mt-4 lg:mt-0 lg:px-3">
          <LeagueTable
            title="Top Kreise"
            nameHeader="Kreis"
            rows={kreisRows}
            isYearView={isYearView}
            hoveredKey={hoveredSource === 'kreis' ? hoveredKey : null}
            onHover={(key) => {
              setHoveredKey(key);
              setHoveredSource(key ? 'kreis' : null);
            }}
          />
        </div>

        {/* Separator */}
        <div
          className="hidden lg:block"
          style={{ width: 1, background: 'var(--border-subtle)' }}
        />

        {/* Germany Mini Map (hidden on mobile) */}
        <div
          className="hidden lg:flex items-center justify-center rounded-xl pl-3"
          style={{ background: '#0a0a0a' }}
        >
          <GermanyMiniMap
            cityPoints={topCityPoints}
            kreisPoints={topKreisPoints}
            hoveredKey={hoveredKey}
            hoveredSource={hoveredSource}
          />
        </div>
      </div>
    </article>
  );
}
