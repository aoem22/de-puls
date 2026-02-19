'use client';

import { useMemo, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import type { MiniMapPoint } from './DashboardMiniMap';
import type { DashboardLiveFeedItem } from '@/lib/dashboard/types';

// Dynamic import — MapLibre requires DOM (no SSR)
const DashboardMiniMap = dynamic(
  () => import('./DashboardMiniMap').then((mod) => mod.DashboardMiniMap),
  { ssr: false },
);

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

interface KreisPoint {
  kreis_ags: string;
  lat: number;
  lon: number;
}

interface TopPlz {
  plz: string;
  count: number;
  previousCount: number;
  rankChange: number | null;
}

interface PlzPoint {
  plz: string;
  lat: number;
  lon: number;
}

interface CityLeaguePanelProps {
  topCities: TopCity[];
  topCityPoints: CityPoint[];
  topKreisPoints: KreisPoint[];
  topPlz: TopPlz[];
  topPlzPoints: PlzPoint[];
  periodLabel: string;
  categoryLabel: string;
  isYearView: boolean;
  selectedCity: string | null;
  selectedPlz: string | null;
  onCityClick: (city: string) => void;
  onPlzClick: (plz: string) => void;
  filterMode: RanglisteFilterMode;
  onFilterModeChange: (mode: RanglisteFilterMode) => void;
  liveFeedItems?: DashboardLiveFeedItem[];
  onFeedItemClick?: (feedId: string) => void;
  bundeslandCounts?: Record<string, number>;
  bundeslandFilter?: string | null;
  onBundeslandFilterChange?: (bundesland: string | null) => void;
  focusCategoryLabel?: string | null;
  weaponFilterLabel?: string | null;
}

// Generic row for the reusable table
interface LeagueRow {
  key: string;
  label: string;
  count: number;
  rankChange: number | null;
}

export type RanglisteFilterMode = 'staedte' | 'plz' | 'bundesland';

const FILTER_TABS: Array<{ mode: RanglisteFilterMode; label: string }> = [
  { mode: 'staedte', label: 'Stadt' },
  { mode: 'plz', label: 'PLZ' },
  { mode: 'bundesland', label: 'Bundesland' },
];

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
  nameHeader,
  rows,
  isYearView,
  hoveredKey,
  onHover,
  selectedKey,
  onSelect,
}: {
  nameHeader: string;
  rows: LeagueRow[];
  isYearView: boolean;
  hoveredKey: string | null;
  onHover: (key: string | null) => void;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <p
        className="rounded-lg border px-3 py-2 text-xs"
        style={{ borderColor: 'var(--border-inner)', color: 'var(--text-faint)' }}
      >
        Keine Daten
      </p>
    );
  }

  return (
    <>
      <div className="space-y-1.5 md:hidden">
        {rows.map((row, idx) => {
          const isSelected = selectedKey === row.key;
          return (
            <button
              key={row.key}
              type="button"
              onClick={() => onSelect(row.key)}
              className="w-full rounded-lg border px-3 py-2 text-left transition-colors"
              style={{
                borderColor: isSelected ? 'var(--accent)' : 'var(--border-inner)',
                background: isSelected
                  ? 'color-mix(in srgb, var(--accent) 15%, transparent)'
                  : idx % 2 === 0
                    ? 'var(--card)'
                    : 'var(--card-inner)',
              }}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums"
                  style={{
                    color: idx < 3 ? 'var(--accent)' : 'var(--text-muted)',
                    background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                  }}
                >
                  {idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {row.label}
                  </p>
                </div>
                {!isYearView && (
                  <span className="shrink-0">
                    <RankArrow change={row.rankChange} isYearView={isYearView} />
                  </span>
                )}
                <span className="shrink-0 text-sm font-semibold tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                  {row.count.toLocaleString('de-DE')}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="hidden overflow-x-auto md:block">
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
              const isSelected = selectedKey === row.key;
              return (
                <tr
                  key={row.key}
                  onMouseEnter={() => onHover(row.key)}
                  onMouseLeave={() => onHover(null)}
                  onClick={() => onSelect(row.key)}
                  className="cursor-pointer transition-colors"
                  style={{
                    background: isSelected
                      ? 'color-mix(in srgb, var(--accent) 15%, transparent)'
                      : isHovered
                        ? 'color-mix(in srgb, var(--accent) 8%, transparent)'
                        : idx % 2 === 0
                          ? 'var(--card)'
                          : 'var(--card-inner)',
                    borderLeft: isSelected
                      ? '2px solid var(--accent)'
                      : isHovered
                        ? '2px solid color-mix(in srgb, var(--accent) 50%, transparent)'
                        : '2px solid transparent',
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
    </>
  );
}

// ────────────────────────── Main Panel ──────────────────────────

export function CityLeaguePanel({
  topCities,
  topCityPoints,
  topKreisPoints,
  topPlz,
  topPlzPoints,
  periodLabel,
  categoryLabel,
  isYearView,
  selectedCity,
  selectedPlz,
  onCityClick,
  onPlzClick,
  filterMode,
  onFilterModeChange,
  liveFeedItems = [],
  onFeedItemClick,
  bundeslandCounts,
  bundeslandFilter,
  onBundeslandFilterChange,
  focusCategoryLabel,
  weaponFilterLabel,
}: CityLeaguePanelProps) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  // ── Derive rows per mode ──

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

  const plzRows: LeagueRow[] = useMemo(
    () =>
      topPlz.map((p) => ({
        key: p.plz,
        label: p.plz,
        count: p.count,
        rankChange: p.rankChange,
      })),
    [topPlz],
  );

  const bundeslandRows: LeagueRow[] = useMemo(
    () =>
      bundeslandCounts
        ? Object.entries(bundeslandCounts)
            .filter(([, count]) => count > 0)
            .sort(([, a], [, b]) => b - a)
            .map(([bl, count]) => ({
              key: bl,
              label: bl,
              count,
              rankChange: null,
            }))
        : [],
    [bundeslandCounts],
  );

  // ── Merge ALL points into one array for the map ──
  // Each point gets a groupKey based on the current filter mode.
  // Points from other modes get '__bg__' so they show but don't highlight.

  const allMapPoints: MiniMapPoint[] = useMemo(() => {
    const seen = new Set<string>();
    const merged: MiniMapPoint[] = [];

    const pushPoint = (lat: number, lon: number, groupKey: string) => {
      const dedupKey = `${lat.toFixed(4)}:${lon.toFixed(4)}`;
      if (seen.has(dedupKey)) return;
      seen.add(dedupKey);
      merged.push({ lat, lon, groupKey });
    };

    for (const pt of topCityPoints) {
      pushPoint(pt.lat, pt.lon, filterMode === 'staedte' ? pt.city : '__bg__');
    }

    for (const pt of topKreisPoints) {
      pushPoint(pt.lat, pt.lon, '__bg__');
    }

    for (const pt of topPlzPoints) {
      pushPoint(pt.lat, pt.lon, filterMode === 'plz' ? pt.plz : '__bg__');
    }

    return merged;
  }, [topCityPoints, topKreisPoints, topPlzPoints, filterMode]);

  // Always keep all aggregate dots; overlay individual feed dots when zoomed in
  const mapPointsForMiniMap: MiniMapPoint[] = useMemo(() => {
    if (selectedCity || selectedPlz) {
      const feedDots: MiniMapPoint[] = liveFeedItems.flatMap((item) => {
        if (item.latitude == null || item.longitude == null) return [];
        return [{
          lat: item.latitude,
          lon: item.longitude,
          groupKey: `feed:${item.id}`,
        }];
      });
      if (feedDots.length > 0) return [...allMapPoints, ...feedDots];
    }
    return allMapPoints;
  }, [selectedCity, selectedPlz, liveFeedItems, allMapPoints]);

  // Handle clicks on map dots — feed dots trigger scroll, aggregate dots trigger selection
  const handlePointClick = useCallback((pointIndex: number) => {
    const pt = mapPointsForMiniMap[pointIndex];
    if (!pt) return;
    if (pt.groupKey.startsWith('feed:') && onFeedItemClick) {
      const feedId = pt.groupKey.slice(5); // strip 'feed:' prefix
      onFeedItemClick(feedId);
    }
  }, [mapPointsForMiniMap, onFeedItemClick]);

  // ── Selection handling per mode ──

  const handleSelect = useCallback((key: string) => {
    switch (filterMode) {
      case 'staedte':
        onCityClick(key);
        break;
      case 'plz':
        onPlzClick(key);
        break;
      case 'bundesland':
        onBundeslandFilterChange?.(bundeslandFilter === key ? null : key);
        break;
    }
  }, [filterMode, onCityClick, onPlzClick, onBundeslandFilterChange, bundeslandFilter]);

  // Clear other-mode selections when switching tabs
  const handleTabChange = useCallback((mode: RanglisteFilterMode) => {
    onFilterModeChange(mode);
    setHoveredKey(null);
  }, [onFilterModeChange]);

  // ── Active rows + selection key based on mode ──

  const { activeRows, nameHeader, selectedKey } = useMemo(() => {
    switch (filterMode) {
      case 'staedte':
        return {
          activeRows: cityRows,
          nameHeader: 'Stadt',
          selectedKey: selectedCity,
        };
      case 'plz':
        return {
          activeRows: plzRows,
          nameHeader: 'PLZ',
          selectedKey: selectedPlz,
        };
      case 'bundesland':
        return {
          activeRows: bundeslandRows,
          nameHeader: 'Bundesland',
          selectedKey: bundeslandFilter ?? null,
        };
    }
  }, [
    filterMode, cityRows, plzRows, bundeslandRows,
    selectedCity, selectedPlz, bundeslandFilter,
  ]);

  const hasData = cityRows.length > 0 || plzRows.length > 0 || bundeslandRows.length > 0;

  if (!hasData) {
    return (
      <article
        className="rounded-2xl border p-3 sm:p-4"
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
      className="overflow-hidden rounded-2xl border p-3 sm:p-4"
      style={{
        borderColor: 'var(--border-subtle)',
        background: 'linear-gradient(145deg, var(--card) 0%, var(--card-elevated) 100%)',
      }}
    >
      {/* Header row: title + filter tags (left) | segmented control (right) */}
      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-3">
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
        {focusCategoryLabel && (
          <span
            className="rounded-md px-2 py-0.5 text-[10px] font-bold"
            style={{
              background: 'color-mix(in srgb, var(--text-muted) 12%, transparent)',
              color: 'var(--text-secondary)',
            }}
          >
            {focusCategoryLabel}
          </span>
        )}
        {weaponFilterLabel && (
          <span
            className="rounded-md px-2 py-0.5 text-[10px] font-bold"
            style={{
              background: 'color-mix(in srgb, var(--text-muted) 12%, transparent)',
              color: 'var(--text-secondary)',
            }}
          >
            {weaponFilterLabel}
          </span>
        )}

        {/* Spacer pushes segmented control right on desktop */}
        <div className="hidden sm:block sm:flex-1" />

        {/* Segmented control */}
        <div className="inline-flex w-full shrink-0 rounded-lg border p-1 sm:w-auto" style={{ borderColor: 'var(--border-inner)' }}>
          {FILTER_TABS.map((tab) => {
            const active = filterMode === tab.mode;
            return (
              <button
                key={tab.mode}
                onClick={() => handleTabChange(tab.mode)}
                className="flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors sm:flex-none"
                style={{
                  background: active
                    ? 'color-mix(in srgb, var(--accent) 20%, transparent)'
                    : 'transparent',
                  color: active ? 'var(--accent)' : 'var(--text-muted)',
                  border: active
                    ? '1px solid color-mix(in srgb, var(--accent) 35%, transparent)'
                    : '1px solid transparent',
                }}
              >
                {active && '\u25CF '}
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Separator between header and content — negative margins to hit card edges */}
      <div
        className="-mx-3 mt-3 sm:-mx-4"
        style={{ borderTop: '1px solid var(--border-inner)' }}
      />

      {/* Grid: Table left | separator | Map right */}
      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto_1fr] lg:gap-0">
        {/* Table */}
        <div className="min-w-0 lg:pr-4">
          <LeagueTable
            nameHeader={nameHeader}
            rows={activeRows}
            isYearView={filterMode === 'bundesland' || isYearView}
            hoveredKey={hoveredKey}
            onHover={setHoveredKey}
            selectedKey={selectedKey}
            onSelect={handleSelect}
          />
        </div>

        {/* Vertical separator (desktop only) — extends top to horizontal rule, bottom to card edge */}
        <div
          className="hidden lg:block -mt-3 -mb-3 sm:-mb-4"
          style={{ width: 1, background: 'var(--border-inner)' }}
        />

        {/* Mini Map — fills its separator-enclosed box with no whitespace */}
        <div
          className="hidden overflow-hidden md:block -mr-3 sm:-mr-4 -mb-3 sm:-mb-4 lg:-mt-3"
          style={{ background: 'var(--card-inner)', minHeight: 280 }}
        >
          <DashboardMiniMap
            points={mapPointsForMiniMap}
            hoveredKey={hoveredKey}
            selectedKey={selectedKey}
            className="h-full w-full"
            onPointClick={(selectedCity || selectedPlz) ? handlePointClick : undefined}
          />
        </div>
      </div>
    </article>
  );
}
