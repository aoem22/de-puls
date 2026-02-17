'use client';

import { useState } from 'react';
import { CityLeaguePanel } from './CityLeaguePanel';
import { Footer } from './Footer';
import { DashboardTopControls } from './DashboardTopControls';
import { DashboardSnapshotGrid } from './DashboardSnapshotGrid';
import { DashboardLiveFeedSection } from './DashboardLiveFeedSection';
import { useSecurityOverview } from '@/lib/supabase/hooks';
import type { DashboardTimeframe } from '@/lib/dashboard/types';
import {
  CRIME_CATEGORIES,
  DRUG_LABELS as DRUG_LABELS_TYPED,
  WEAPON_LABELS as WEAPON_LABELS_TYPED,
  type CrimeCategory,
} from '@/lib/types/crime';
import { useTheme } from '@/lib/theme';

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

function buildWeaponChips(weaponCounts?: Record<string, number>): WeaponChip[] {
  if (!weaponCounts) return [];

  return Object.entries(weaponCounts)
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1])
    .map(([key, count]) => ({
      key,
      label: WEAPON_LABELS_TYPED[key]?.de ?? key,
      count,
    }));
}

function buildDrugChips(drugCounts?: Record<string, number>): DrugChip[] {
  if (!drugCounts) return [];

  return Object.entries(drugCounts)
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1])
    .map(([key, count]) => ({
      key,
      label: DRUG_LABELS_TYPED[key]?.de ?? key,
      icon: DRUG_LABELS_TYPED[key]?.icon ?? '💊',
      count,
    }));
}

function categoryLabel(category: CrimeCategory | null): string {
  if (!category) return 'Alle Kategorien';
  return CRIME_CATEGORIES.find((item) => item.key === category)?.label ?? category;
}

export function DashboardPage() {
  const [focusCategory, setFocusCategory] = useState<CrimeCategory | null>(null);
  const [weaponFilter, setWeaponFilter] = useState<string | null>(null);
  const [drugFilter, setDrugFilter] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<DashboardTimeframe>('year_to_date');
  const [feedPage, setFeedPage] = useState(1);
  const effectiveDrugFilter = focusCategory === 'drugs' ? drugFilter : null;

  const { data, isLoading, error } = useSecurityOverview(
    focusCategory,
    timeframe,
    feedPage,
    weaponFilter,
    effectiveDrugFilter,
  );
  const { theme, toggleTheme } = useTheme();

  const isStale = data != null && (
    data.focusCategory !== focusCategory
    || data.period.timeframe !== timeframe
    || data.weaponFilter !== weaponFilter
    || data.drugFilter !== effectiveDrugFilter
  );
  const showLoading = isLoading || isStale;

  const categoryChips = data?.categoryCounts ?? [];
  const weaponChips = buildWeaponChips(data?.weaponCounts);
  const drugChips = buildDrugChips(data?.drugCounts);
  const periodLabel = data?.period.label ?? 'Zeitraum';
  const previousLabel = data?.period.previousLabel ?? 'Vorperiode';
  const isYearView = timeframe === 'year_to_date';

  return (
    <div className="relative min-h-screen overflow-hidden" style={{ background: 'var(--background)' }}>
      <div className="pointer-events-none absolute inset-0">
        <div className="dashboard-orb dashboard-orb-a" />
        <div className="dashboard-orb dashboard-orb-b dashboard-orb-alt" />
      </div>

      <div className="relative z-10">
        <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-12 pt-8 sm:px-8 sm:pt-12">
          <DashboardTopControls
            timeframe={timeframe}
            onTimeframeChange={(nextTimeframe) => {
              setTimeframe(nextTimeframe);
              setFeedPage(1);
            }}
            focusCategory={focusCategory}
            onFocusCategoryChange={(nextCategory) => {
              setFocusCategory(nextCategory);
              if (nextCategory !== 'drugs') setDrugFilter(null);
              setFeedPage(1);
            }}
            weaponFilter={weaponFilter}
            onWeaponFilterChange={(nextWeaponFilter) => {
              setWeaponFilter(nextWeaponFilter);
              setFeedPage(1);
            }}
            drugFilter={focusCategory === 'drugs' ? drugFilter : null}
            onDrugFilterChange={(nextDrugFilter) => {
              setDrugFilter(nextDrugFilter);
              setFeedPage(1);
            }}
            categoryChips={categoryChips}
            weaponChips={weaponChips}
            drugChips={drugChips}
            incidentsCurrent={data?.snapshot.incidentsCurrent}
            totalRecords2026={data?.snapshot.totalRecords2026}
            isDark={theme === 'dark'}
            onToggleTheme={toggleTheme}
          />

          <DashboardSnapshotGrid
            showLoading={showLoading}
            focusCategory={focusCategory}
            isYearView={isYearView}
            previousLabel={previousLabel}
            snapshot={data?.snapshot}
            contextStats={data?.contextStats}
          />

          {error && (
            <div
              className="dashboard-rise dashboard-delay-1 rounded-xl border px-4 py-3 text-sm"
              style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}
            >
              Dashboard konnte nicht geladen werden: {error.message}
            </div>
          )}

          <section className="dashboard-rise dashboard-delay-2">
            {!showLoading && data ? (
              <CityLeaguePanel
                topCities={data.topCities}
                topCityPoints={data.topCityPoints}
                topKreise={data.topKreise}
                topKreisPoints={data.topKreisPoints}
                periodLabel={periodLabel}
                categoryLabel={categoryLabel(focusCategory)}
                isYearView={isYearView}
              />
            ) : (
              <div
                className="h-64 animate-pulse rounded-2xl border"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--loading-skeleton)' }}
              />
            )}
          </section>

          <DashboardLiveFeedSection
            showLoading={showLoading}
            periodLabel={periodLabel}
            feedPage={feedPage}
            onFeedPageChange={setFeedPage}
            liveFeed={data?.liveFeed ?? []}
            liveFeedTotal={data?.liveFeedTotal ?? 0}
            liveFeedPageSize={data?.liveFeedPageSize ?? 20}
          />
        </main>

        <Footer />
      </div>
    </div>
  );
}
