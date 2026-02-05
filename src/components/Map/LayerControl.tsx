'use client';

import type { CrimeTypeKey } from '../../../lib/types/cityCrime';
import {
  CRIME_CATEGORIES_META,
  getCrimeTypesByCategory,
} from '../../../lib/types/cityCrime';
import { getCityCrimeLegendStops } from './CityCrimeLayer';
import { getKreisLegendStops } from './KreisLayer';
import type { IndicatorKey, SubMetricKey, DeutschlandatlasKey } from '../../../lib/indicators/types';
import {
  INDICATORS,
  getAuslaenderRegionsByCategory,
  getDeutschlandatlasByCategory,
  DEUTSCHLANDATLAS_META,
  isDeutschlandatlasKey,
} from '../../../lib/indicators/types';
import { CRIME_CATEGORIES, type CrimeCategory } from '@/lib/types/crime';
import { useTranslation, translations, tNested } from '@/lib/i18n';

interface LayerControlProps {
  // Indicator props
  selectedIndicator: IndicatorKey;
  onIndicatorChange: (indicator: IndicatorKey) => void;
  selectedSubMetric: SubMetricKey;
  onSubMetricChange: (subMetric: SubMetricKey) => void;
  indicatorYears?: string[];
  selectedIndicatorYear?: string;
  isIndicatorPlaying?: boolean;
  onToggleIndicatorPlay?: () => void;
  onIndicatorYearChange?: (year: string) => void;
  // Crime metric (HZ vs AQ) - only for kriminalstatistik
  cityCrimeMetric?: 'hz' | 'aq';
  onCityCrimeMetricChange?: (metric: 'hz' | 'aq') => void;
  // Blaulicht crime stats
  blaulichtStats?: {
    total: number;
    geocoded: number;
    byCategory: Record<CrimeCategory, number>;
  };
  // Blaulicht category filter
  selectedBlaulichtCategory?: CrimeCategory | null;
  onBlaulichtCategoryChange?: (category: CrimeCategory | null) => void;
}

export function LayerControl({
  selectedIndicator,
  onIndicatorChange,
  selectedSubMetric,
  onSubMetricChange,
  indicatorYears,
  selectedIndicatorYear,
  isIndicatorPlaying,
  onToggleIndicatorPlay,
  onIndicatorYearChange,
  cityCrimeMetric,
  onCityCrimeMetricChange,
  blaulichtStats,
  selectedBlaulichtCategory,
  onBlaulichtCategoryChange,
}: LayerControlProps) {
  const { lang } = useTranslation();
  const indicators = Object.values(INDICATORS);

  const hasTemporalData = Boolean(
    indicatorYears &&
    indicatorYears.length > 1 &&
    selectedIndicatorYear &&
    typeof isIndicatorPlaying === 'boolean' &&
    onToggleIndicatorPlay &&
    onIndicatorYearChange
  );

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

  const getIndicatorDescription = (key: IndicatorKey) => {
    return tNested('indicatorDescriptions', key, lang);
  };

  const getSubMetricLabel = () => {
    if (selectedIndicator === 'auslaender') return t('originRegion');
    if (selectedIndicator === 'kriminalstatistik') return t('crimeType');
    return t('indicator');
  };

  return (
    <div className="bg-[#141414]/95 backdrop-blur-sm rounded-lg shadow-xl border border-[#262626] p-3 space-y-3">
      {/* Primary indicator selector */}
      <div>
        <label
          htmlFor="metric-select"
          className="block text-xs md:text-sm font-semibold text-zinc-200 mb-1.5"
        >
          {t('primaryIndicator')}
        </label>
        <select
          id="metric-select"
          value={selectedIndicator}
          onChange={(e) => {
            onIndicatorChange(e.target.value as IndicatorKey);
          }}
          className="w-full px-3 py-2.5 md:py-2 text-sm bg-[#0a0a0a] border border-[#333] rounded-md shadow-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 appearance-none cursor-pointer"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 12px center',
          }}
        >
          {indicators.map((ind) => (
            <option key={ind.key} value={ind.key}>
              {getIndicatorLabel(ind.key)}
            </option>
          ))}
        </select>
      </div>

      {/* Indicator sub-metric selector - changes based on indicator type (hidden for blaulicht) */}
      {selectedIndicator !== 'blaulicht' && (
      <div>
        <label
          htmlFor="submetric-select"
          className="block text-[10px] text-zinc-500 mb-1"
        >
          {getSubMetricLabel()}
        </label>
        <select
          id="submetric-select"
          value={selectedSubMetric}
          onChange={(e) => onSubMetricChange(e.target.value)}
          className="w-full px-2 py-1.5 text-xs bg-[#0a0a0a] border border-[#333] rounded-md shadow-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 appearance-none cursor-pointer"
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
            className={`flex-1 px-2 py-2.5 md:py-1.5 text-xs md:text-[10px] rounded-md border transition-colors touch-feedback ${
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
            className={`flex-1 px-2 py-2.5 md:py-1.5 text-xs md:text-[10px] rounded-md border transition-colors touch-feedback ${
              cityCrimeMetric === 'aq'
                ? 'bg-green-500/20 border-green-500 text-green-300'
                : 'bg-transparent border-[#333] text-zinc-400 hover:text-zinc-200 active:bg-green-500/10'
            }`}
          >
            {t('clearanceAq')}
          </button>
        </div>
      )}

      {/* Year time slider */}
      {hasTemporalData && indicatorYears && selectedIndicatorYear && onToggleIndicatorPlay && onIndicatorYearChange && (
        <div className="pt-2 border-t border-[#333]">
          <div className="text-[10px] text-zinc-500 mb-2">{t('timeSeries')}</div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onToggleIndicatorPlay}
              aria-label={isIndicatorPlaying ? 'Pause animation' : 'Play animation'}
              className={`w-10 h-10 md:w-7 md:h-7 flex items-center justify-center rounded-lg md:rounded-md border transition-colors touch-feedback ${
                isIndicatorPlaying
                  ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                  : 'bg-[#0a0a0a] border-[#333] text-zinc-100 hover:border-amber-500/70 active:bg-amber-500/10'
              }`}
            >
              {isIndicatorPlaying ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            <div className="flex-1">
              <input
                type="range"
                min={0}
                max={indicatorYears.length - 1}
                value={indicatorYears.indexOf(selectedIndicatorYear)}
                onChange={(e) => onIndicatorYearChange(indicatorYears[parseInt(e.target.value)])}
                className="w-full"
              />
              <div className="text-lg font-bold text-amber-400 text-center mt-1">
                {selectedIndicatorYear}
              </div>
            </div>
          </div>
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
            />
          ) : (
            <KreisIndicatorLegend
              indicatorKey={selectedIndicator}
              subMetric={selectedSubMetric}
              year={selectedIndicatorYear}
              lang={lang}
            />
          )}
        </div>
      )}

      {/* Blaulicht clickable category filters */}
      {selectedIndicator === 'blaulicht' && blaulichtStats && onBlaulichtCategoryChange && (
        <div className="pt-2 border-t border-[#333]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wide">{t('categories')}</span>
            <span className="text-[10px] text-zinc-600">{blaulichtStats.geocoded}/{blaulichtStats.total} {t('located')}</span>
          </div>
          <div className="space-y-1">
            {/* All categories button */}
            <button
              onClick={() => onBlaulichtCategoryChange(null)}
              className={`w-full flex items-center gap-2 px-2 py-2 md:py-1.5 rounded-md transition-colors touch-feedback ${
                selectedBlaulichtCategory === null
                  ? 'bg-blue-500/20 border border-blue-500/50'
                  : 'hover:bg-[#1a1a1a] active:bg-[#1a1a1a] border border-transparent'
              }`}
            >
              <div
                className="w-3 h-3 md:w-2.5 md:h-2.5 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: '#3b82f6',
                  boxShadow: selectedBlaulichtCategory === null ? '0 0 6px #3b82f6' : 'none',
                }}
              />
              <span className={`text-xs md:text-[11px] flex-1 text-left no-select ${selectedBlaulichtCategory === null ? 'text-zinc-200' : 'text-zinc-400'}`}>
                {t('showAll')}
              </span>
              <span className="text-[10px] text-zinc-500 tabular-nums">{blaulichtStats.total}</span>
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
                        ? 'border'
                        : 'hover:bg-[#1a1a1a] active:bg-[#1a1a1a] border border-transparent'
                    }`}
                    style={isSelected ? {
                      backgroundColor: `${cat.color}20`,
                      borderColor: `${cat.color}50`,
                    } : {}}
                  >
                    <div
                      className="w-3 h-3 md:w-2.5 md:h-2.5 rounded-full flex-shrink-0"
                      style={{
                        backgroundColor: cat.color,
                        boxShadow: isSelected ? `0 0 6px ${cat.color}` : 'none',
                      }}
                    />
                    <span className={`text-xs md:text-[11px] flex-1 text-left no-select ${isSelected ? 'text-zinc-200' : 'text-zinc-400'}`}>
                      {catLabel}
                    </span>
                    <span className="text-[10px] text-zinc-500 tabular-nums">{count}</span>
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {/* Info text */}
      <p className="text-[10px] text-zinc-500 leading-tight hidden md:block">
        {getIndicatorDescription(selectedIndicator)}
        <br />
        <span className="text-zinc-600">{lang === 'de' ? 'Quelle' : 'Source'}: {currentIndicator.source}</span>
      </p>

      {/* Settings section with language toggle */}
      <div className="pt-2 border-t border-[#333]">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wide">
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
      className="flex items-center gap-1 px-2 py-1 bg-[#0a0a0a] rounded-md border border-[#333] text-[11px] font-medium transition-all touch-feedback active:scale-95 hover:border-[#404040]"
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
}: {
  indicatorKey: IndicatorKey;
  subMetric: SubMetricKey;
  year: string;
  lang: 'de' | 'en';
}) {
  const stops = getKreisLegendStops(indicatorKey, subMetric, year, 5);
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
      <div className="text-[10px] text-zinc-500">
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
            <span className="text-[8px] md:text-[10px] text-zinc-300 font-mono hidden md:inline">
              {stop.label}
            </span>
          </div>
        ))}
      </div>
      {/* Mobile labels - just min and max */}
      <div className="flex md:hidden justify-between text-[8px] text-zinc-400 font-mono">
        <span>{stops[0]?.label}</span>
        <span>{stops[stops.length - 1]?.label}</span>
      </div>
      <p className="text-[8px] text-zinc-500 mt-1">
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

// Blaulicht severity legend component
function BlaulichtLegend() {
  const severityItems = [
    { label: 'Messer / Schwer', severity: 5, size: 16 },
    { label: 'Raub / Körperverl.', severity: 4, size: 14 },
    { label: 'Brandstiftung / Einbruch', severity: 3, size: 12 },
    { label: 'Betrug', severity: 2, size: 10 },
    { label: 'Verkehr / Sonstiges', severity: 1, size: 8 },
  ];

  return (
    <div className="space-y-1.5">
      <div className="text-[10px] text-zinc-500">Schweregrad (Punktgröße)</div>
      {severityItems.map((item) => (
        <div key={item.severity} className="flex items-center gap-2">
          <div
            className="rounded-full flex-shrink-0"
            style={{
              width: item.size,
              height: item.size,
              backgroundColor: '#1e3a5f',
              border: '1px solid #2563eb',
              boxShadow: `0 0 ${item.size * 0.5}px #3b82f6, 0 0 ${item.size}px #3b82f640`,
            }}
          />
          <span className="text-[10px] text-zinc-400">{item.label}</span>
        </div>
      ))}
      <p className="text-[8px] text-zinc-500 mt-2">
        Größer = Schwerer
      </p>
    </div>
  );
}

// City crime legend component
function CityCrimeLegend({
  crimeType,
  metric,
  lang,
}: {
  crimeType: CrimeTypeKey;
  metric: 'hz' | 'aq';
  lang: 'de' | 'en';
}) {
  const stops = getCityCrimeLegendStops(crimeType, metric, 5);

  if (stops.length === 0) return null;

  const t = translations;

  return (
    <div className="space-y-1">
      <div className="text-[10px] text-zinc-500">
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
            <span className="text-[8px] md:text-[10px] text-zinc-300 font-mono hidden md:inline">
              {stop.label}
            </span>
          </div>
        ))}
      </div>
      {/* Mobile labels - just min and max */}
      <div className="flex md:hidden justify-between text-[8px] text-zinc-400 font-mono">
        <span>{stops[0]?.label}</span>
        <span>{stops[stops.length - 1]?.label}</span>
      </div>
      <p className="text-[8px] text-zinc-500 mt-1">
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
