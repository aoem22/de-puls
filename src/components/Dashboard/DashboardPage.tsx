'use client';

import { useCallback, useMemo, useState } from 'react';
import { CityLeaguePanel, type RanglisteFilterMode } from './CityLeaguePanel';
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
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [selectedPlz, setSelectedPlz] = useState<string | null>(null);
  const [bundeslandFilter, setBundeslandFilter] = useState<string | null>(null);
  const [ranglisteMode, setRanglisteMode] = useState<RanglisteFilterMode>('staedte');
  const [highlightedFeedId, setHighlightedFeedId] = useState<string | null>(null);
  const effectiveDrugFilter = focusCategory === 'drugs' ? drugFilter : null;

  const { data, isLoading, error } = useSecurityOverview(
    focusCategory,
    timeframe,
    feedPage,
    weaponFilter,
    effectiveDrugFilter,
    selectedCity,
    null,
    bundeslandFilter,
    selectedPlz,
  );
  const { theme, toggleTheme } = useTheme();
  const resetFeedContext = useCallback(() => {
    setFeedPage(1);
    setHighlightedFeedId(null);
  }, []);

  const clearLocationSelection = useCallback(() => {
    setSelectedCity(null);
    setSelectedPlz(null);
  }, []);

  const resetFeedAndLocation = useCallback(() => {
    clearLocationSelection();
    resetFeedContext();
  }, [clearLocationSelection, resetFeedContext]);

  const handleTimeframeChange = useCallback((nextTimeframe: DashboardTimeframe) => {
    setTimeframe(nextTimeframe);
    resetFeedAndLocation();
  }, [resetFeedAndLocation]);

  const handleFocusCategoryChange = useCallback((nextCategory: CrimeCategory | null) => {
    setFocusCategory(nextCategory);
    if (nextCategory !== 'drugs') setDrugFilter(null);
    resetFeedAndLocation();
  }, [resetFeedAndLocation]);

  const handleWeaponFilterChange = useCallback((nextWeaponFilter: string | null) => {
    setWeaponFilter(nextWeaponFilter);
    resetFeedAndLocation();
  }, [resetFeedAndLocation]);

  const handleDrugFilterChange = useCallback((nextDrugFilter: string | null) => {
    setDrugFilter(nextDrugFilter);
    resetFeedAndLocation();
  }, [resetFeedAndLocation]);

  const handleBundeslandFilterChange = useCallback((nextBundesland: string | null) => {
    setBundeslandFilter(nextBundesland);
    resetFeedAndLocation();
  }, [resetFeedAndLocation]);

  const handleCityClick = useCallback((city: string) => {
    setSelectedCity((prev) => prev === city ? null : city);
    setSelectedPlz(null);
    resetFeedContext();
  }, [resetFeedContext]);

  const handlePlzClick = useCallback((plz: string) => {
    setSelectedPlz((prev) => prev === plz ? null : plz);
    setSelectedCity(null);
    resetFeedContext();
  }, [resetFeedContext]);

  const handleClearLocationFilter = useCallback(() => {
    clearLocationSelection();
    setFeedPage(1);
  }, [clearLocationSelection]);

  const locationFilterLabel = useMemo(() => {
    if (selectedCity) return selectedCity;
    if (selectedPlz) return `PLZ ${selectedPlz}`;
    return null;
  }, [selectedCity, selectedPlz]);

  const isStale = data != null && (
    data.focusCategory !== focusCategory
    || data.period.timeframe !== timeframe
    || data.weaponFilter !== weaponFilter
    || data.drugFilter !== effectiveDrugFilter
    || data.liveFeedCity !== selectedCity
    || data.liveFeedPlz !== selectedPlz
    || data.bundeslandFilter !== bundeslandFilter
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
        <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-3 pb-[calc(3.5rem+env(safe-area-inset-bottom))] pt-5 sm:gap-5 sm:px-8 sm:pb-12 sm:pt-12">
          <DashboardTopControls
            timeframe={timeframe}
            onTimeframeChange={handleTimeframeChange}
            focusCategory={focusCategory}
            onFocusCategoryChange={handleFocusCategoryChange}
            weaponFilter={weaponFilter}
            onWeaponFilterChange={handleWeaponFilterChange}
            drugFilter={focusCategory === 'drugs' ? drugFilter : null}
            onDrugFilterChange={handleDrugFilterChange}
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
            {data ? (
              <div className="relative">
                <CityLeaguePanel
                  topCities={data.topCities}
                  topCityPoints={data.topCityPoints}
                  topKreisPoints={data.topKreisPoints}
                  topPlz={data.topPlz ?? []}
                  topPlzPoints={data.topPlzPoints ?? []}
                  periodLabel={periodLabel}
                  categoryLabel={categoryLabel(focusCategory)}
                  isYearView={isYearView}
                  selectedCity={selectedCity}
                  selectedPlz={selectedPlz}
                  onCityClick={handleCityClick}
                  onPlzClick={handlePlzClick}
                  filterMode={ranglisteMode}
                  onFilterModeChange={setRanglisteMode}
                  liveFeedItems={data.liveFeed}
                  onFeedItemClick={setHighlightedFeedId}
                  bundeslandCounts={data.bundeslandCounts}
                  bundeslandFilter={bundeslandFilter}
                  onBundeslandFilterChange={handleBundeslandFilterChange}
                  focusCategoryLabel={focusCategory ? categoryLabel(focusCategory) : null}
                  weaponFilterLabel={weaponFilter ? (WEAPON_LABELS_TYPED[weaponFilter]?.de ?? weaponFilter) : null}
                />
                {showLoading && (
                  <div
                    className="pointer-events-none absolute inset-0 rounded-2xl"
                    style={{ background: 'color-mix(in srgb, var(--background) 60%, transparent)' }}
                  />
                )}
              </div>
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
            highlightedId={highlightedFeedId}
            locationFilterLabel={locationFilterLabel}
            onClearLocationFilter={handleClearLocationFilter}
          />
        </main>

        <Footer />
      </div>
    </div>
  );
}
