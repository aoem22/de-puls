'use client';

import type { DashboardTimeframe, SecurityOverviewResponse } from '@/lib/dashboard/types';
import { DASHBOARD_TIMEFRAME_OPTIONS } from '@/lib/dashboard/timeframes';
import { CRIME_CATEGORIES, type CrimeCategory } from '@/lib/types/crime';
import { WeaponIcon } from '@/components/Map/BlaulichtPlaybackControl';

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

interface BundeslandChip {
  key: string;
  label: string;
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
  bundeslandChips: BundeslandChip[];
  bundeslandFilter: string | null;
  onBundeslandFilterChange: (bundesland: string | null) => void;
  categoryChips: SecurityOverviewResponse['categoryCounts'];
  weaponChips: WeaponChip[];
  drugChips: DrugChip[];
  incidentsCurrent: number | null | undefined;
  totalRecords2026: number | null | undefined;
  isDark: boolean;
  onToggleTheme: () => void;
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
  bundeslandChips,
  bundeslandFilter,
  onBundeslandFilterChange,
  categoryChips,
  weaponChips,
  drugChips,
  incidentsCurrent,
  totalRecords2026,
  isDark,
  onToggleTheme,
}: DashboardTopControlsProps) {
  return (
    <section
      className="dashboard-rise rounded-[2rem] border p-5 sm:p-8"
      style={{
        borderColor: 'var(--border-subtle)',
        background: 'linear-gradient(145deg, var(--card) 0%, var(--card-elevated) 100%)',
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--text-faint)' }}>
            Sicherheits-Dashboard Deutschland
          </p>
          <h1 className="mt-2 text-[clamp(2rem,5vw,3.3rem)] font-bold leading-[1.02]" style={{ color: 'var(--text-primary)' }}>
            Sicherheitslage im Überblick
          </h1>
          <p className="mt-3 max-w-2xl text-sm sm:text-base" style={{ color: 'var(--text-secondary)' }}>
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
          className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors"
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

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {DASHBOARD_TIMEFRAME_OPTIONS.map((option) => {
          const active = timeframe === option.key;
          const isLive = option.key === 'today';
          return (
            <button
              key={option.key}
              onClick={() => onTimeframeChange(option.key)}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors"
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
      </div>

      <div className="mt-5">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--text-faint)' }}>
          Delikte
        </p>
        <div className="-mx-5 px-5 sm:-mx-8 sm:px-8 md:mx-0 md:px-0 flex gap-1.5 overflow-x-auto md:flex-wrap md:overflow-x-visible scrollbar-hide">
          <button
            onClick={() => onFocusCategoryChange(null)}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors"
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
                className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors"
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

      {weaponChips.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--text-faint)' }}>
            Tatmittel
          </p>
          <div className="-mx-5 px-5 sm:-mx-8 sm:px-8 md:mx-0 md:px-0 flex gap-1.5 overflow-x-auto md:flex-wrap md:overflow-x-visible scrollbar-hide">
            {weaponChips.map((item) => {
              const active = weaponFilter === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => onWeaponFilterChange(active ? null : item.key)}
                  className="inline-flex flex-shrink-0 items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-semibold transition-all duration-200 ease-out"
                  style={{
                    borderColor: active ? '#ef4444' : 'var(--border-subtle)',
                    background: active ? 'rgba(239,68,68,0.12)' : 'var(--card)',
                    color: active ? '#ef4444' : 'var(--text-secondary)',
                  }}
                >
                  {/* Icon: visible when inactive, collapses when active */}
                  <span
                    className={`inline-flex items-center justify-center transition-all duration-200 ease-out ${
                      active ? 'max-w-0 overflow-hidden opacity-0' : 'max-w-[24px] opacity-100'
                    }`}
                  >
                    <WeaponIcon type={item.key} className="text-[18px]" />
                  </span>
                  {/* Label + count: hidden when inactive, expands when active */}
                  <span
                    className={`overflow-hidden whitespace-nowrap transition-all duration-200 ease-out ${
                      active ? 'max-w-[10rem] opacity-100' : 'max-w-0 opacity-0'
                    }`}
                  >
                    {item.label}
                    <span className="tabular-nums opacity-60 ml-1">{item.count.toLocaleString('de-DE')}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {bundeslandChips.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--text-faint)' }}>
            Bundesland
          </p>
          <div className="-mx-5 px-5 sm:-mx-8 sm:px-8 md:mx-0 md:px-0 flex gap-1.5 overflow-x-auto md:flex-wrap md:overflow-x-visible scrollbar-hide">
            {bundeslandChips.map((item) => {
              const active = bundeslandFilter === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => onBundeslandFilterChange(active ? null : item.key)}
                  className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors"
                  style={{
                    borderColor: active ? '#3b82f6' : 'var(--border-subtle)',
                    background: active ? 'rgba(59,130,246,0.12)' : 'var(--card)',
                    color: active ? '#3b82f6' : 'var(--text-secondary)',
                  }}
                >
                  {item.label}
                  <span className="tabular-nums opacity-60">{item.count.toLocaleString('de-DE')}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {focusCategory === 'drugs' && drugChips.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--text-faint)' }}>
            Drogenart
          </p>
          <div className="-mx-5 px-5 sm:-mx-8 sm:px-8 md:mx-0 md:px-0 flex gap-1.5 overflow-x-auto md:flex-wrap md:overflow-x-visible scrollbar-hide">
            {drugChips.map((item) => {
              const active = drugFilter === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => onDrugFilterChange(active ? null : item.key)}
                  className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors"
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
    </section>
  );
}
