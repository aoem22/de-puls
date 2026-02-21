'use client';

import { useMemo } from 'react';
import type { DashboardTimeframe, SecurityOverviewResponse } from '@/lib/dashboard/types';
import { DASHBOARD_TIMEFRAME_OPTIONS, DASHBOARD_YEAR } from '@/lib/dashboard/timeframes';
import { CRIME_CATEGORIES, type CrimeCategory } from '@/lib/types/crime';
import { WeaponIcon } from '@/components/Map/BlaulichtPlaybackControl';
import { DashboardSearchBar } from './DashboardSearchBar';
import type { DashboardSearchResult, DashboardSearchFilters } from '@/lib/supabase';

const CATEGORY_CONFIG_MAP = new Map<string, (typeof CRIME_CATEGORIES)[number]>(
  CRIME_CATEGORIES.map((category) => [category.key, category]),
);

interface WeaponChip {
  key: string;
  label: string;
  count: number;
}

interface DrugChip {
  key: string;
  label: string;
  icon: string;
  count: number;
}

interface DashboardTopControlsProps {
  timeframe: DashboardTimeframe;
  onTimeframeChange: (timeframe: DashboardTimeframe) => void;
  focusCategory: CrimeCategory | null;
  onFocusCategoryChange: (category: CrimeCategory | null) => void;
  weaponFilter: string | null;
  onWeaponFilterChange: (weapon: string | null) => void;
  drugFilter: string | null;
  onDrugFilterChange: (drug: string | null) => void;
  categoryChips: SecurityOverviewResponse['categoryCounts'];
  weaponChips: WeaponChip[];
  drugChips: DrugChip[];
  incidentsCurrent: number | null | undefined;
  totalRecords2026: number | null | undefined;
  isDark: boolean;
  onToggleTheme: () => void;
  favoriteCount?: number;
  showFavoritesOnly?: boolean;
  onToggleFavoritesOnly?: () => void;
  onSearchResultSelect?: (result: DashboardSearchResult) => void;
}

export function DashboardTopControls({
  timeframe,
  onTimeframeChange,
  focusCategory,
  onFocusCategoryChange,
  weaponFilter,
  onWeaponFilterChange,
  drugFilter,
  onDrugFilterChange,
  categoryChips,
  weaponChips,
  drugChips,
  incidentsCurrent,
  totalRecords2026,
  isDark,
  onToggleTheme,
  favoriteCount,
  showFavoritesOnly,
  onToggleFavoritesOnly,
  onSearchResultSelect,
}: DashboardTopControlsProps) {
  const chipScrollerClass = '-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 scrollbar-hide scroll-touch sm:mx-0 sm:flex-wrap sm:overflow-x-visible sm:px-0 sm:pb-0';

  // Compute date range for the active timeframe (mirrors build-overview.ts logic)
  const searchFilters = useMemo((): DashboardSearchFilters => {
    const now = Date.now();
    const dayMs = 86_400_000;
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const ds = dayStart.getTime();

    let from: string | null = null;
    let to: string | null = null;

    switch (timeframe) {
      case 'today':
        from = new Date(ds).toISOString();
        to = new Date(ds + dayMs).toISOString();
        break;
      case 'yesterday':
        from = new Date(ds - dayMs).toISOString();
        to = new Date(ds).toISOString();
        break;
      case 'last_week': {
        const dow = dayStart.getUTCDay();
        const mondayOffset = dow === 0 ? 6 : dow - 1;
        const thisMonday = ds - mondayOffset * dayMs;
        from = new Date(thisMonday - 7 * dayMs).toISOString();
        to = new Date(thisMonday).toISOString();
        break;
      }
      case 'this_month':
        from = new Date(Date.UTC(dayStart.getUTCFullYear(), dayStart.getUTCMonth(), 1)).toISOString();
        to = new Date(Date.UTC(dayStart.getUTCFullYear(), dayStart.getUTCMonth() + 1, 1)).toISOString();
        break;
      case 'last_month':
        from = new Date(Date.UTC(dayStart.getUTCFullYear(), dayStart.getUTCMonth() - 1, 1)).toISOString();
        to = new Date(Date.UTC(dayStart.getUTCFullYear(), dayStart.getUTCMonth(), 1)).toISOString();
        break;
      case 'year_to_date':
        from = new Date(Date.UTC(DASHBOARD_YEAR, 0, 1)).toISOString();
        to = new Date(Date.UTC(DASHBOARD_YEAR + 1, 0, 1)).toISOString();
        break;
    }

    return {
      category: focusCategory,
      weapon: weaponFilter,
      drug: focusCategory === 'drugs' ? drugFilter : null,
      from,
      to,
    };
  }, [timeframe, focusCategory, weaponFilter, drugFilter]);

  return (
    <section
      className="dashboard-rise relative z-20 rounded-[1.5rem] border p-4 sm:rounded-[2rem] sm:p-8"
      style={{
        borderColor: 'var(--border-subtle)',
        background: 'linear-gradient(145deg, var(--card) 0%, var(--card-elevated) 100%)',
      }}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--text-faint)' }}>
            Sicherheits-Dashboard Deutschland
          </p>
          <h1 className="mt-2 text-[clamp(1.75rem,8vw,3.3rem)] font-bold leading-[1.04]" style={{ color: 'var(--text-primary)' }}>
            Adlerlicht
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed sm:text-base" style={{ color: 'var(--text-secondary)' }}>
            Über{' '}
            <span className="font-semibold tabular-nums" style={{ color: 'var(--accent)' }}>
              {totalRecords2026 != null
                ? totalRecords2026.toLocaleString('de-DE')
                : 'Tausende'}
            </span>{' '}
            Polizeimeldungen aus ganz Deutschland — live gesammelt,
            KI-strukturiert und kartiert. Dein datenbasierter Blick auf die Sicherheitslage 2026.
          </p>
        </div>
        <button
          onClick={onToggleTheme}
          className="inline-flex items-center gap-2 self-start rounded-xl border px-3 py-2 text-xs font-semibold transition-colors"
          style={{
            borderColor: 'var(--border-subtle)',
            background: 'var(--card)',
            color: 'var(--text-secondary)',
          }}
          aria-label={isDark ? 'Helles Design aktivieren' : 'Dunkles Design aktivieren'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {isDark ? (
              <>
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </>
            ) : (
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            )}
          </svg>
          {isDark ? 'Light' : 'Dark'}
        </button>
      </div>

      <div className="mt-5">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--text-faint)' }}>
          Delikte
        </p>
        <div className={chipScrollerClass}>
          <button
            onClick={() => onFocusCategoryChange(null)}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors"
            style={{
              borderColor: focusCategory === null ? 'var(--accent)' : 'var(--border-subtle)',
              background: focusCategory === null ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'var(--card)',
              color: focusCategory === null ? 'var(--accent)' : 'var(--text-secondary)',
            }}
          >
            Alle
            {incidentsCurrent != null && (
              <span className="tabular-nums opacity-60">{incidentsCurrent.toLocaleString('de-DE')}</span>
            )}
          </button>
          {categoryChips.map((item) => {
            const active = focusCategory === item.key;
            const config = CATEGORY_CONFIG_MAP.get(item.key);
            const catColor = config?.color ?? 'var(--text-secondary)';
            const catIcon = config?.icon ?? '';

            return (
              <button
                key={item.key}
                onClick={() => onFocusCategoryChange(item.key)}
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors"
                style={{
                  borderColor: active ? catColor : 'var(--border-subtle)',
                  background: active ? `color-mix(in srgb, ${catColor} 15%, transparent)` : 'var(--card)',
                  color: active ? catColor : 'var(--text-secondary)',
                }}
              >
                {catIcon && <span className="text-sm leading-none">{catIcon}</span>}
                {!catIcon && (
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ background: catColor }}
                  />
                )}
                {item.label}
                <span className="tabular-nums opacity-60">{item.count.toLocaleString('de-DE')}</span>
              </button>
            );
          })}
        </div>
      </div>

      {focusCategory === 'drugs' && drugChips.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--text-faint)' }}>
            Drogenart
          </p>
          <div className={chipScrollerClass}>
            {drugChips.map((item) => {
              const active = drugFilter === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => onDrugFilterChange(active ? null : item.key)}
                  className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors"
                  style={{
                    borderColor: active ? '#22c55e' : 'var(--border-subtle)',
                    background: active ? 'rgba(34,197,94,0.12)' : 'var(--card)',
                    color: active ? '#22c55e' : 'var(--text-secondary)',
                  }}
                >
                  <span className="text-sm leading-none">{item.icon}</span>
                  {item.label}
                  <span className="tabular-nums opacity-60">{item.count.toLocaleString('de-DE')}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {weaponChips.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--text-faint)' }}>
            Tatmittel
          </p>
          <div className={chipScrollerClass}>
            {weaponChips.map((item) => {
              const active = weaponFilter === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => onWeaponFilterChange(active ? null : item.key)}
                  className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors"
                  style={{
                    borderColor: active ? '#ef4444' : 'var(--border-subtle)',
                    background: active ? 'rgba(239,68,68,0.12)' : 'var(--card)',
                    color: active ? '#ef4444' : 'var(--text-secondary)',
                  }}
                >
                  <WeaponIcon type={item.key} className="text-[17px]" />
                  {item.label}
                  <span className="tabular-nums opacity-60">{item.count.toLocaleString('de-DE')}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-4 sm:mt-5">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--text-faint)' }}>
          Zeitraum
        </p>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-hide scroll-touch sm:mx-0 sm:flex-wrap sm:overflow-x-visible sm:px-0 sm:pb-0">
          {DASHBOARD_TIMEFRAME_OPTIONS.map((option) => {
          const active = timeframe === option.key;
          const isLive = option.key === 'today';
          return (
            <button
              key={option.key}
              onClick={() => onTimeframeChange(option.key)}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors"
              style={{
                borderColor: active ? (isLive ? '#ef4444' : 'var(--accent)') : 'var(--border-subtle)',
                background: active ? (isLive ? 'color-mix(in srgb, #ef4444 15%, transparent)' : 'color-mix(in srgb, var(--accent) 15%, transparent)') : 'var(--card)',
                color: active ? (isLive ? '#ef4444' : 'var(--accent)') : 'var(--text-secondary)',
              }}
            >
              {isLive && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                </span>
              )}
              {option.label}
            </button>
          );
        })}
          {onToggleFavoritesOnly && (
            <button
              onClick={onToggleFavoritesOnly}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors"
              style={{
                borderColor: showFavoritesOnly ? '#f59e0b' : 'var(--border-subtle)',
                background: showFavoritesOnly ? 'rgba(245,158,11,0.15)' : 'var(--card)',
                color: showFavoritesOnly ? '#f59e0b' : 'var(--text-secondary)',
              }}
              aria-label="Nur Favoriten anzeigen"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill={showFavoritesOnly ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              Favoriten
              {(favoriteCount ?? 0) > 0 && (
                <span className="tabular-nums opacity-60">{favoriteCount}</span>
              )}
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 sm:mt-5">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--text-faint)' }}>
          Suche
        </p>
        <DashboardSearchBar onResultSelect={onSearchResultSelect} filters={searchFilters} />
      </div>
    </section>
  );
}
