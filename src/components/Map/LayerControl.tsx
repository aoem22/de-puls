'use client';

import type { CrimeTypeKey } from '../../../lib/types/cityCrime';
import {
  CRIME_CATEGORIES_META,
  getCrimeTypesByCategory,
} from '../../../lib/types/cityCrime';
import { getCityCrimeLegendStops } from './CityCrimeLayer';
import { getKreisLegendStops } from './KreisLayer';
import type { IndicatorKey, SubMetricKey } from '../../../lib/indicators/types';
import {
  INDICATORS,
  getAuslaenderRegionsByCategory,
  getDeutschlandatlasByCategory,
  DEUTSCHLANDATLAS_META,
  isDeutschlandatlasKey,
} from '../../../lib/indicators/types';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { CRIME_CATEGORIES, WEAPON_LABELS, DRUG_LABELS, type CrimeCategory, type CrimeRecord, type MapLocationFilter } from '@/lib/types/crime';
import { WeaponIcon } from './BlaulichtPlaybackControl';
import { useTranslation, translations, tNested } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import type { AuslaenderRow, DeutschlandatlasRow, CityCrimeRow } from '@/lib/supabase';
import type { BlaulichtViewMode } from './HexbinLayer';

export interface LayerControlProps {
  // Indicator props
  selectedIndicator: IndicatorKey;
  onIndicatorChange: (indicator: IndicatorKey) => void;
  selectedSubMetric: SubMetricKey;
  onSubMetricChange: (subMetric: SubMetricKey) => void;
  selectedIndicatorYear?: string;
  // Crime metric (HZ vs AQ) - only for kriminalstatistik
  cityCrimeMetric?: 'hz' | 'aq';
  onCityCrimeMetricChange?: (metric: 'hz' | 'aq') => void;
  // Blaulicht crime stats
  blaulichtStats?: {
    total: number;
    geocoded: number;
    byCategory: Partial<Record<CrimeCategory, number>>;
  };
  // Blaulicht category filter
  selectedBlaulichtCategory?: CrimeCategory | null;
  onBlaulichtCategoryChange?: (category: CrimeCategory | null) => void;
  // Blaulicht weapon filter
  weaponCounts?: Record<string, number>;
  selectedWeaponType?: string | null;
  onWeaponTypeChange?: (weaponType: string | null) => void;
  // Blaulicht drug type filter (visible only when drugs category selected)
  drugCounts?: Record<string, number>;
  selectedDrugType?: string | null;
  onDrugTypeChange?: (drugType: string | null) => void;
  // Blaulicht location filter (Bundesland / Stadt / PLZ)
  locationOptions?: Array<{ type: 'bundesland' | 'city' | 'plz'; value: string; count: number }>;
  locationFilter?: MapLocationFilter | null;
  onLocationFilterChange?: (filter: MapLocationFilter | null) => void;
  // Blaulicht full-text search
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  searchResultCount?: number | null;
  isSearching?: boolean;
  // Search results list (clickable rows below search input)
  searchResults?: CrimeRecord[];
  onSearchResultClick?: (crime: CrimeRecord) => void;
  // Favorites filter
  favoritesCount?: number;
  showFavoritesOnly?: boolean;
  onToggleFavoritesOnly?: () => void;
  // Blaulicht view mode (dots / density / both)
  blaulichtViewMode?: BlaulichtViewMode;
  onBlaulichtViewModeChange?: (mode: BlaulichtViewMode) => void;
  // Pipeline run toggle (experiment A/B)
  pipelineRuns?: Array<{ run: string; count: number }>;
  selectedPipelineRun?: string;
  onPipelineRunChange?: (run: string | undefined) => void;
  // Data quality filters (enriched / geotagged)
  filterEnrichedOnly?: boolean;
  onFilterEnrichedChange?: () => void;
  filterGeotaggedOnly?: boolean;
  onFilterGeotaggedChange?: () => void;
  enrichedCount?: number;
  geotaggedCount?: number;
  totalCrimeCount?: number;
  // Data props for legend computation
  auslaenderData?: Record<string, AuslaenderRow>;
  deutschlandatlasData?: Record<string, DeutschlandatlasRow>;
  cityCrimeData?: Record<string, Record<string, CityCrimeRow>>;
  // Year selector (for auslaender / kriminalstatistik in settings card)
  indicatorYears?: string[];
  onYearChange?: (year: string) => void;
  isPlaying?: boolean;
  onTogglePlay?: () => void;
  // Hide the primary indicator selector (mobile already has MobileCategoryBar)
  hideIndicatorSelector?: boolean;
}

export const PRIMARY_INDICATOR_STACK_ORDER: IndicatorKey[] = [
  'blaulicht',
  'auslaender',
  'kriminalstatistik',
  // 'deutschlandatlas', // hidden from UI for now
];

export const PRIMARY_INDICATOR_STACK_META: Record<
  IndicatorKey,
  { symbol: string; badgeClassName: string; activeClassName: string }
> = {
  auslaender: {
    symbol: '◉',
    badgeClassName: 'bg-red-500/15 text-red-300 border border-red-500/35',
    activeClassName: 'border-red-500/55 bg-red-500/10',
  },
  deutschlandatlas: {
    symbol: '▣',
    badgeClassName: 'bg-violet-500/15 text-violet-300 border border-violet-500/35',
    activeClassName: 'border-violet-500/55 bg-violet-500/10',
  },
  kriminalstatistik: {
    symbol: '▲',
    badgeClassName: 'bg-orange-500/15 text-orange-300 border border-orange-500/35',
    activeClassName: 'border-orange-500/55 bg-orange-500/10',
  },
  blaulicht: {
    symbol: '✶',
    badgeClassName: 'bg-blue-500/15 text-blue-300 border border-blue-500/35',
    activeClassName: 'border-blue-500/55 bg-blue-500/10',
  },
};

const PRIMARY_INDICATOR_STACK_DESCRIPTION: Record<IndicatorKey, { de: string; en: string }> = {
  auslaender: {
    de: 'Ausländische Bevölkerung im Vergleich',
    en: 'Foreign population compared',
  },
  deutschlandatlas: {
    de: 'Sozialdaten auf Kreisebene',
    en: 'District-level social metrics',
  },
  kriminalstatistik: {
    de: 'Delikte in Großstädten',
    en: 'Offenses in major cities',
  },
  blaulicht: {
    de: 'Aktuelle Polizeimeldungen',
    en: 'Live police reports',
  },
};

export function LayerControl({
  selectedIndicator,
  onIndicatorChange,
  selectedSubMetric,
  onSubMetricChange,
  selectedIndicatorYear,
  cityCrimeMetric,
  onCityCrimeMetricChange,
  blaulichtStats,
  selectedBlaulichtCategory,
  onBlaulichtCategoryChange,
  weaponCounts,
  selectedWeaponType,
  onWeaponTypeChange,
  drugCounts,
  selectedDrugType,
  onDrugTypeChange,
  locationOptions,
  locationFilter,
  onLocationFilterChange,
  searchQuery,
  onSearchQueryChange,
  searchResultCount,
  isSearching,
  searchResults,
  onSearchResultClick,
  favoritesCount,
  showFavoritesOnly,
  onToggleFavoritesOnly,
  blaulichtViewMode,
  onBlaulichtViewModeChange,
  pipelineRuns,
  selectedPipelineRun,
  onPipelineRunChange,
  filterEnrichedOnly,
  onFilterEnrichedChange,
  filterGeotaggedOnly,
  onFilterGeotaggedChange,
  enrichedCount,
  geotaggedCount,
  totalCrimeCount,
  indicatorYears,
  onYearChange,
  isPlaying,
  onTogglePlay,
  auslaenderData: ausData,
  deutschlandatlasData: datlasData,
  cityCrimeData,
  hideIndicatorSelector,
}: LayerControlProps) {
  const { lang } = useTranslation();
  const crimeTypesByCategory = getCrimeTypesByCategory();

  // Get current indicator config
  const currentIndicator = INDICATORS[selectedIndicator];

  // Translation helpers
  const t = (key: keyof typeof translations) => {
    const entry = translations[key];
    if (typeof entry === 'object' && 'de' in entry && 'en' in entry) {
      return entry[lang];
    }
    return key;
  };

  const getIndicatorLabel = (key: IndicatorKey) => {
    return tNested('indicators', key, lang);
  };

  const getSubMetricLabel = () => {
    if (selectedIndicator === 'auslaender') return t('originRegion');
    if (selectedIndicator === 'kriminalstatistik') return t('crimeType');
    return t('indicator');
  };

  return (
    <div
      className="bg-[var(--card)]/95 backdrop-blur-sm rounded-lg shadow-xl border border-[var(--card-border)] p-3 space-y-3 max-h-[calc(100vh-2rem)] overflow-y-auto scrollbar-thin"
      data-total-crime-count={totalCrimeCount}
    >
      {/* Primary indicator selector (hidden on mobile — MobileCategoryBar handles it) */}
      {!hideIndicatorSelector && (
      <div>
        <div className="space-y-1.5">
          {PRIMARY_INDICATOR_STACK_ORDER.map((indicatorKey) => {
            const isSelected = selectedIndicator === indicatorKey;
            const stackMeta = PRIMARY_INDICATOR_STACK_META[indicatorKey];
            const shortDescription = PRIMARY_INDICATOR_STACK_DESCRIPTION[indicatorKey][lang];

            return (
              <button
                key={indicatorKey}
                type="button"
                onClick={() => onIndicatorChange(indicatorKey)}
                aria-pressed={isSelected}
                className={`w-full flex items-start gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors touch-feedback ${
                  isSelected
                    ? stackMeta.activeClassName
                    : 'border-[var(--border)] bg-[var(--background)] hover:bg-[var(--card-elevated)] active:bg-[var(--card-elevated)]'
                }`}
              >
                <span
                  className={`mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${stackMeta.badgeClassName}`}
                >
                  {stackMeta.symbol}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm font-medium leading-snug ${isSelected ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                    {getIndicatorLabel(indicatorKey)}
                  </span>
                  <span className="block text-xs text-[var(--text-tertiary)] leading-snug mt-0.5">
                    {shortDescription}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      )}

      {/* Indicator sub-metric selector - changes based on indicator type (hidden for blaulicht) */}
      {selectedIndicator !== 'blaulicht' && (
      <div>
        <label
          htmlFor="submetric-select"
          className="block text-xs text-[var(--text-tertiary)] mb-1.5"
        >
          {getSubMetricLabel()}
        </label>
        <select
          id="submetric-select"
          value={selectedSubMetric}
          onChange={(e) => onSubMetricChange(e.target.value)}
          className="w-full px-2 py-2 text-sm bg-[var(--background)] border border-[var(--border)] rounded-md shadow-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 appearance-none cursor-pointer"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 8px center',
          }}
        >
          {selectedIndicator === 'auslaender' ? (
            // Ausländer: show regions grouped by category
            Array.from(getAuslaenderRegionsByCategory().entries()).map(([category, regions]) => (
              <optgroup key={category} label={category}>
                {regions.map((region) => (
                  <option key={region.key} value={region.key}>
                    {region.labelDe}
                  </option>
                ))}
              </optgroup>
            ))
          ) : selectedIndicator === 'kriminalstatistik' ? (
            // Kriminalstatistik: show crime types grouped by category
            Array.from(crimeTypesByCategory.entries()).map(([category, types]) => (
              <optgroup key={category} label={CRIME_CATEGORIES_META[category].labelDe}>
                {types.map((type) => (
                  <option key={type.key} value={type.key}>
                    {type.labelDe}
                  </option>
                ))}
              </optgroup>
            ))
          ) : (
            // Deutschlandatlas: show indicators grouped by category
            Array.from(getDeutschlandatlasByCategory().entries()).map(([category, indicators]) => (
              <optgroup key={category} label={category}>
                {indicators.map((ind) => (
                  <option key={ind.key} value={ind.key}>
                    {ind.labelDe}
                  </option>
                ))}
              </optgroup>
            ))
          )}
        </select>
      </div>
      )}

      {/* Year selector (for auslaender / kriminalstatistik) */}
      {selectedIndicator !== 'blaulicht' && indicatorYears && indicatorYears.length > 1 && onYearChange && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-[var(--text-tertiary)]">
              {lang === 'de' ? 'Jahr' : 'Year'}
            </span>
            {onTogglePlay && (
              <button
                type="button"
                onClick={onTogglePlay}
                aria-label={isPlaying ? 'Pause' : (lang === 'de' ? 'Abspielen' : 'Play')}
                className={`flex w-6 h-6 items-center justify-center rounded-md border transition-all ${
                  isPlaying
                    ? (selectedIndicator === 'auslaender'
                      ? 'bg-red-500/20 border-red-500 text-red-300'
                      : 'bg-orange-500/20 border-orange-500 text-orange-300')
                    : 'bg-[var(--background)] border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--scrollbar-thumb)]'
                }`}
              >
                <span className="relative block w-2.5 h-2.5">
                  <svg
                    className={`absolute inset-0 w-2.5 h-2.5 transition-opacity duration-150 ${isPlaying ? 'opacity-0' : 'opacity-100'}`}
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  <svg
                    className={`absolute inset-0 w-2.5 h-2.5 transition-opacity duration-150 ${isPlaying ? 'opacity-100' : 'opacity-0'}`}
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <rect x="6" y="4" width="4" height="16" rx="1" />
                    <rect x="14" y="4" width="4" height="16" rx="1" />
                  </svg>
                </span>
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {indicatorYears.map((year) => {
              const isActive = selectedIndicatorYear === year;
              const accentClass = selectedIndicator === 'auslaender'
                ? 'bg-red-500/20 border-red-500/60 text-red-300'
                : 'bg-orange-500/20 border-orange-500/60 text-orange-300';
              return (
                <button
                  key={year}
                  type="button"
                  onClick={() => onYearChange(year)}
                  className={`px-2 py-1.5 md:py-1 text-xs rounded-md border transition-colors touch-feedback ${
                    isActive
                      ? accentClass
                      : 'bg-transparent border-[var(--border)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {year}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Crime metric toggle (HZ vs AQ) - only for kriminalstatistik */}
      {selectedIndicator === 'kriminalstatistik' && cityCrimeMetric && onCityCrimeMetricChange && (
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => onCityCrimeMetricChange('hz')}
            className={`flex-1 px-2 py-2.5 md:py-2 text-sm md:text-xs rounded-md border transition-colors touch-feedback ${
              cityCrimeMetric === 'hz'
                ? 'bg-orange-500/20 border-orange-500 text-orange-300'
                : 'bg-transparent border-[var(--border)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] active:bg-orange-500/10'
            }`}
          >
            {t('frequencyHz')}
          </button>
          <button
            type="button"
            onClick={() => onCityCrimeMetricChange('aq')}
            className={`flex-1 px-2 py-2.5 md:py-2 text-sm md:text-xs rounded-md border transition-colors touch-feedback ${
              cityCrimeMetric === 'aq'
                ? 'bg-green-500/20 border-green-500 text-green-300'
                : 'bg-transparent border-[var(--border)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] active:bg-green-500/10'
            }`}
          >
            {t('clearanceAq')}
          </button>
        </div>
      )}

      {/* Legend - not shown for blaulicht (replaced by category filters) */}
      {selectedIndicator !== 'blaulicht' && selectedIndicatorYear && (
        <div className="pt-2 border-t border-[var(--border)]">
          <div className="text-xs text-[var(--text-tertiary)] mb-2">{t('legend')}</div>
          {selectedIndicator === 'kriminalstatistik' ? (
            <CityCrimeLegend
              crimeType={selectedSubMetric as CrimeTypeKey}
              metric={cityCrimeMetric || 'hz'}
              lang={lang}
              cityCrimeData={cityCrimeData}
            />
          ) : (
            <KreisIndicatorLegend
              indicatorKey={selectedIndicator}
              subMetric={selectedSubMetric}
              year={selectedIndicatorYear}
              lang={lang}
              auslaenderData={ausData}
              deutschlandatlasData={datlasData}
            />
          )}
        </div>
      )}

      {/* Pipeline run toggle (only when multiple runs exist) — above categories so it scopes them */}
      {selectedIndicator === 'blaulicht' && pipelineRuns && pipelineRuns.length > 1 && onPipelineRunChange && (
        <div className="pt-2 border-t border-[var(--border)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[var(--text-tertiary)] uppercase tracking-wide">{lang === 'de' ? 'Pipeline-Lauf' : 'Pipeline Run'}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {/* All runs button */}
            <button
              onClick={() => onPipelineRunChange(undefined)}
              className={`px-2 py-1.5 md:py-1 text-xs rounded-md border transition-colors touch-feedback ${
                !selectedPipelineRun
                  ? 'bg-blue-500/20 border-blue-500/60 text-blue-300'
                  : 'bg-transparent border-[var(--border)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {lang === 'de' ? 'Alle' : 'All'}
            </button>
            {pipelineRuns.map(({ run, count }) => (
              <button
                key={run}
                onClick={() => onPipelineRunChange(selectedPipelineRun === run ? undefined : run)}
                className={`px-2 py-1.5 md:py-1 text-xs rounded-md border transition-colors touch-feedback ${
                  selectedPipelineRun === run
                    ? 'bg-blue-500/20 border-blue-500/60 text-blue-300'
                    : 'bg-transparent border-[var(--border)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {run} <span className="text-[var(--text-muted)]">({count})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Data quality filters (Enriched / Geotagged) */}
      {selectedIndicator === 'blaulicht' && onFilterEnrichedChange && onFilterGeotaggedChange && (
        <div className="pt-2 border-t border-[var(--border)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[var(--text-tertiary)] uppercase tracking-wide">
              {lang === 'de' ? 'Datenqualität' : 'Data Quality'}
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={onFilterEnrichedChange}
              className={`px-2 py-1.5 md:py-1 text-xs rounded-md border transition-colors touch-feedback ${
                filterEnrichedOnly
                  ? 'bg-green-500/20 border-green-500/60 text-green-300'
                  : 'bg-transparent border-[var(--border)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {lang === 'de' ? 'Angereichert' : 'Enriched'}{' '}
              <span className="text-[var(--text-muted)]">({enrichedCount?.toLocaleString('de-DE') ?? '…'})</span>
            </button>
            <button
              type="button"
              onClick={onFilterGeotaggedChange}
              className={`px-2 py-1.5 md:py-1 text-xs rounded-md border transition-colors touch-feedback ${
                filterGeotaggedOnly
                  ? 'bg-orange-500/20 border-orange-500/60 text-orange-300'
                  : 'bg-transparent border-[var(--border)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {lang === 'de' ? 'Geolokalisiert' : 'Geotagged'}{' '}
              <span className="text-[var(--text-muted)]">({geotaggedCount?.toLocaleString('de-DE') ?? '…'})</span>
            </button>
          </div>
        </div>
      )}

      {/* Blaulicht view mode toggle (Punkte / Dichte / Beides) */}
      {selectedIndicator === 'blaulicht' && blaulichtViewMode && onBlaulichtViewModeChange && (
        <div className="pt-2 border-t border-[var(--border)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[var(--text-tertiary)] uppercase tracking-wide">
              {lang === 'de' ? 'Darstellung' : 'Display'}
            </span>
          </div>
          <div className="flex gap-1">
            {([
              { mode: 'dots' as const, de: 'Punkte', en: 'Dots' },
              { mode: 'density' as const, de: 'Dichte', en: 'Density' },
              { mode: 'both' as const, de: 'Beides', en: 'Both' },
            ] as const).map(({ mode, de, en }) => (
              <button
                key={mode}
                type="button"
                onClick={() => onBlaulichtViewModeChange(mode)}
                className={`flex-1 px-2 py-2.5 md:py-2 text-sm md:text-xs rounded-md border transition-colors touch-feedback ${
                  blaulichtViewMode === mode
                    ? 'bg-blue-500/20 border-blue-500 text-blue-300'
                    : 'bg-transparent border-[var(--border)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] active:bg-blue-500/10'
                }`}
              >
                {lang === 'de' ? de : en}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Blaulicht clickable category filters — hidden on mobile (bottom bar has them) */}
      {selectedIndicator === 'blaulicht' && blaulichtStats && onBlaulichtCategoryChange && (
        <div className="hidden md:block pt-2 border-t border-[var(--border)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[var(--text-tertiary)] uppercase tracking-wide">{t('categories')}</span>
            <span className="text-xs text-[var(--text-tertiary)]">{blaulichtStats.geocoded}/{blaulichtStats.total} {t('located')}</span>
          </div>
          <div className="space-y-1">
            {/* All categories button */}
            <button
              onClick={() => onBlaulichtCategoryChange(null)}
              className={`w-full flex items-center gap-2 px-2 py-2 md:py-1.5 rounded-md transition-colors touch-feedback ${
                selectedBlaulichtCategory === null
                  ? 'bg-[var(--card-elevated)] border border-[var(--foreground)]/80'
                  : 'hover:bg-[var(--card-elevated)] active:bg-[var(--card-elevated)] border border-transparent'
              }`}
            >
              <div
                className="w-3 h-3 md:w-2.5 md:h-2.5 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: '#3b82f6',
                  boxShadow: 'none',
                }}
              />
              <span className={`text-sm md:text-xs flex-1 text-left no-select ${selectedBlaulichtCategory === null ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'}`}>
                {t('showAll')}
              </span>
              <span className="text-xs text-[var(--text-tertiary)] tabular-nums">{blaulichtStats.total}</span>
            </button>

            {/* Individual category buttons */}
            {CRIME_CATEGORIES.filter(cat => (blaulichtStats.byCategory[cat.key] || 0) > 0)
              .sort((a, b) => (blaulichtStats.byCategory[b.key] || 0) - (blaulichtStats.byCategory[a.key] || 0))
              .map((cat) => {
                const count = blaulichtStats.byCategory[cat.key] || 0;
                const isSelected = selectedBlaulichtCategory === cat.key;
                const catLabel = tNested('crimeCategories', cat.key, lang);
                return (
                  <button
                    key={cat.key}
                    onClick={() => onBlaulichtCategoryChange(isSelected ? null : cat.key)}
                    className={`w-full flex items-center gap-2 px-2 py-2 md:py-1.5 rounded-md transition-colors touch-feedback ${
                      isSelected
                        ? 'bg-[var(--card-elevated)] border border-[var(--foreground)]/80'
                        : 'hover:bg-[var(--card-elevated)] active:bg-[var(--card-elevated)] border border-transparent'
                    }`}
                  >
                    <div
                      className="w-3 h-3 md:w-2.5 md:h-2.5 rounded-full flex-shrink-0"
                      style={{
                        backgroundColor: cat.color,
                        boxShadow: 'none',
                      }}
                    />
                    <span className={`text-sm md:text-xs flex-1 text-left no-select ${isSelected ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'}`}>
                      {catLabel}
                    </span>
                    <span className="text-xs text-[var(--text-tertiary)] tabular-nums">{count}</span>
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {/* Weapon type sub-filters — hidden on mobile (bottom bar has them) */}
      {selectedIndicator === 'blaulicht' && weaponCounts && onWeaponTypeChange && Object.keys(weaponCounts).length > 0 && (
        <div className="hidden md:block pt-2 border-t border-[var(--border)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[var(--text-tertiary)] uppercase tracking-wide">{lang === 'de' ? 'Tatmittel' : 'Weapons'}</span>
          </div>
          <div className="space-y-1">
            {Object.entries(weaponCounts)
              .filter(([wt]) => wt !== 'vehicle')
              .sort(([, a], [, b]) => b - a)
              .map(([wt, count]) => {
                const label = WEAPON_LABELS[wt];
                if (!label) return null;
                const isSelected = selectedWeaponType === wt;
                return (
                  <button
                    key={wt}
                    onClick={() => onWeaponTypeChange(isSelected ? null : wt)}
                    className={`w-full flex items-center gap-2 px-2 py-2 md:py-1.5 rounded-md transition-colors touch-feedback ${
                      isSelected
                        ? 'bg-[var(--card-elevated)] border border-[var(--foreground)]/80'
                        : 'hover:bg-[var(--card-elevated)] active:bg-[var(--card-elevated)] border border-transparent'
                    }`}
                  >
                    <WeaponIcon type={wt} className="text-base" />
                    <span className={`text-sm md:text-xs flex-1 text-left no-select ${isSelected ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'}`}>
                      {label[lang]}
                    </span>
                    <span className="text-xs text-[var(--text-tertiary)] tabular-nums">{count}</span>
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {/* Location filter (Stadt / PLZ / Bundesland) */}
      {selectedIndicator === 'blaulicht' && locationOptions && onLocationFilterChange && locationOptions.length > 0 && (
        <LocationFilterSection
          locationOptions={locationOptions}
          locationFilter={locationFilter ?? null}
          onLocationFilterChange={onLocationFilterChange}
          lang={lang}
        />
      )}

      {/* Full-text search across all Polizeimeldungen */}
      {selectedIndicator === 'blaulicht' && onSearchQueryChange && (
        <div className="pt-2 border-t border-[var(--border)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[var(--text-tertiary)] uppercase tracking-wide">
              {lang === 'de' ? 'Suche' : 'Search'}
            </span>
            {searchQuery && searchQuery.length >= 2 && searchResultCount != null && (
              <span className="text-xs text-[var(--text-tertiary)] tabular-nums">
                {searchResultCount.toLocaleString('de-DE')} {lang === 'de' ? 'Treffer' : 'results'}
              </span>
            )}
          </div>
          <div className="relative">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)] pointer-events-none"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={searchQuery ?? ''}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              placeholder={lang === 'de' ? 'z.B. Pfefferspray, Messer…' : 'e.g. pepper spray, knife…'}
              className="w-full pl-8 pr-8 py-2 md:py-1.5 text-sm md:text-xs bg-[var(--background)] border border-[var(--border)] rounded-md text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
            />
            {isSearching && (
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            )}
            {!isSearching && searchQuery && (
              <button
                type="button"
                onClick={() => onSearchQueryChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                aria-label={lang === 'de' ? 'Suche leeren' : 'Clear search'}
              >
                <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
          {/* Search results list */}
          {searchQuery && searchQuery.length >= 2 && searchResults && searchResults.length > 0 && onSearchResultClick && (
            <SearchResultsList
              results={searchResults}
              onResultClick={onSearchResultClick}
              lang={lang}
            />
          )}
        </div>
      )}

      {/* Drug type sub-filters — only when drugs category is selected */}
      {selectedIndicator === 'blaulicht' && selectedBlaulichtCategory === 'drugs' && drugCounts && onDrugTypeChange && Object.keys(drugCounts).length > 0 && (
        <div className="hidden md:block pt-2 border-t border-[var(--border)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[var(--text-tertiary)] uppercase tracking-wide">{lang === 'de' ? 'Drogenart' : 'Drug Type'}</span>
          </div>
          <div className="space-y-1">
            {Object.entries(drugCounts)
              .sort(([, a], [, b]) => b - a)
              .map(([dt, count]) => {
                const label = DRUG_LABELS[dt];
                if (!label) return null;
                const isSelected = selectedDrugType === dt;
                return (
                  <button
                    key={dt}
                    onClick={() => onDrugTypeChange(isSelected ? null : dt)}
                    className={`w-full flex items-center gap-2 px-2 py-2 md:py-1.5 rounded-md transition-colors touch-feedback ${
                      isSelected
                        ? 'bg-[var(--card-elevated)] border border-[var(--foreground)]/80'
                        : 'hover:bg-[var(--card-elevated)] active:bg-[var(--card-elevated)] border border-transparent'
                    }`}
                  >
                    <span className="w-4 text-center text-sm flex-shrink-0">{label.icon}</span>
                    <span className={`text-sm md:text-xs flex-1 text-left no-select ${isSelected ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'}`}>
                      {label[lang]}
                    </span>
                    <span className="text-xs text-[var(--text-tertiary)] tabular-nums">{count}</span>
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {/* Favorites filter */}
      {selectedIndicator === 'blaulicht' && onToggleFavoritesOnly && (favoritesCount ?? 0) > 0 && (
        <div className="pt-2 border-t border-[var(--border)]">
          <button
            onClick={onToggleFavoritesOnly}
            className={`w-full flex items-center gap-2 px-2 py-2 md:py-1.5 rounded-md transition-colors touch-feedback ${
              showFavoritesOnly
                ? 'bg-amber-500/15 border border-amber-500/60'
                : 'hover:bg-[var(--card-elevated)] active:bg-[var(--card-elevated)] border border-transparent'
            }`}
          >
            <span className="w-3 md:w-2.5 text-center text-sm flex-shrink-0">
              {showFavoritesOnly ? '\u2605' : '\u2606'}
            </span>
            <span className={`text-sm md:text-xs flex-1 text-left no-select ${showFavoritesOnly ? 'text-amber-300' : 'text-[var(--text-tertiary)]'}`}>
              {lang === 'de' ? 'Favoriten' : 'Favorites'}
            </span>
            <span className="text-xs text-[var(--text-tertiary)] tabular-nums">{favoritesCount}</span>
          </button>
        </div>
      )}

      {/* Info text */}
      <p className="text-xs text-[var(--text-tertiary)] leading-tight hidden md:block">
        <span className="text-[var(--text-tertiary)]">{lang === 'de' ? 'Quelle' : 'Source'}: {currentIndicator.source}</span>
      </p>

      {/* Settings section with language & theme toggle */}
      <div className="pt-2 border-t border-[var(--border)] space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--text-tertiary)] uppercase tracking-wide">
            {lang === 'de' ? 'Sprache' : 'Language'}
          </span>
          <div className="flex items-center gap-1.5">
            <LanguageToggleInline />
          </div>
        </div>
        <div className="hidden md:flex items-center justify-between">
          <span className="text-xs text-[var(--text-tertiary)] uppercase tracking-wide">
            {lang === 'de' ? 'Modus' : 'Mode'}
          </span>
          <div className="flex items-center gap-1.5">
            <ThemeToggleInline />
          </div>
        </div>
      </div>
    </div>
  );
}

// Inline language toggle for the control panel
function LanguageToggleInline() {
  const { lang, toggleLanguage } = useTranslation();

  return (
    <button
      onClick={toggleLanguage}
      className="flex items-center gap-1 px-2 py-1 bg-[var(--background)] rounded-md border border-[var(--border)] text-xs font-medium transition-all touch-feedback active:scale-95 hover:border-[var(--scrollbar-thumb)]"
      aria-label={lang === 'de' ? 'Switch to English' : 'Auf Deutsch wechseln'}
    >
      <span className={`transition-colors ${lang === 'de' ? 'text-amber-400' : 'text-[var(--text-muted)]'}`}>
        DE
      </span>
      <span className="text-[var(--text-faint)]">/</span>
      <span className={`transition-colors ${lang === 'en' ? 'text-amber-400' : 'text-[var(--text-muted)]'}`}>
        EN
      </span>
    </button>
  );
}

// Inline theme toggle (dark/light mode)
function ThemeToggleInline() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="flex items-center gap-1.5 px-2 py-1 bg-[var(--background)] rounded-md border border-[var(--border)] text-xs font-medium transition-all touch-feedback active:scale-95 hover:border-[var(--scrollbar-thumb)]"
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {theme === 'dark' ? (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
          <span className="text-amber-400">Dark</span>
        </>
      ) : (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500">
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
          <span className="text-amber-500">Light</span>
        </>
      )}
    </button>
  );
}

// Kreis indicator legend component
function KreisIndicatorLegend({
  indicatorKey,
  subMetric,
  year,
  lang,
  auslaenderData,
  deutschlandatlasData,
}: {
  indicatorKey: IndicatorKey;
  subMetric: SubMetricKey;
  year: string;
  lang: 'de' | 'en';
  auslaenderData?: Record<string, AuslaenderRow>;
  deutschlandatlasData?: Record<string, DeutschlandatlasRow>;
}) {
  const stops = getKreisLegendStops(indicatorKey, subMetric, year, 5, auslaenderData, deutschlandatlasData);
  const indicator = INDICATORS[indicatorKey];

  if (stops.length === 0) return null;

  // Get unit for display - for Deutschlandatlas, use sub-metric unit
  const displayUnit = indicatorKey === 'deutschlandatlas' && isDeutschlandatlasKey(subMetric)
    ? DEUTSCHLANDATLAS_META[subMetric].unitDe
    : indicator.unit;

  // Get color scale info - for Deutschlandatlas, check higherIsBetter
  const isDeutschlandatlas = indicatorKey === 'deutschlandatlas' && isDeutschlandatlasKey(subMetric);
  const meta = isDeutschlandatlas ? DEUTSCHLANDATLAS_META[subMetric] : null;
  const usesSemanticColor = isDeutschlandatlas && meta?.higherIsBetter !== undefined;
  const higherIsBetter = meta?.higherIsBetter ?? false;

  const t = translations;

  return (
    <div className="space-y-1">
      <div className="text-xs text-[var(--text-tertiary)]">
        {displayUnit || t.value[lang]}
      </div>
      <div className="flex md:flex-col gap-1 md:gap-0.5">
        {stops.map((stop, index) => (
          <div
            key={index}
            className="flex flex-col md:flex-row items-center gap-0.5 md:gap-2 flex-1 md:flex-none"
          >
            <div
              className="w-full md:w-5 h-2.5 md:h-3 rounded-sm border border-[var(--border)]"
              style={{ backgroundColor: stop.color }}
            />
            <span className="text-[11px] md:text-xs text-[var(--text-secondary)] font-mono hidden md:inline">
              {stop.label}
            </span>
          </div>
        ))}
      </div>
      {/* Mobile labels - just min and max */}
      <div className="flex md:hidden justify-between text-[10px] text-[var(--text-tertiary)] font-mono">
        <span>{stops[0]?.label}</span>
        <span>{stops[stops.length - 1]?.label}</span>
      </div>
      <p className="text-[11px] text-[var(--text-tertiary)] mt-1 leading-snug">
        {usesSemanticColor ? (
          higherIsBetter ? (
            <>
              <span className="text-red-400">{t.redHigh[lang]}</span> = {t.low[lang]} ·{' '}
              <span className="text-green-400">{t.greenLow[lang]}</span> = {t.high[lang]}
            </>
          ) : (
            <>
              <span className="text-green-400">{t.greenLow[lang]}</span> = {t.low[lang]} ·{' '}
              <span className="text-red-400">{t.redHigh[lang]}</span> = {t.high[lang]}
            </>
          )
        ) : (
          <>
            <span className="text-yellow-400">{t.yellowLow[lang]}</span> = {t.few[lang]} ·{' '}
            <span className="text-red-400">{t.redHigh[lang]}</span> = {t.many[lang]}
          </>
        )}
      </p>
    </div>
  );
}

// City crime legend component
function CityCrimeLegend({
  crimeType,
  metric,
  lang,
  cityCrimeData,
}: {
  crimeType: CrimeTypeKey;
  metric: 'hz' | 'aq';
  lang: 'de' | 'en';
  cityCrimeData?: Record<string, Record<string, CityCrimeRow>>;
}) {
  const stops = getCityCrimeLegendStops(crimeType, metric, 5, cityCrimeData);

  if (stops.length === 0) return null;

  const t = translations;

  return (
    <div className="space-y-1">
      <div className="text-xs text-[var(--text-tertiary)]">
        {metric === 'hz' ? t.casesPerPopulation[lang] : t.clearanceRatePercent[lang]}
      </div>
      <div className="flex md:flex-col gap-1 md:gap-0.5">
        {stops.map((stop, index) => (
          <div
            key={index}
            className="flex flex-col md:flex-row items-center gap-0.5 md:gap-2 flex-1 md:flex-none"
          >
            <div
              className="w-full md:w-5 h-2.5 md:h-3 rounded-sm border border-[var(--border)]"
              style={{ backgroundColor: stop.color }}
            />
            <span className="text-[11px] md:text-xs text-[var(--text-secondary)] font-mono hidden md:inline">
              {stop.label}
            </span>
          </div>
        ))}
      </div>
      {/* Mobile labels - just min and max */}
      <div className="flex md:hidden justify-between text-[10px] text-[var(--text-tertiary)] font-mono">
        <span>{stops[0]?.label}</span>
        <span>{stops[stops.length - 1]?.label}</span>
      </div>
      <p className="text-[11px] text-[var(--text-tertiary)] mt-1 leading-snug">
        {metric === 'hz' ? (
          <>
            <span className="text-yellow-400">{t.yellowLow[lang]}</span> = {t.low[lang]} ·{' '}
            <span className="text-red-400">{t.redHigh[lang]}</span> = {t.high[lang]}
          </>
        ) : (
          <>
            <span className="text-red-400">{t.redHigh[lang]}</span> = {t.low[lang]} ·{' '}
            <span className="text-green-400">{t.greenLow[lang]}</span> = {t.high[lang]}
          </>
        )}
      </p>
    </div>
  );
}

// ── Search results list ──────────────────────────────────────────────────
const SEARCH_RESULTS_MAX = 50;

const crimeColorLookup = new Map(
  CRIME_CATEGORIES.map((cat) => [cat.key, cat.color]),
);

function SearchResultsList({
  results,
  onResultClick,
  lang,
}: {
  results: CrimeRecord[];
  onResultClick: (crime: CrimeRecord) => void;
  lang: 'de' | 'en';
}) {
  // Show newest first for better usability
  const sorted = useMemo(
    () => [...results].sort((a, b) => {
      const ta = Date.parse(a.publishedAt) || 0;
      const tb = Date.parse(b.publishedAt) || 0;
      return tb - ta;
    }),
    [results],
  );

  const visible = sorted.slice(0, SEARCH_RESULTS_MAX);
  const total = results.length;

  const formatDate = useCallback((iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }, []);

  return (
    <div className="mt-2 max-h-[280px] overflow-y-auto scrollbar-thin rounded-md border border-[var(--border)] bg-[var(--background)]">
      {visible.map((crime) => {
        const catColor = crime.categories[0]
          ? crimeColorLookup.get(crime.categories[0]) ?? '#3b82f6'
          : '#3b82f6';
        return (
          <button
            key={crime.id}
            type="button"
            onClick={() => onResultClick(crime)}
            className="w-full flex items-start gap-2 px-2 py-1.5 text-left hover:bg-[var(--card-elevated)] active:bg-[var(--card-elevated)] transition-colors border-b border-[var(--border)] last:border-b-0"
          >
            <div
              className="w-2 h-2 rounded-full flex-shrink-0 mt-1"
              style={{ backgroundColor: catColor }}
            />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-[var(--text-primary)] leading-snug line-clamp-1">
                {crime.cleanTitle || crime.title}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                {crime.publishedAt && (
                  <span className="text-[10px] text-[var(--text-muted)] tabular-nums">
                    {formatDate(crime.publishedAt)}
                  </span>
                )}
                {crime.city && (
                  <span className="text-[10px] text-[var(--text-tertiary)] truncate">
                    {crime.city}
                  </span>
                )}
              </div>
            </div>
          </button>
        );
      })}
      {total > SEARCH_RESULTS_MAX && (
        <div className="px-2 py-1.5 text-[10px] text-[var(--text-muted)] text-center">
          {SEARCH_RESULTS_MAX} {lang === 'de' ? 'von' : 'of'} {total.toLocaleString('de-DE')} {lang === 'de' ? 'angezeigt' : 'shown'}
        </div>
      )}
    </div>
  );
}

// ── Location autocomplete filter (Stadt / PLZ / Bundesland) ──────────────
const LOCATION_TYPE_LABELS: Record<string, Record<'de' | 'en', string>> = {
  bundesland: { de: 'Bundesland', en: 'State' },
  city: { de: 'Stadt', en: 'City' },
  plz: { de: 'PLZ', en: 'ZIP' },
};

function LocationFilterSection({
  locationOptions,
  locationFilter,
  onLocationFilterChange,
  lang,
}: {
  locationOptions: Array<{ type: 'bundesland' | 'city' | 'plz'; value: string; count: number }>;
  locationFilter: MapLocationFilter | null;
  onLocationFilterChange: (filter: MapLocationFilter | null) => void;
  lang: 'de' | 'en';
}) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = useMemo(() => {
    if (!query || query.length < 1) return [];
    const q = query.toLowerCase();
    return locationOptions
      .filter((opt) => opt.value.toLowerCase().includes(q))
      .slice(0, 20);
  }, [query, locationOptions]);

  const grouped = useMemo(() => {
    const groups: Record<string, typeof filtered> = {};
    for (const opt of filtered) {
      if (!groups[opt.type]) groups[opt.type] = [];
      groups[opt.type].push(opt);
    }
    return groups;
  }, [filtered]);

  const handleSelect = (opt: { type: 'bundesland' | 'city' | 'plz'; value: string }) => {
    onLocationFilterChange({ type: opt.type, value: opt.value });
    setQuery('');
    setIsOpen(false);
  };

  const handleClear = () => {
    onLocationFilterChange(null);
    setQuery('');
  };

  return (
    <div className="hidden md:block pt-2 border-t border-[var(--border)]" ref={wrapperRef}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-[var(--text-tertiary)] uppercase tracking-wide">
          {lang === 'de' ? 'Standort' : 'Location'}
        </span>
      </div>

      {/* Active filter pill */}
      {locationFilter && (
        <div className="flex items-center gap-1.5 mb-2">
          <span className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-blue-500/20 border border-blue-500/60 text-blue-300">
            <span className="text-[10px] text-blue-400/70 uppercase">{LOCATION_TYPE_LABELS[locationFilter.type]?.[lang]}</span>
            {locationFilter.value}
            <button
              type="button"
              onClick={handleClear}
              className="ml-0.5 hover:text-blue-100 transition-colors"
              aria-label={lang === 'de' ? 'Filter entfernen' : 'Remove filter'}
            >
              <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </span>
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <svg
          className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)] pointer-events-none"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => { if (query.length >= 1) setIsOpen(true); }}
          placeholder={lang === 'de' ? 'Stadt, PLZ, Bundesland…' : 'City, ZIP, State…'}
          className="w-full pl-8 pr-3 py-2 md:py-1.5 text-sm md:text-xs bg-[var(--background)] border border-[var(--border)] rounded-md text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
        />

        {/* Dropdown */}
        {isOpen && filtered.length > 0 && (
          <div className="absolute z-50 left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--card)] shadow-lg">
            {(['bundesland', 'city', 'plz'] as const).map((type) => {
              const items = grouped[type];
              if (!items || items.length === 0) return null;
              return (
                <div key={type}>
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)] bg-[var(--background)]">
                    {LOCATION_TYPE_LABELS[type][lang]}
                  </div>
                  {items.map((opt) => (
                    <button
                      key={`${opt.type}-${opt.value}`}
                      type="button"
                      onClick={() => handleSelect(opt)}
                      className="w-full flex items-center justify-between px-2 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--card-elevated)] transition-colors"
                    >
                      <span>{opt.value}</span>
                      <span className="text-[var(--text-muted)] tabular-nums">{opt.count.toLocaleString('de-DE')}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
