'use client';

import { useMemo, useRef, useEffect, useCallback, useState, type TouchEvent } from 'react';
import type { IndicatorKey, SubMetricKey, AuslaenderRegionKey, DeutschlandatlasKey } from '../../../lib/indicators/types';
import {
  AUSLAENDER_REGION_META,
  DEUTSCHLANDATLAS_META,
  isDeutschlandatlasKey,
} from '../../../lib/indicators/types';
import { getCrimeTypeConfig, type CrimeTypeKey } from '../../../lib/types/cityCrime';
import { formatNumber, formatDetailValue, calcPercent } from '../../../lib/utils/formatters';
import { useTranslation, translations, tNested, type Language } from '@/lib/i18n';
import type { AuslaenderRow, DeutschlandatlasRow, CityCrimeRow } from '@/lib/supabase';

interface RankingItem {
  ags: string;
  name: string;
  value: number;
  rank: number;
  percentage: number;
}

interface RankingPanelProps {
  indicatorKey: IndicatorKey;
  subMetric: SubMetricKey;
  selectedYear: string;
  hoveredAgs: string | null;
  selectedAgs: string | null;
  onHoverAgs: (ags: string | null) => void;
  onSelectAgs: (ags: string | null) => void;
  isMobileOpen?: boolean;
  onMobileToggle?: () => void;
  isVisible?: boolean;
  auslaenderData?: Record<string, AuslaenderRow>;
  deutschlandatlasData?: Record<string, DeutschlandatlasRow>;
  cityCrimeData?: Record<string, Record<string, CityCrimeRow>>;
  cityCrimeMetric?: 'hz' | 'aq';
  deutschlandatlasYear?: string;
}

// ============ Draggable Bottom Sheet Hook ============

function useDraggableSheet(onClose: () => void, threshold = 100) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef<number>(0);
  const currentTranslateY = useRef<number>(0);
  const isDragging = useRef<boolean>(false);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const target = e.target as HTMLElement;
    // Only start drag from the header area or drag handle
    if (!target.closest('.sheet-drag-area')) return;

    isDragging.current = true;
    dragStartY.current = e.touches[0].clientY;
    currentTranslateY.current = 0;

    if (sheetRef.current) {
      sheetRef.current.style.transition = 'none';
    }
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isDragging.current || !sheetRef.current) return;

    const deltaY = e.touches[0].clientY - dragStartY.current;
    // Only allow dragging down
    if (deltaY > 0) {
      currentTranslateY.current = deltaY;
      sheetRef.current.style.transform = `translateY(${deltaY}px)`;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging.current || !sheetRef.current) return;

    isDragging.current = false;
    sheetRef.current.style.transition = 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)';

    if (currentTranslateY.current > threshold) {
      // Close the sheet
      sheetRef.current.style.transform = 'translateY(100%)';
      setTimeout(onClose, 300);
    } else {
      // Snap back
      sheetRef.current.style.transform = 'translateY(0)';
    }
    currentTranslateY.current = 0;
  }, [onClose, threshold]);

  return {
    sheetRef,
    handlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
  };
}

// ============ Utility Functions ============

/**
 * Format ranking value with indicator-aware decimal places
 * Uses more decimals for Deutschlandatlas values depending on magnitude
 */
function formatRankingValue(
  val: number,
  indicatorKey: IndicatorKey,
  subMetric: SubMetricKey,
  cityCrimeMetric: 'hz' | 'aq' = 'hz'
): string {
  if (indicatorKey === 'deutschlandatlas' && isDeutschlandatlasKey(subMetric)) {
    if (val >= 10000) {
      return val.toLocaleString('de-DE', { maximumFractionDigits: 0 });
    }
    if (val >= 100) {
      return val.toLocaleString('de-DE', { maximumFractionDigits: 1 });
    }
    return val.toLocaleString('de-DE', { maximumFractionDigits: 2 });
  }
  if (indicatorKey === 'kriminalstatistik') {
    return val.toLocaleString('de-DE', {
      maximumFractionDigits: 1,
      minimumFractionDigits: cityCrimeMetric === 'aq' ? 1 : 0,
    });
  }
  return val.toLocaleString('de-DE', { maximumFractionDigits: 0 });
}

function getUnit(indicatorKey: IndicatorKey, subMetric: SubMetricKey, cityCrimeMetric: 'hz' | 'aq' = 'hz'): string {
  if (indicatorKey === 'deutschlandatlas' && isDeutschlandatlasKey(subMetric)) {
    return DEUTSCHLANDATLAS_META[subMetric].unitDe;
  }
  if (indicatorKey === 'kriminalstatistik') {
    return cityCrimeMetric === 'hz' ? 'pro 100.000' : '%';
  }
  return '';
}

function getIndicatorLabel(indicatorKey: IndicatorKey, subMetric: SubMetricKey, lang: Language): string {
  if (indicatorKey === 'auslaender') {
    const regionLabel = tNested('regions', subMetric, lang);
    return regionLabel !== subMetric ? regionLabel : (AUSLAENDER_REGION_META[subMetric as AuslaenderRegionKey]?.labelDe ?? 'Ausländer');
  }
  if (indicatorKey === 'deutschlandatlas' && isDeutschlandatlasKey(subMetric)) {
    const atlasLabel = tNested('atlasIndicators', subMetric, lang);
    return atlasLabel !== subMetric ? atlasLabel : DEUTSCHLANDATLAS_META[subMetric].labelDe;
  }
  if (indicatorKey === 'kriminalstatistik') {
    const crimeTypeConfig = getCrimeTypeConfig(subMetric as CrimeTypeKey);
    if (crimeTypeConfig) return lang === 'de' ? crimeTypeConfig.labelDe : crimeTypeConfig.label;
  }
  return tNested('indicators', indicatorKey, lang);
}

function getRegionLabel(region: AuslaenderRegionKey, lang: Language): string {
  const translated = tNested('regions', region, lang);
  return translated !== region ? translated : (AUSLAENDER_REGION_META[region]?.labelDe ?? region);
}

function getRankingBarGradient(indicatorKey: IndicatorKey, isActive: boolean): string {
  const gradients: Record<IndicatorKey, { idle: string; active: string }> = {
    auslaender: {
      idle: 'linear-gradient(90deg, rgba(220, 38, 38, 0.72) 0%, rgba(239, 68, 68, 0.72) 100%)',
      active: 'linear-gradient(90deg, rgba(239, 68, 68, 0.95) 0%, rgba(248, 113, 113, 0.95) 100%)',
    },
    deutschlandatlas: {
      idle: 'linear-gradient(90deg, rgba(139, 92, 246, 0.72) 0%, rgba(168, 85, 247, 0.72) 100%)',
      active: 'linear-gradient(90deg, rgba(167, 139, 250, 0.95) 0%, rgba(196, 181, 253, 0.95) 100%)',
    },
    kriminalstatistik: {
      idle: 'linear-gradient(90deg, rgba(217, 119, 6, 0.72) 0%, rgba(234, 88, 12, 0.72) 100%)',
      active: 'linear-gradient(90deg, rgba(245, 158, 11, 0.95) 0%, rgba(249, 115, 22, 0.95) 100%)',
    },
    blaulicht: {
      idle: 'linear-gradient(90deg, rgba(37, 99, 235, 0.72) 0%, rgba(59, 130, 246, 0.72) 100%)',
      active: 'linear-gradient(90deg, rgba(59, 130, 246, 0.95) 0%, rgba(96, 165, 250, 0.95) 100%)',
    },
  };

  const gradient = gradients[indicatorKey] ?? gradients.kriminalstatistik;
  return isActive ? gradient.active : gradient.idle;
}

// ============ Detail View Components ============

function AuslaenderDetailContent({
  record,
  selectedRegion,
  lang,
}: {
  record: { name: string; ags: string; regions: Record<AuslaenderRegionKey, { male: number | null; female: number | null; total: number | null }> };
  selectedRegion: AuslaenderRegionKey;
  lang: Language;
}) {
  const total = record.regions.total?.total;
  const selectedValue = record.regions[selectedRegion]?.total;
  const selectedData = record.regions[selectedRegion];

  const continents = ['europa', 'asien', 'afrika', 'amerika', 'ozeanien'] as const;
  const specialRegions = ['eu27', 'drittstaaten', 'gastarbeiter', 'exjugoslawien', 'exsowjetunion'] as const;

  const t = translations;

  return (
    <>
      {/* Total */}
      <div className="flex items-baseline justify-between">
        <span className="text-[var(--text-tertiary)] text-sm uppercase tracking-wide">{t.totalForeigners[lang]}</span>
        <span className="text-2xl font-bold text-red-400">{formatNumber(total)}</span>
      </div>

      {/* Selected region highlight */}
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-red-400 text-xs font-medium">{t.current[lang]}: {getRegionLabel(selectedRegion, lang)}</span>
          <span className="text-[var(--text-tertiary)] text-xs">{calcPercent(selectedValue, total)}</span>
        </div>
        <div className="text-[var(--foreground)] text-xl font-semibold">{formatNumber(selectedValue)}</div>
        {selectedData && (
          <div className="flex gap-4 mt-2 text-xs">
            <div className="flex items-center gap-1">
              <span className="text-blue-400">&#9794;</span>
              <span className="text-[var(--text-secondary)]">{formatNumber(selectedData.male)}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-pink-400">&#9792;</span>
              <span className="text-[var(--text-secondary)]">{formatNumber(selectedData.female)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Continent breakdown */}
      <div>
        <h4 className="text-[var(--text-tertiary)] text-xs uppercase tracking-wider mb-2">{t.byContinent[lang]}</h4>
        <div className="space-y-1">
          {continents.map((continent) => {
            const val = record.regions[continent]?.total;
            const isSelected = selectedRegion === continent;
            const pct = calcPercent(val, total);

            return (
              <div
                key={continent}
                className={`flex justify-between py-1.5 px-2 rounded ${isSelected ? 'bg-red-500/15' : ''}`}
              >
                <span className={`text-xs ${isSelected ? 'text-red-400' : 'text-[var(--text-tertiary)]'}`}>
                  {getRegionLabel(continent, lang)}
                </span>
                <span className={`text-xs ${isSelected ? 'text-red-400 font-medium' : 'text-[var(--foreground)]'}`}>
                  {formatNumber(val)}
                  {pct && <span className="text-[var(--text-tertiary)] ml-1.5 text-xs">{pct}</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Special groups */}
      <div>
        <h4 className="text-[var(--text-tertiary)] text-xs uppercase tracking-wider mb-2">{t.otherGroups[lang]}</h4>
        <div className="space-y-1">
          {specialRegions.map((region) => {
            const val = record.regions[region]?.total;
            if (val === null || val === undefined) return null;
            const isSelected = selectedRegion === region;
            const pct = calcPercent(val, total);

            return (
              <div
                key={region}
                className={`flex justify-between py-1.5 px-2 rounded ${isSelected ? 'bg-red-500/15' : ''}`}
              >
                <span className={`text-xs ${isSelected ? 'text-red-400' : 'text-[var(--text-secondary)]'}`}>
                  {getRegionLabel(region, lang)}
                </span>
                <span className={`text-xs ${isSelected ? 'text-red-400 font-medium' : 'text-[var(--text-secondary)]'}`}>
                  {formatNumber(val)}
                  {pct && <span className="text-[var(--text-tertiary)] ml-1.5 text-xs">{pct}</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function DeutschlandatlasDetailContent({
  record,
  selectedIndicator,
  lang,
}: {
  record: { name: string; ags: string; indicators: Record<string, number | null> };
  selectedIndicator: DeutschlandatlasKey;
  lang: Language;
}) {
  const meta = DEUTSCHLANDATLAS_META[selectedIndicator];
  const value = record.indicators[selectedIndicator];
  const t = translations;

  const getAtlasLabel = (key: DeutschlandatlasKey) => {
    const translated = tNested('atlasIndicators', key, lang);
    return translated !== key ? translated : DEUTSCHLANDATLAS_META[key].labelDe;
  };

  const indicatorsByCategory = useMemo(() => {
    const grouped = new Map<string, { key: DeutschlandatlasKey; value: number | null; meta: typeof meta }[]>();

    for (const [key, val] of Object.entries(record.indicators)) {
      if (!isDeutschlandatlasKey(key)) continue;
      const indicatorMeta = DEUTSCHLANDATLAS_META[key];
      const category = indicatorMeta.categoryDe;

      if (!grouped.has(category)) {
        grouped.set(category, []);
      }
      grouped.get(category)!.push({ key: key as DeutschlandatlasKey, value: val, meta: indicatorMeta });
    }

    return grouped;
  }, [record.indicators]);

  const priorityIndicators: DeutschlandatlasKey[] = [
    'kinder_bg', 'alq', 'sozsich', 'hh_veink', 'bev_ausl', 'straft', 'schule_oabschl', 'wahl_beteil'
  ];

  return (
    <>
      {/* Selected indicator highlight */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-amber-400 text-xs font-medium">{getAtlasLabel(selectedIndicator)}</span>
          <span className="text-[var(--text-tertiary)] text-xs">{meta.categoryDe}</span>
        </div>
        <div className="text-[var(--foreground)] text-xl font-semibold">
          {formatDetailValue(value)}
          {meta.unitDe && <span className="text-[var(--text-tertiary)] text-sm ml-1">{meta.unitDe}</span>}
        </div>
        <p className="text-[var(--text-tertiary)] text-xs mt-1">{meta.descriptionDe}</p>
        {meta.higherIsBetter !== undefined && (
          <div className={`text-xs mt-1 ${meta.higherIsBetter ? 'text-green-400' : 'text-orange-400'}`}>
            {meta.higherIsBetter ? `↑ ${t.higherIsBetter[lang]}` : `↓ ${t.lowerIsBetter[lang]}`}
          </div>
        )}
      </div>

      {/* Priority indicators overview */}
      <div>
        <h4 className="text-[var(--text-tertiary)] text-xs uppercase tracking-wider mb-2">{t.importantIndicators[lang]}</h4>
        <div className="space-y-1">
          {priorityIndicators.map((key) => {
            const val = record.indicators[key];
            const indMeta = DEUTSCHLANDATLAS_META[key];
            const isSelected = selectedIndicator === key;

            return (
              <div
                key={key}
                className={`flex justify-between py-1.5 px-2 rounded ${isSelected ? 'bg-amber-500/15' : ''}`}
              >
                <span className={`text-xs ${isSelected ? 'text-amber-400' : 'text-[var(--text-tertiary)]'}`}>
                  {getAtlasLabel(key)}
                </span>
                <span className={`text-xs ${isSelected ? 'text-amber-400 font-medium' : 'text-[var(--foreground)]'}`}>
                  {formatDetailValue(val)}
                  {indMeta.unitDe && <span className="text-[var(--text-tertiary)] ml-1 text-xs">{indMeta.unitDe}</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* All indicators by category (collapsed by default) */}
      <details className="group">
        <summary className="text-[var(--text-tertiary)] text-xs uppercase tracking-wider cursor-pointer hover:text-[var(--text-primary)] list-none flex items-center gap-1">
          <span className="group-open:rotate-90 transition-transform">&#9654;</span>
          {t.allIndicators[lang]} ({Object.keys(record.indicators).length})
        </summary>
        <div className="mt-2 space-y-3 max-h-60 overflow-y-auto">
          {Array.from(indicatorsByCategory.entries()).map(([category, indicators]) => (
            <div key={category}>
              <h5 className="text-[var(--text-tertiary)] text-[11px] uppercase tracking-wider mb-1">{category}</h5>
              <div className="space-y-0.5">
                {indicators.map(({ key, value: val, meta: indMeta }) => {
                  const isSelected = selectedIndicator === key;
                  return (
                    <div
                      key={key}
                      className={`flex justify-between py-1 px-1.5 rounded text-xs ${isSelected ? 'bg-amber-500/15' : ''}`}
                    >
                      <span className={isSelected ? 'text-amber-400' : 'text-[var(--text-secondary)]'}>
                        {getAtlasLabel(key)}
                      </span>
                      <span className={isSelected ? 'text-amber-400' : 'text-[var(--text-secondary)]'}>
                        {formatDetailValue(val)}
                        {indMeta.unitDe && <span className="text-[var(--text-tertiary)] ml-0.5">{indMeta.unitDe}</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </details>
    </>
  );
}

function CityCrimeDetailContent({
  record,
  selectedCrimeType,
  metric,
  lang,
}: {
  record: { name: string; ags: string; crimes: Record<string, { cases: number; hz: number; aq: number }> };
  selectedCrimeType: CrimeTypeKey;
  metric: 'hz' | 'aq';
  lang: Language;
}) {
  const t = translations;
  const selectedType = getCrimeTypeConfig(selectedCrimeType);
  const selectedStats = record.crimes[selectedCrimeType];

  const rankingMetricLabel = metric === 'hz' ? t.frequencyHz[lang] : t.clearanceAq[lang];
  const secondaryMetricLabel = metric === 'hz' ? t.clearanceAq[lang] : t.frequencyHz[lang];
  const rankingMetricUnit = metric === 'hz' ? 'pro 100.000' : '%';
  const secondaryMetricUnit = metric === 'hz' ? '%' : 'pro 100.000';

  const crimeTypesByMetric = useMemo(() => {
    return Object.entries(record.crimes)
      .map(([key, stats]) => {
        const config = getCrimeTypeConfig(key as CrimeTypeKey);
        if (!config) return null;
        return {
          key,
          label: lang === 'de' ? config.labelDe : config.label,
          stats,
          value: metric === 'hz' ? stats.hz : stats.aq,
        };
      })
      .filter((entry): entry is { key: string; label: string; stats: { cases: number; hz: number; aq: number }; value: number } => {
        return entry !== null && Number.isFinite(entry.value);
      })
      .sort((left, right) => right.value - left.value);
  }, [record.crimes, metric, lang]);

  if (!selectedStats) {
    return (
      <div className="bg-[var(--card-elevated)]/50 border border-[var(--border)] rounded-lg p-3 text-[var(--text-secondary)] text-sm">
        {t.noDataAvailable[lang]}
      </div>
    );
  }

  return (
    <>
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-amber-300 text-sm font-semibold">
            {lang === 'de' ? (selectedType?.labelDe ?? selectedCrimeType) : (selectedType?.label ?? selectedCrimeType)}
          </span>
          <span className="text-[var(--text-tertiary)] text-xs">{rankingMetricLabel}</span>
        </div>
        <div className="text-[var(--foreground)] text-xl font-semibold">
          {formatDetailValue(metric === 'hz' ? selectedStats.hz : selectedStats.aq)}
          <span className="text-[var(--text-tertiary)] text-sm ml-1">{rankingMetricUnit}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-[var(--card-elevated)]/40 rounded-lg px-3 py-2 border border-[var(--border)]/50">
          <div className="text-[var(--text-tertiary)] text-xs uppercase tracking-wide mb-0.5">
            {lang === 'de' ? 'Fälle' : 'Cases'}
          </div>
          <div className="text-[var(--foreground)] text-base font-semibold">
            {formatNumber(selectedStats.cases)}
          </div>
        </div>
        <div className="bg-[var(--card-elevated)]/40 rounded-lg px-3 py-2 border border-[var(--border)]/50">
          <div className="text-[var(--text-tertiary)] text-xs uppercase tracking-wide mb-0.5">
            {secondaryMetricLabel}
          </div>
          <div className="text-[var(--foreground)] text-base font-semibold">
            {formatDetailValue(metric === 'hz' ? selectedStats.aq : selectedStats.hz)}
            <span className="text-[var(--text-tertiary)] text-xs ml-1">{secondaryMetricUnit}</span>
          </div>
        </div>
      </div>

      <div>
        <h4 className="text-[var(--text-tertiary)] text-xs uppercase tracking-wider mb-2">
          {lang === 'de' ? 'Alle Delikte' : 'All Offenses'} ({crimeTypesByMetric.length})
        </h4>
        <div className="space-y-1 max-h-56 overflow-y-auto scrollbar-thin pr-1">
          {crimeTypesByMetric.map((entry) => {
            const isSelected = entry.key === selectedCrimeType;

            return (
              <div
                key={entry.key}
                className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-1.5 px-2 rounded ${isSelected ? 'bg-amber-500/15' : ''}`}
              >
                <span className={`text-sm font-medium min-w-0 truncate ${isSelected ? 'text-amber-300' : 'text-[var(--text-primary)]'}`}>
                  {entry.label}
                </span>
                <span className={`text-sm whitespace-nowrap tabular-nums font-semibold ${isSelected ? 'text-amber-300' : 'text-[var(--text-primary)]'}`}>
                  {formatDetailValue(entry.value)}
                  <span className="text-[var(--text-tertiary)] ml-1 text-xs whitespace-nowrap">{rankingMetricUnit}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ============ Mobile Sheet Components ============

function MobileDetailSheet({
  selectedRecord,
  selectedRank,
  indicatorKey,
  subMetric,
  cityCrimeMetric,
  isAuslaenderAccent,
  selectedYear,
  onClose,
  lang,
}: {
  selectedRecord: {
    name: string;
    ags: string;
    regions?: Record<AuslaenderRegionKey, { male: number | null; female: number | null; total: number | null }>;
    indicators?: Record<string, number | null>;
    crimes?: Record<string, { cases: number; hz: number; aq: number }>;
  };
  selectedRank: number | null;
  indicatorKey: IndicatorKey;
  subMetric: SubMetricKey;
  cityCrimeMetric: 'hz' | 'aq';
  isAuslaenderAccent: boolean;
  selectedYear: string;
  onClose: () => void;
  lang: Language;
}) {
  const { sheetRef, handlers } = useDraggableSheet(onClose);
  const t = translations;

  return (
    <>
      {/* Backdrop */}
      <div
        className="md:hidden fixed inset-0 z-[1000] bg-black/40 backdrop-enter"
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className="md:hidden fixed inset-x-0 bottom-0 z-[1001] bg-[var(--card)]/98 backdrop-blur-sm rounded-t-2xl shadow-2xl border-t border-[var(--card-border)] max-h-[70vh] mobile-bottom-sheet flex flex-col overflow-hidden animate-slide-up-spring"
        {...handlers}
      >
        {/* Drag handle */}
        <div className="sheet-drag-area flex justify-center py-3 shrink-0 cursor-grab active:cursor-grabbing">
          <div className="drag-handle w-10 h-1 bg-zinc-600 rounded-full" />
        </div>

        {/* Header */}
        <div className="sheet-drag-area flex items-start justify-between px-4 pb-3 border-b border-[var(--card-border)] shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {selectedRank && (
                <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${isAuslaenderAccent ? 'text-red-400 bg-red-500/10' : 'text-amber-400 bg-amber-500/10'}`}>
                  #{selectedRank}
                </span>
              )}
              <h3 className="text-[var(--foreground)] font-bold text-base leading-tight truncate">{selectedRecord.name}</h3>
            </div>
            <span className="text-[var(--text-tertiary)] text-sm">
              {selectedYear}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-tertiary)] p-2 -mr-2 touch-feedback active:bg-white/10 rounded-lg"
            aria-label={t.close[lang]}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto scroll-touch flex-1 p-4 space-y-4">
          {indicatorKey === 'auslaender' ? (
            <AuslaenderDetailContent
              record={selectedRecord as { name: string; ags: string; regions: Record<AuslaenderRegionKey, { male: number | null; female: number | null; total: number | null }> }}
              selectedRegion={subMetric as AuslaenderRegionKey}
              lang={lang}
            />
          ) : indicatorKey === 'deutschlandatlas' ? (
            <DeutschlandatlasDetailContent
              record={selectedRecord as { name: string; ags: string; indicators: Record<string, number | null> }}
              selectedIndicator={subMetric as DeutschlandatlasKey}
              lang={lang}
            />
          ) : (
            <CityCrimeDetailContent
              record={selectedRecord as { name: string; ags: string; crimes: Record<string, { cases: number; hz: number; aq: number }> }}
              selectedCrimeType={subMetric as CrimeTypeKey}
              metric={cityCrimeMetric}
              lang={lang}
            />
          )}
        </div>
      </div>
    </>
  );
}

function MobileRankingSheet({
  indicatorLabel,
  rankings,
  filteredRankings,
  indicatorKey,
  subMetric,
  cityCrimeMetric,
  isAuslaenderAccent,
  selectedYear,
  locationLabel,
  searchQuery,
  onSearchChange,
  onSelectAgs,
  onClose,
  lang,
}: {
  indicatorLabel: string;
  rankings: RankingItem[];
  filteredRankings: RankingItem[];
  indicatorKey: IndicatorKey;
  subMetric: SubMetricKey;
  cityCrimeMetric: 'hz' | 'aq';
  isAuslaenderAccent: boolean;
  selectedYear: string;
  locationLabel: string;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onSelectAgs: (ags: string | null) => void;
  onClose: () => void;
  lang: Language;
}) {
  const { sheetRef, handlers } = useDraggableSheet(onClose);
  const t = translations;

  return (
    <>
      {/* Backdrop */}
      <div
        className="md:hidden fixed inset-0 z-[1000] bg-black/40 backdrop-enter"
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className="md:hidden fixed inset-x-0 bottom-0 z-[1001] bg-[var(--card)]/98 backdrop-blur-sm rounded-t-2xl shadow-2xl border-t border-[var(--card-border)] max-h-[70vh] mobile-bottom-sheet flex flex-col overflow-hidden animate-slide-up-spring"
        {...handlers}
      >
        {/* Drag handle */}
        <div className="sheet-drag-area flex justify-center py-3 shrink-0 cursor-grab active:cursor-grabbing">
          <div className="drag-handle w-10 h-1 bg-zinc-600 rounded-full" />
        </div>

        {/* Header */}
        <div className="sheet-drag-area flex items-center justify-between px-4 pb-3 border-b border-[var(--card-border)] shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <h3 className="text-[var(--foreground)] font-semibold text-sm truncate">
                {indicatorLabel}
              </h3>
            </div>
            <div className="text-[var(--text-tertiary)] text-xs">
              {rankings.length} {locationLabel} · {selectedYear}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-tertiary)] p-2 -mr-2 touch-feedback active:bg-white/10 rounded-lg"
            aria-label={t.close[lang]}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="shrink-0 px-4 py-2 border-b border-[var(--card-border)]/50">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder={t.search[lang]}
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className={`w-full bg-[var(--card-elevated)] border border-[var(--border)] rounded-lg pl-9 pr-4 py-2.5 text-sm text-[var(--foreground)] placeholder-zinc-600 focus:outline-none transition-colors ${isAuslaenderAccent ? 'focus:border-red-500/50' : 'focus:border-amber-500/50'}`}
            />
          </div>
        </div>

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto scroll-touch">
          {filteredRankings.length === 0 ? (
            <div className="p-4 text-center text-[var(--text-tertiary)] text-sm">
              {searchQuery ? t.noResults[lang] : t.noDataAvailable[lang]}
            </div>
          ) : (
            <div className="py-1">
              {filteredRankings.map((item) => (
                <div
                  key={item.ags}
                  className={`px-4 py-3 touch-feedback transition-colors border-b border-[var(--card-border)]/30 ${isAuslaenderAccent ? 'active:bg-red-500/15' : 'active:bg-amber-500/15'}`}
                  onClick={() => {
                    onSelectAgs(item.ags);
                    onClose();
                  }}
                >
                  <div className="flex items-center gap-3">
                    <span className="w-8 text-right text-sm font-mono text-[var(--text-muted)]">
                      {item.rank}.
                    </span>
                    <span className="flex-1 text-sm text-[var(--foreground)] truncate">
                      {item.name}
                    </span>
                    <span className="text-sm font-mono text-[var(--text-tertiary)]">
                      {formatRankingValue(item.value, indicatorKey, subMetric, cityCrimeMetric)}
                    </span>
                  </div>
                  <div className="mt-2 ml-11 h-1.5 bg-[var(--card-elevated)] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${item.percentage}%`,
                        background: getRankingBarGradient(indicatorKey, false),
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer with count */}
        {searchQuery && filteredRankings.length !== rankings.length && (
          <div className="shrink-0 px-4 py-2 border-t border-[var(--card-border)]/50 text-[var(--text-tertiary)] text-sm text-center safe-area-pb">
            {filteredRankings.length} {t.of[lang]} {rankings.length} {t.shown[lang]}
          </div>
        )}
      </div>
    </>
  );
}

// ============ Main Component ============

export function RankingPanel({
  indicatorKey,
  subMetric,
  selectedYear,
  hoveredAgs,
  selectedAgs,
  onHoverAgs,
  onSelectAgs,
  isMobileOpen = false,
  onMobileToggle,
  isVisible = true,
  auslaenderData: ausData,
  deutschlandatlasData: datlasData,
  cityCrimeData,
  cityCrimeMetric = 'hz',
  deutschlandatlasYear,
}: RankingPanelProps) {
  const { lang } = useTranslation();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isHoverFromListRef = useRef(false);
  const [searchQuery, setSearchQuery] = useState('');
  const lastManualInputRef = useRef<number>(0);
  const hoverScrollRafRef = useRef<number | null>(null);
  const t = translations;

  // Compute rankings from indicator data
  const rankings = useMemo((): RankingItem[] => {
    const items: { ags: string; name: string; value: number }[] = [];

    if (indicatorKey === 'auslaender') {
      if (!ausData) return [];

      for (const [ags, record] of Object.entries(ausData)) {
        const regionData = record.regions[subMetric as AuslaenderRegionKey];
        const value = regionData?.total;
        if (value !== null && value !== undefined && value > 0) {
          items.push({ ags, name: record.name, value });
        }
      }
    } else if (indicatorKey === 'deutschlandatlas') {
      if (!datlasData) return [];

      for (const [ags, record] of Object.entries(datlasData)) {
        const value = record.indicators[subMetric];
        if (value !== null && value !== undefined) {
          items.push({ ags, name: record.name, value });
        }
      }
    } else if (indicatorKey === 'kriminalstatistik') {
      if (!cityCrimeData) return [];
      const yearData = cityCrimeData[selectedYear];
      if (!yearData) return [];

      for (const [ags, record] of Object.entries(yearData)) {
        const stats = record.crimes[subMetric];
        if (!stats) continue;
        const value = cityCrimeMetric === 'hz' ? stats.hz : stats.aq;
        if (Number.isFinite(value)) {
          items.push({ ags, name: record.name, value });
        }
      }
    }

    if (items.length === 0) return [];

    items.sort((a, b) => b.value - a.value);
    const maxValue = items[0].value;

    return items.map((item, index) => ({
      ...item,
      rank: index + 1,
      percentage: maxValue > 0 ? (item.value / maxValue) * 100 : 0,
    }));
  }, [indicatorKey, subMetric, selectedYear, cityCrimeMetric, ausData, datlasData, cityCrimeData]);

  // Get selected record for detail view
  const selectedRecord = useMemo(() => {
    if (!selectedAgs) return null;

    if (indicatorKey === 'auslaender') {
      if (!ausData) return null;
      return ausData[selectedAgs] ?? null;
    }
    if (indicatorKey === 'deutschlandatlas') {
      if (!datlasData) return null;
      return datlasData[selectedAgs] ?? null;
    }
    if (!cityCrimeData) return null;
    return cityCrimeData[selectedYear]?.[selectedAgs] ?? null;
  }, [selectedAgs, indicatorKey, selectedYear, ausData, datlasData, cityCrimeData]);

  // Get rank of selected item
  const selectedRank = useMemo(() => {
    if (!selectedAgs) return null;
    const item = rankings.find(r => r.ags === selectedAgs);
    return item?.rank ?? null;
  }, [selectedAgs, rankings]);

  // Filter rankings by search query
  const filteredRankings = useMemo(() => {
    if (!searchQuery.trim()) return rankings;
    const query = searchQuery.toLowerCase();
    return rankings.filter((item) =>
      item.name.toLowerCase().includes(query) ||
      item.ags.includes(query)
    );
  }, [rankings, searchQuery]);

  const markManualInput = useCallback(() => {
    lastManualInputRef.current = Date.now();
  }, []);

  const cancelHoverScrollAnimation = useCallback(() => {
    if (hoverScrollRafRef.current !== null) {
      cancelAnimationFrame(hoverScrollRafRef.current);
      hoverScrollRafRef.current = null;
    }
  }, []);

  const animateContainerScroll = useCallback(
    (container: HTMLElement, targetScrollTop: number, durationMs = 180) => {
      cancelHoverScrollAnimation();

      const startScrollTop = container.scrollTop;
      const delta = targetScrollTop - startScrollTop;
      if (Math.abs(delta) < 1) {
        container.scrollTop = targetScrollTop;
        return;
      }

      const startTime = performance.now();
      const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);

      const step = (now: number) => {
        const progress = Math.min((now - startTime) / durationMs, 1);
        container.scrollTop = startScrollTop + delta * easeOutQuart(progress);

        if (progress < 1) {
          hoverScrollRafRef.current = requestAnimationFrame(step);
          return;
        }
        hoverScrollRafRef.current = null;
      };

      hoverScrollRafRef.current = requestAnimationFrame(step);
    },
    [cancelHoverScrollAnimation]
  );

  const scrollElementIntoContainerCenter = useCallback((container: HTMLElement, element: HTMLElement) => {
    const containerHeight = container.clientHeight;
    const elementHeight = element.offsetHeight;
    const elementTop = element.offsetTop;
    const targetScrollTop = elementTop - (containerHeight - elementHeight) / 2;
    const maxScroll = container.scrollHeight - containerHeight;
    const clampedScroll = Math.max(0, Math.min(targetScrollTop, maxScroll));
    animateContainerScroll(container, clampedScroll, 170);
  }, [animateContainerScroll]);

  // Auto-scroll to hovered item in the main list (ranking mode).
  const scrollMainListToItem = useCallback((ags: string) => {
    const now = Date.now();
    if (now - lastManualInputRef.current < 500) return;

    const container = scrollContainerRef.current;
    if (!container) return;

    const element = container.querySelector(`[data-ags="${ags}"]`) as HTMLElement;
    if (!element) return;

    scrollElementIntoContainerCenter(container, element);
  }, [scrollElementIntoContainerCenter]);

  // Scroll to hovered item when it changes (from map hover)
  useEffect(() => {
    if (hoveredAgs && !selectedAgs && !isHoverFromListRef.current) {
      scrollMainListToItem(hoveredAgs);
    }
  }, [hoveredAgs, selectedAgs, scrollMainListToItem]);

  // Scroll back to top when not hovering (with delay to avoid jarring animation)
  useEffect(() => {
    if (!hoveredAgs && !selectedAgs) {
      const timeout = setTimeout(() => {
        if (scrollContainerRef.current) {
          animateContainerScroll(scrollContainerRef.current, 0, 170);
        }
      }, 120);
      return () => clearTimeout(timeout);
    }
  }, [hoveredAgs, selectedAgs, animateContainerScroll]);

  useEffect(() => {
    return () => {
      cancelHoverScrollAnimation();
    };
  }, [cancelHoverScrollAnimation]);

  const indicatorLabel = getIndicatorLabel(indicatorKey, subMetric, lang);
  const unit = getUnit(indicatorKey, subMetric, cityCrimeMetric);
  const locationLabel = indicatorKey === 'kriminalstatistik' ? t.cities[lang] : t.districts[lang];
  const isAuslaenderAccent = indicatorKey === 'auslaender';

  // ============ Render Detail View ============
  if (selectedAgs && selectedRecord) {
    return (
      <>
        {/* Desktop detail view */}
        <div
          className={`hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 z-[1000] bg-[var(--card)]/95 backdrop-blur-sm rounded-xl shadow-2xl border border-[var(--card-border)] w-80 max-h-[80vh] flex-col overflow-hidden transition-all duration-300 ease-out ${
            isVisible ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0 pointer-events-none'
          }`}
        >
          {/* Header with back button */}
          <div className="flex items-start justify-between p-4 border-b border-[var(--card-border)] shrink-0">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {selectedRank && (
                  <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${isAuslaenderAccent ? 'text-red-400 bg-red-500/10' : 'text-amber-400 bg-amber-500/10'}`}>
                    #{selectedRank}
                  </span>
                )}
                <h3 className="text-[var(--foreground)] font-bold text-base leading-tight truncate">{selectedRecord.name}</h3>
              </div>
              <span className="text-[var(--text-tertiary)] text-sm">
                AGS: {selectedRecord.ags} · {indicatorKey === 'deutschlandatlas' ? (deutschlandatlasYear || '2022') : selectedYear}
              </span>
            </div>
            <button
              onClick={() => onSelectAgs(null)}
              className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors ml-2 mt-0.5 p-1 hover:bg-white/5 rounded"
              aria-label="Zurück zur Liste"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Scrollable detail content */}
          <div className="overflow-y-auto flex-1 p-4 space-y-4 scrollbar-thin">
            {indicatorKey === 'auslaender' ? (
              <AuslaenderDetailContent
                record={selectedRecord as { name: string; ags: string; regions: Record<AuslaenderRegionKey, { male: number | null; female: number | null; total: number | null }> }}
                selectedRegion={subMetric as AuslaenderRegionKey}
                lang={lang}
              />
            ) : indicatorKey === 'deutschlandatlas' ? (
              <DeutschlandatlasDetailContent
                record={selectedRecord as { name: string; ags: string; indicators: Record<string, number | null> }}
                selectedIndicator={subMetric as DeutschlandatlasKey}
                lang={lang}
              />
            ) : (
              <CityCrimeDetailContent
                record={selectedRecord as { name: string; ags: string; crimes: Record<string, { cases: number; hz: number; aq: number }> }}
                selectedCrimeType={subMetric as CrimeTypeKey}
                metric={cityCrimeMetric}
                lang={lang}
              />
            )}
          </div>

          {/* Footer - back to ranking */}
          <div className="shrink-0 px-4 py-3 border-t border-[var(--card-border)]/50">
            <button
              onClick={() => onSelectAgs(null)}
              className="w-full flex items-center justify-center gap-2 text-[var(--text-tertiary)] hover:text-[var(--foreground)] text-xs transition-colors py-1.5 rounded hover:bg-white/5"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              {t.backToList[lang]}
            </button>
          </div>
        </div>

        {/* Mobile detail bottom sheet */}
        <MobileDetailSheet
          selectedRecord={selectedRecord}
          selectedRank={selectedRank}
          indicatorKey={indicatorKey}
          subMetric={subMetric}
          cityCrimeMetric={cityCrimeMetric}
          isAuslaenderAccent={isAuslaenderAccent}
          selectedYear={selectedYear}
          onClose={() => onSelectAgs(null)}
          lang={lang}
        />
      </>
    );
  }

  // ============ Render Ranking View ============
  const handleListItemMouseEnter = (ags: string) => {
    isHoverFromListRef.current = true;
    onHoverAgs(ags);
  };

  const handleListItemMouseLeave = () => {
    onHoverAgs(null);
  };

  return (
    <>
      {/* Mobile ranking toggle button */}
      <button
        onClick={onMobileToggle}
        className="md:hidden fixed bottom-4 left-1/2 -translate-x-1/2 z-[1000] bg-[var(--card)]/95 backdrop-blur-sm rounded-full shadow-xl border border-[var(--card-border)] px-5 py-3 flex items-center justify-center gap-2 touch-feedback active:scale-95 transition-all safe-area-pb"
        aria-label={t.openRanking[lang]}
      >
        <svg
          className={`w-[18px] h-[18px] shrink-0 ${isAuslaenderAccent ? 'text-red-400' : 'text-amber-400'}`}
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <rect x="3" y="14" width="4" height="7" rx="0.5" />
          <rect x="10" y="8" width="4" height="13" rx="0.5" />
          <rect x="17" y="3" width="4" height="18" rx="0.5" />
        </svg>
        <span className="text-[var(--text-primary)] text-[15px] font-medium leading-none no-select">{t.ranking[lang]}</span>
        <svg
          className="w-[18px] h-[18px] shrink-0 text-[var(--text-tertiary)]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path d="M5 15l7-7 7 7" />
        </svg>
      </button>

      {/* Mobile bottom sheet */}
      {isMobileOpen && onMobileToggle && (
        <MobileRankingSheet
          indicatorLabel={indicatorLabel}
          rankings={rankings}
          filteredRankings={filteredRankings}
          indicatorKey={indicatorKey}
          subMetric={subMetric}
          cityCrimeMetric={cityCrimeMetric}
          isAuslaenderAccent={isAuslaenderAccent}
          selectedYear={selectedYear}
          locationLabel={locationLabel}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSelectAgs={onSelectAgs}
          onClose={onMobileToggle}
          lang={lang}
        />
      )}

      {/* Desktop panel */}
      <div
        className={`hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 z-[1000] bg-[var(--card)]/95 backdrop-blur-sm rounded-xl shadow-2xl border border-[var(--card-border)] w-80 max-h-[80vh] flex-col overflow-hidden transition-all duration-300 ease-out ${
          isVisible ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0 pointer-events-none'
        }`}
      >
        {/* Header */}
        <div className="shrink-0 p-3 border-b border-[var(--card-border)]">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-[var(--foreground)] font-semibold text-base truncate">
              {indicatorLabel}
            </h3>
          </div>
          <div className="text-[var(--text-tertiary)] text-xs">
            {rankings.length} {locationLabel} · {indicatorKey === 'deutschlandatlas' ? (deutschlandatlasYear || '2022') : selectedYear}
            {unit && <span className="ml-1">· {unit}</span>}
          </div>
        </div>

        {/* Search */}
        <div className="shrink-0 px-3 py-2 border-b border-[var(--card-border)]/50">
          <div className="relative">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder={t.search[lang]}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full bg-[var(--card-elevated)] border border-[var(--border)] rounded-md pl-8.5 pr-3 py-2 text-sm text-[var(--foreground)] placeholder-zinc-500 focus:outline-none transition-colors ${isAuslaenderAccent ? 'focus:border-red-500/50' : 'focus:border-amber-500/50'}`}
            />
          </div>
        </div>

        {/* Scrollable list */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto scrollbar-thin"
          onWheel={markManualInput}
          onTouchStart={markManualInput}
          onMouseDown={markManualInput}
          onMouseLeave={() => {
            isHoverFromListRef.current = false;
            onHoverAgs(null);
          }}
        >
          {filteredRankings.length === 0 ? (
            <div className="p-4 text-center text-[var(--text-tertiary)] text-sm">
              {searchQuery ? t.noResults[lang] : t.noDataAvailable[lang]}
            </div>
          ) : (
            <div className="py-1">
              {filteredRankings.map((item) => {
                const isHovered = hoveredAgs === item.ags;

                return (
                  <div
                    key={item.ags}
                    data-ags={item.ags}
                    className={`px-3 py-2 cursor-pointer transition-colors ${
                      isHovered ? (isAuslaenderAccent ? 'bg-red-500/15' : 'bg-amber-500/15') : 'hover:bg-white/5'
                    }`}
                    onMouseEnter={() => handleListItemMouseEnter(item.ags)}
                    onMouseLeave={handleListItemMouseLeave}
                    onClick={() => onSelectAgs(item.ags)}
                  >
                    {/* Row content */}
                    <div className="flex items-center gap-2">
                      <span className={`w-8 text-right text-sm font-mono ${
                        isHovered ? (isAuslaenderAccent ? 'text-red-400' : 'text-amber-300') : 'text-[var(--text-muted)]'
                      }`}>
                        {item.rank}.
                      </span>
                      <span className={`flex-1 text-[15px] leading-snug font-medium truncate ${
                        isHovered ? (isAuslaenderAccent ? 'text-red-400' : 'text-amber-300') : 'text-[var(--text-primary)]'
                      }`}>
                        {item.name}
                      </span>
                      <span className={`text-sm font-semibold font-mono tabular-nums ${
                        isHovered ? (isAuslaenderAccent ? 'text-red-400' : 'text-amber-300') : 'text-[var(--text-primary)]'
                      }`}>
                        {formatRankingValue(item.value, indicatorKey, subMetric, cityCrimeMetric)}
                      </span>
                    </div>

                    {/* Percentage bar */}
                    <div className="mt-1.5 ml-10 h-1.5 bg-[var(--card-elevated)] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${item.percentage}%`,
                          background: getRankingBarGradient(indicatorKey, isHovered),
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer with count */}
        {searchQuery && filteredRankings.length !== rankings.length && (
          <div className="shrink-0 px-3 py-2 border-t border-[var(--card-border)]/50 text-[var(--text-tertiary)] text-xs text-center">
            {filteredRankings.length} von {rankings.length} angezeigt
          </div>
        )}
      </div>
    </>
  );
}
