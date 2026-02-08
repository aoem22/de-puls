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
import { CRIME_CATEGORIES, WEAPON_LABELS, type CrimeCategory } from '@/lib/types/crime';
import { useTranslation, translations, tNested } from '@/lib/i18n';
import type { AuslaenderRow, DeutschlandatlasRow, CityCrimeRow } from '@/lib/supabase';
import type { BlaulichtViewMode } from './HexbinLayer';

interface LayerControlProps {
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
  // Data props for legend computation
  auslaenderData?: Record<string, AuslaenderRow>;
  deutschlandatlasData?: Record<string, DeutschlandatlasRow>;
  cityCrimeData?: Record<string, Record<string, CityCrimeRow>>;
}

export const PRIMARY_INDICATOR_STACK_ORDER: IndicatorKey[] = [
  'auslaender',
  'kriminalstatistik',
  'blaulicht',
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
  favoritesCount,
  showFavoritesOnly,
  onToggleFavoritesOnly,
  blaulichtViewMode,
  onBlaulichtViewModeChange,
  pipelineRuns,
  selectedPipelineRun,
  onPipelineRunChange,
  auslaenderData: ausData,
  deutschlandatlasData: datlasData,
  cityCrimeData,
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
    <div className="bg-[#141414]/95 backdrop-blur-sm rounded-lg shadow-xl border border-[#262626] p-3 space-y-3 max-h-[calc(100vh-2rem)] overflow-y-auto scrollbar-thin">
      {/* Primary indicator selector */}
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
                    : 'border-[#333] bg-[#0a0a0a] hover:bg-[#151515] active:bg-[#151515]'
                }`}
              >
                <span
                  className={`mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${stackMeta.badgeClassName}`}
                >
                  {stackMeta.symbol}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm font-medium leading-snug ${isSelected ? 'text-zinc-100' : 'text-zinc-300'}`}>
                    {getIndicatorLabel(indicatorKey)}
                  </span>
                  <span className="block text-xs text-zinc-400 leading-snug mt-0.5">
                    {shortDescription}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Indicator sub-metric selector - changes based on indicator type (hidden for blaulicht) */}
      {selectedIndicator !== 'blaulicht' && (
      <div>
        <label
          htmlFor="submetric-select"
          className="block text-xs text-zinc-400 mb-1.5"
        >
          {getSubMetricLabel()}
        </label>
        <select
          id="submetric-select"
          value={selectedSubMetric}
          onChange={(e) => onSubMetricChange(e.target.value)}
          className="w-full px-2 py-2 text-sm bg-[#0a0a0a] border border-[#333] rounded-md shadow-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 appearance-none cursor-pointer"
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

      {/* Crime metric toggle (HZ vs AQ) - only for kriminalstatistik */}
      {selectedIndicator === 'kriminalstatistik' && cityCrimeMetric && onCityCrimeMetricChange && (
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => onCityCrimeMetricChange('hz')}
            className={`flex-1 px-2 py-2.5 md:py-2 text-sm md:text-xs rounded-md border transition-colors touch-feedback ${
              cityCrimeMetric === 'hz'
                ? 'bg-orange-500/20 border-orange-500 text-orange-300'
                : 'bg-transparent border-[#333] text-zinc-400 hover:text-zinc-200 active:bg-orange-500/10'
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
                : 'bg-transparent border-[#333] text-zinc-400 hover:text-zinc-200 active:bg-green-500/10'
            }`}
          >
            {t('clearanceAq')}
          </button>
        </div>
      )}

      {/* Legend - not shown for blaulicht (replaced by category filters) */}
      {selectedIndicator !== 'blaulicht' && selectedIndicatorYear && (
        <div className="pt-2 border-t border-[#333]">
          <div className="text-xs text-zinc-400 mb-2">{t('legend')}</div>
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
        <div className="pt-2 border-t border-[#333]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-zinc-400 uppercase tracking-wide">{lang === 'de' ? 'Pipeline-Lauf' : 'Pipeline Run'}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {/* All runs button */}
            <button
              onClick={() => onPipelineRunChange(undefined)}
              className={`px-2 py-1.5 md:py-1 text-xs rounded-md border transition-colors touch-feedback ${
                !selectedPipelineRun
                  ? 'bg-blue-500/20 border-blue-500/60 text-blue-300'
                  : 'bg-transparent border-[#333] text-zinc-400 hover:text-zinc-200'
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
                    : 'bg-transparent border-[#333] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {run} <span className="text-zinc-500">({count})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Blaulicht view mode toggle (Punkte / Dichte / Beides) */}
      {selectedIndicator === 'blaulicht' && blaulichtViewMode && onBlaulichtViewModeChange && (
        <div className="pt-2 border-t border-[#333]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-zinc-400 uppercase tracking-wide">
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
                    : 'bg-transparent border-[#333] text-zinc-400 hover:text-zinc-200 active:bg-blue-500/10'
                }`}
              >
                {lang === 'de' ? de : en}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Blaulicht clickable category filters */}
      {selectedIndicator === 'blaulicht' && blaulichtStats && onBlaulichtCategoryChange && (
        <div className="pt-2 border-t border-[#333]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-zinc-400 uppercase tracking-wide">{t('categories')}</span>
            <span className="text-xs text-zinc-400">{blaulichtStats.geocoded}/{blaulichtStats.total} {t('located')}</span>
          </div>
          <div className="space-y-1">
            {/* All categories button */}
            <button
              onClick={() => onBlaulichtCategoryChange(null)}
              className={`w-full flex items-center gap-2 px-2 py-2 md:py-1.5 rounded-md transition-colors touch-feedback ${
                selectedBlaulichtCategory === null
                  ? 'bg-[#1a1a1a] border border-white/80'
                  : 'hover:bg-[#1a1a1a] active:bg-[#1a1a1a] border border-transparent'
              }`}
            >
              <div
                className="w-3 h-3 md:w-2.5 md:h-2.5 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: '#3b82f6',
                  boxShadow: 'none',
                }}
              />
              <span className={`text-sm md:text-xs flex-1 text-left no-select ${selectedBlaulichtCategory === null ? 'text-zinc-200' : 'text-zinc-400'}`}>
                {t('showAll')}
              </span>
              <span className="text-xs text-zinc-400 tabular-nums">{blaulichtStats.total}</span>
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
                        ? 'bg-[#1a1a1a] border border-white/80'
                        : 'hover:bg-[#1a1a1a] active:bg-[#1a1a1a] border border-transparent'
                    }`}
                  >
                    <div
                      className="w-3 h-3 md:w-2.5 md:h-2.5 rounded-full flex-shrink-0"
                      style={{
                        backgroundColor: cat.color,
                        boxShadow: 'none',
                      }}
                    />
                    <span className={`text-sm md:text-xs flex-1 text-left no-select ${isSelected ? 'text-zinc-200' : 'text-zinc-400'}`}>
                      {catLabel}
                    </span>
                    <span className="text-xs text-zinc-400 tabular-nums">{count}</span>
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {/* Weapon type sub-filters */}
      {selectedIndicator === 'blaulicht' && weaponCounts && onWeaponTypeChange && Object.keys(weaponCounts).length > 0 && (
        <div className="pt-2 border-t border-[#333]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-zinc-400 uppercase tracking-wide">{lang === 'de' ? 'Tatmittel' : 'Weapons'}</span>
          </div>
          <div className="space-y-1">
            {Object.entries(weaponCounts)
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
                        ? 'bg-[#1a1a1a] border border-white/80'
                        : 'hover:bg-[#1a1a1a] active:bg-[#1a1a1a] border border-transparent'
                    }`}
                  >
                    <span className="w-3 md:w-2.5 text-center text-xs flex-shrink-0">{label.icon}</span>
                    <span className={`text-sm md:text-xs flex-1 text-left no-select ${isSelected ? 'text-zinc-200' : 'text-zinc-400'}`}>
                      {label[lang]}
                    </span>
                    <span className="text-xs text-zinc-400 tabular-nums">{count}</span>
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {/* Favorites filter */}
      {selectedIndicator === 'blaulicht' && onToggleFavoritesOnly && (favoritesCount ?? 0) > 0 && (
        <div className="pt-2 border-t border-[#333]">
          <button
            onClick={onToggleFavoritesOnly}
            className={`w-full flex items-center gap-2 px-2 py-2 md:py-1.5 rounded-md transition-colors touch-feedback ${
              showFavoritesOnly
                ? 'bg-amber-500/15 border border-amber-500/60'
                : 'hover:bg-[#1a1a1a] active:bg-[#1a1a1a] border border-transparent'
            }`}
          >
            <span className="w-3 md:w-2.5 text-center text-sm flex-shrink-0">
              {showFavoritesOnly ? '\u2605' : '\u2606'}
            </span>
            <span className={`text-sm md:text-xs flex-1 text-left no-select ${showFavoritesOnly ? 'text-amber-300' : 'text-zinc-400'}`}>
              {lang === 'de' ? 'Favoriten' : 'Favorites'}
            </span>
            <span className="text-xs text-zinc-400 tabular-nums">{favoritesCount}</span>
          </button>
        </div>
      )}

      {/* Info text */}
      <p className="text-xs text-zinc-400 leading-tight hidden md:block">
        <span className="text-zinc-400">{lang === 'de' ? 'Quelle' : 'Source'}: {currentIndicator.source}</span>
      </p>

      {/* Settings section with language toggle */}
      <div className="pt-2 border-t border-[#333]">
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-400 uppercase tracking-wide">
            {lang === 'de' ? 'Sprache' : 'Language'}
          </span>
          <LanguageToggleInline />
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
      className="flex items-center gap-1 px-2 py-1 bg-[#0a0a0a] rounded-md border border-[#333] text-xs font-medium transition-all touch-feedback active:scale-95 hover:border-[#404040]"
      aria-label={lang === 'de' ? 'Switch to English' : 'Auf Deutsch wechseln'}
    >
      <span className={`transition-colors ${lang === 'de' ? 'text-amber-400' : 'text-zinc-500'}`}>
        DE
      </span>
      <span className="text-zinc-600">/</span>
      <span className={`transition-colors ${lang === 'en' ? 'text-amber-400' : 'text-zinc-500'}`}>
        EN
      </span>
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
      <div className="text-xs text-zinc-400">
        {displayUnit || t.value[lang]}
      </div>
      <div className="flex md:flex-col gap-1 md:gap-0.5">
        {stops.map((stop, index) => (
          <div
            key={index}
            className="flex flex-col md:flex-row items-center gap-0.5 md:gap-2 flex-1 md:flex-none"
          >
            <div
              className="w-full md:w-5 h-2.5 md:h-3 rounded-sm border border-[#444]"
              style={{ backgroundColor: stop.color }}
            />
            <span className="text-[11px] md:text-xs text-zinc-300 font-mono hidden md:inline">
              {stop.label}
            </span>
          </div>
        ))}
      </div>
      {/* Mobile labels - just min and max */}
      <div className="flex md:hidden justify-between text-[10px] text-zinc-400 font-mono">
        <span>{stops[0]?.label}</span>
        <span>{stops[stops.length - 1]?.label}</span>
      </div>
      <p className="text-[11px] text-zinc-400 mt-1 leading-snug">
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
      <div className="text-xs text-zinc-400">
        {metric === 'hz' ? t.casesPerPopulation[lang] : t.clearanceRatePercent[lang]}
      </div>
      <div className="flex md:flex-col gap-1 md:gap-0.5">
        {stops.map((stop, index) => (
          <div
            key={index}
            className="flex flex-col md:flex-row items-center gap-0.5 md:gap-2 flex-1 md:flex-none"
          >
            <div
              className="w-full md:w-5 h-2.5 md:h-3 rounded-sm border border-[#444]"
              style={{ backgroundColor: stop.color }}
            />
            <span className="text-[11px] md:text-xs text-zinc-300 font-mono hidden md:inline">
              {stop.label}
            </span>
          </div>
        ))}
      </div>
      {/* Mobile labels - just min and max */}
      <div className="flex md:hidden justify-between text-[10px] text-zinc-400 font-mono">
        <span>{stops[0]?.label}</span>
        <span>{stops[stops.length - 1]?.label}</span>
      </div>
      <p className="text-[11px] text-zinc-400 mt-1 leading-snug">
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
