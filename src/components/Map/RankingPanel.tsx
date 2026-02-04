'use client';

import { useMemo, useRef, useEffect, useCallback, useState } from 'react';
import type { IndicatorKey, SubMetricKey, AuslaenderRegionKey, DeutschlandatlasKey } from '../../../lib/indicators/types';
import {
  INDICATORS,
  AUSLAENDER_REGION_META,
  DEUTSCHLANDATLAS_META,
  isDeutschlandatlasKey,
} from '../../../lib/indicators/types';
import { formatNumber, formatDetailValue, calcPercent } from '../../../lib/utils/formatters';
import { auslaender, deutschlandatlas } from './KreisLayer';

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
}

// ============ Utility Functions ============

/**
 * Format ranking value with indicator-aware decimal places
 * Uses more decimals for Deutschlandatlas values depending on magnitude
 */
function formatRankingValue(val: number, indicatorKey: IndicatorKey, subMetric: SubMetricKey): string {
  if (indicatorKey === 'deutschlandatlas' && isDeutschlandatlasKey(subMetric)) {
    if (val >= 10000) {
      return val.toLocaleString('de-DE', { maximumFractionDigits: 0 });
    }
    if (val >= 100) {
      return val.toLocaleString('de-DE', { maximumFractionDigits: 1 });
    }
    return val.toLocaleString('de-DE', { maximumFractionDigits: 2 });
  }
  return val.toLocaleString('de-DE', { maximumFractionDigits: 0 });
}

function getUnit(indicatorKey: IndicatorKey, subMetric: SubMetricKey): string {
  if (indicatorKey === 'deutschlandatlas' && isDeutschlandatlasKey(subMetric)) {
    return DEUTSCHLANDATLAS_META[subMetric].unitDe;
  }
  return '';
}

function getIndicatorLabel(indicatorKey: IndicatorKey, subMetric: SubMetricKey): string {
  if (indicatorKey === 'auslaender') {
    return AUSLAENDER_REGION_META[subMetric as AuslaenderRegionKey]?.labelDe ?? 'Ausländer';
  }
  if (indicatorKey === 'deutschlandatlas' && isDeutschlandatlasKey(subMetric)) {
    return DEUTSCHLANDATLAS_META[subMetric].labelDe;
  }
  return INDICATORS[indicatorKey].labelDe;
}

// ============ Detail View Components ============

function AuslaenderDetailContent({
  record,
  selectedRegion,
}: {
  record: { name: string; ags: string; regions: Record<AuslaenderRegionKey, { male: number | null; female: number | null; total: number | null }> };
  selectedRegion: AuslaenderRegionKey;
}) {
  const total = record.regions.total?.total;
  const selectedMeta = AUSLAENDER_REGION_META[selectedRegion];
  const selectedValue = record.regions[selectedRegion]?.total;
  const selectedData = record.regions[selectedRegion];

  const continents = ['europa', 'asien', 'afrika', 'amerika', 'ozeanien'] as const;
  const specialRegions = ['eu27', 'drittstaaten', 'gastarbeiter', 'exjugoslawien', 'exsowjetunion'] as const;

  return (
    <>
      {/* Total */}
      <div className="flex items-baseline justify-between">
        <span className="text-zinc-500 text-xs uppercase tracking-wide">Gesamt Ausländer</span>
        <span className="text-2xl font-bold text-amber-400">{formatNumber(total)}</span>
      </div>

      {/* Selected region highlight */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-amber-400 text-xs font-medium">Aktuell: {selectedMeta.labelDe}</span>
          <span className="text-zinc-500 text-xs">{calcPercent(selectedValue, total)}</span>
        </div>
        <div className="text-white text-xl font-semibold">{formatNumber(selectedValue)}</div>
        {selectedData && (
          <div className="flex gap-4 mt-2 text-xs">
            <div className="flex items-center gap-1">
              <span className="text-blue-400">♂</span>
              <span className="text-zinc-300">{formatNumber(selectedData.male)}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-pink-400">♀</span>
              <span className="text-zinc-300">{formatNumber(selectedData.female)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Continent breakdown */}
      <div>
        <h4 className="text-zinc-500 text-[10px] uppercase tracking-wider mb-2">Nach Kontinent</h4>
        <div className="space-y-1">
          {continents.map((continent) => {
            const val = record.regions[continent]?.total;
            const meta = AUSLAENDER_REGION_META[continent];
            const isSelected = selectedRegion === continent;
            const pct = calcPercent(val, total);

            return (
              <div
                key={continent}
                className={`flex justify-between py-1.5 px-2 rounded ${isSelected ? 'bg-amber-500/15' : ''}`}
              >
                <span className={`text-xs ${isSelected ? 'text-amber-400' : 'text-zinc-400'}`}>
                  {meta.labelDe}
                </span>
                <span className={`text-xs ${isSelected ? 'text-amber-400 font-medium' : 'text-white'}`}>
                  {formatNumber(val)}
                  {pct && <span className="text-zinc-600 ml-1.5 text-[10px]">{pct}</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Special groups */}
      <div>
        <h4 className="text-zinc-500 text-[10px] uppercase tracking-wider mb-2">Weitere Gruppen</h4>
        <div className="space-y-1">
          {specialRegions.map((region) => {
            const val = record.regions[region]?.total;
            if (val === null || val === undefined) return null;
            const meta = AUSLAENDER_REGION_META[region];
            const isSelected = selectedRegion === region;
            const pct = calcPercent(val, total);

            return (
              <div
                key={region}
                className={`flex justify-between py-1.5 px-2 rounded ${isSelected ? 'bg-amber-500/15' : ''}`}
              >
                <span className={`text-[11px] ${isSelected ? 'text-amber-400' : 'text-zinc-400'}`}>
                  {meta.labelDe}
                </span>
                <span className={`text-[11px] ${isSelected ? 'text-amber-400 font-medium' : 'text-zinc-300'}`}>
                  {formatNumber(val)}
                  {pct && <span className="text-zinc-600 ml-1.5 text-[10px]">{pct}</span>}
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
}: {
  record: { name: string; ags: string; indicators: Record<string, number | null> };
  selectedIndicator: DeutschlandatlasKey;
}) {
  const meta = DEUTSCHLANDATLAS_META[selectedIndicator];
  const value = record.indicators[selectedIndicator];

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
          <span className="text-amber-400 text-xs font-medium">{meta.labelDe}</span>
          <span className="text-zinc-500 text-[10px]">{meta.categoryDe}</span>
        </div>
        <div className="text-white text-xl font-semibold">
          {formatDetailValue(value)}
          {meta.unitDe && <span className="text-zinc-400 text-sm ml-1">{meta.unitDe}</span>}
        </div>
        <p className="text-zinc-500 text-[10px] mt-1">{meta.descriptionDe}</p>
        {meta.higherIsBetter !== undefined && (
          <div className={`text-[10px] mt-1 ${meta.higherIsBetter ? 'text-green-400' : 'text-orange-400'}`}>
            {meta.higherIsBetter ? '↑ Höher ist besser' : '↓ Niedriger ist besser'}
          </div>
        )}
      </div>

      {/* Priority indicators overview */}
      <div>
        <h4 className="text-zinc-500 text-[10px] uppercase tracking-wider mb-2">Wichtige Indikatoren</h4>
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
                <span className={`text-xs ${isSelected ? 'text-amber-400' : 'text-zinc-400'}`}>
                  {indMeta.labelDe}
                </span>
                <span className={`text-xs ${isSelected ? 'text-amber-400 font-medium' : 'text-white'}`}>
                  {formatDetailValue(val)}
                  {indMeta.unitDe && <span className="text-zinc-600 ml-1 text-[10px]">{indMeta.unitDe}</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* All indicators by category (collapsed by default) */}
      <details className="group">
        <summary className="text-zinc-500 text-[10px] uppercase tracking-wider cursor-pointer hover:text-zinc-300 list-none flex items-center gap-1">
          <span className="group-open:rotate-90 transition-transform">▶</span>
          Alle Indikatoren ({Object.keys(record.indicators).length})
        </summary>
        <div className="mt-2 space-y-3 max-h-60 overflow-y-auto">
          {Array.from(indicatorsByCategory.entries()).map(([category, indicators]) => (
            <div key={category}>
              <h5 className="text-zinc-600 text-[9px] uppercase tracking-wider mb-1">{category}</h5>
              <div className="space-y-0.5">
                {indicators.map(({ key, value: val, meta: indMeta }) => {
                  const isSelected = selectedIndicator === key;
                  return (
                    <div
                      key={key}
                      className={`flex justify-between py-1 px-1.5 rounded text-[10px] ${isSelected ? 'bg-amber-500/15' : ''}`}
                    >
                      <span className={isSelected ? 'text-amber-400' : 'text-zinc-500'}>
                        {indMeta.labelDe}
                      </span>
                      <span className={isSelected ? 'text-amber-400' : 'text-zinc-300'}>
                        {formatDetailValue(val)}
                        {indMeta.unitDe && <span className="text-zinc-600 ml-0.5">{indMeta.unitDe}</span>}
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

// ============ Main Component ============

export function RankingPanel({
  indicatorKey,
  subMetric,
  selectedYear,
  hoveredAgs,
  selectedAgs,
  onHoverAgs,
  onSelectAgs,
}: RankingPanelProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const miniRankingRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const lastManualScrollRef = useRef<number>(0);

  // Compute rankings from indicator data
  const rankings = useMemo((): RankingItem[] => {
    const items: { ags: string; name: string; value: number }[] = [];

    if (indicatorKey === 'auslaender') {
      const yearData = auslaender.data[selectedYear];
      if (!yearData) return [];

      for (const [ags, record] of Object.entries(yearData)) {
        const regionData = record.regions[subMetric as AuslaenderRegionKey];
        const value = regionData?.total;
        if (value !== null && value !== undefined && value > 0) {
          items.push({ ags, name: record.name, value });
        }
      }
    } else if (indicatorKey === 'deutschlandatlas') {
      for (const [ags, record] of Object.entries(deutschlandatlas.data)) {
        const value = record.indicators[subMetric];
        if (value !== null && value !== undefined) {
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
  }, [indicatorKey, subMetric, selectedYear]);

  // Get selected record for detail view
  const selectedRecord = useMemo(() => {
    if (!selectedAgs) return null;

    if (indicatorKey === 'auslaender') {
      const yearData = auslaender.data[selectedYear];
      if (!yearData) return null;
      return yearData[selectedAgs] ?? null;
    } else {
      return deutschlandatlas.data[selectedAgs] ?? null;
    }
  }, [selectedAgs, indicatorKey, selectedYear]);

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

  // Auto-scroll to hovered item when hovering on map
  const scrollToItem = useCallback((ags: string) => {
    const now = Date.now();
    if (now - lastManualScrollRef.current < 500) return;

    const container = scrollContainerRef.current;
    if (!container) return;

    const element = container.querySelector(`[data-ags="${ags}"]`) as HTMLElement;
    if (!element) return;

    // Calculate scroll position to center the element in the container
    // Using manual scrollTop instead of scrollIntoView to avoid nested scroll container issues
    const containerHeight = container.clientHeight;
    const elementHeight = element.offsetHeight;
    const elementTop = element.offsetTop;

    // Target scroll: element's top - offset to center it
    const targetScrollTop = elementTop - (containerHeight - elementHeight) / 2;

    // Clamp to valid scroll range
    const maxScroll = container.scrollHeight - containerHeight;
    const clampedScroll = Math.max(0, Math.min(targetScrollTop, maxScroll));

    container.scrollTo({
      top: clampedScroll,
      behavior: 'smooth',
    });
  }, []);

  // Scroll to hovered item when it changes (from map hover)
  useEffect(() => {
    if (hoveredAgs && !selectedAgs) {
      scrollToItem(hoveredAgs);
    }
  }, [hoveredAgs, selectedAgs, scrollToItem]);

  // Track manual scrolling
  const handleScroll = useCallback(() => {
    lastManualScrollRef.current = Date.now();
  }, []);

  // Scroll back to top when not hovering (with delay to avoid jarring animation)
  useEffect(() => {
    if (!hoveredAgs) {
      const timeout = setTimeout(() => {
        // Scroll mini ranking back to top
        if (miniRankingRef.current) {
          miniRankingRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        }
        // Scroll main ranking list back to top
        if (scrollContainerRef.current && !selectedAgs) {
          scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }, 300);
      return () => clearTimeout(timeout);
    }
  }, [hoveredAgs, selectedAgs]);

  const indicatorLabel = getIndicatorLabel(indicatorKey, subMetric);
  const unit = getUnit(indicatorKey, subMetric);

  // Get items around the selected item for mini ranking display
  const getMiniRankingItems = useCallback(() => {
    if (!selectedAgs) return [];
    const selectedIndex = rankings.findIndex(r => r.ags === selectedAgs);
    if (selectedIndex === -1) return rankings.slice(0, 5);

    // Show 2 before, selected, 2 after (5 total)
    const start = Math.max(0, selectedIndex - 2);
    const end = Math.min(rankings.length, selectedIndex + 3);
    return rankings.slice(start, end);
  }, [selectedAgs, rankings]);

  // ============ Render Detail View ============
  if (selectedAgs && selectedRecord) {
    const miniRankingItems = getMiniRankingItems();

    return (
      <div className="hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 z-[1000] bg-[#141414]/95 backdrop-blur-sm rounded-xl shadow-2xl border border-[#262626] w-80 max-h-[80vh] flex-col overflow-hidden transition-all duration-200">
        {/* Header with back button */}
        <div className="flex items-start justify-between p-4 border-b border-[#262626] shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {selectedRank && (
                <span className="text-amber-400 text-xs font-mono bg-amber-500/10 px-1.5 py-0.5 rounded">
                  #{selectedRank}
                </span>
              )}
              <h3 className="text-white font-bold text-base leading-tight truncate">{selectedRecord.name}</h3>
            </div>
            <span className="text-zinc-500 text-xs">
              AGS: {selectedRecord.ags} · {indicatorKey === 'deutschlandatlas' ? deutschlandatlas.meta.year : selectedYear}
            </span>
          </div>
          <button
            onClick={() => onSelectAgs(null)}
            className="text-zinc-500 hover:text-zinc-300 transition-colors ml-2 mt-0.5 p-1 hover:bg-white/5 rounded"
            aria-label="Zurück zur Liste"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Mini ranking list - shows hover highlights */}
        <div className="shrink-0 border-b border-[#262626]/50">
          <div className="px-3 py-1.5 flex items-center justify-between">
            <span className="text-zinc-600 text-[10px] uppercase tracking-wider">Rangliste</span>
            <button
              onClick={() => onSelectAgs(null)}
              className="text-zinc-500 hover:text-amber-400 text-[10px] transition-colors"
            >
              Alle anzeigen →
            </button>
          </div>
          <div ref={miniRankingRef} className="max-h-32 overflow-y-auto scrollbar-thin">
            {miniRankingItems.map((item) => {
              const isHovered = hoveredAgs === item.ags;
              const isSelected = item.ags === selectedAgs;

              return (
                <div
                  key={item.ags}
                  className={`px-3 py-1.5 cursor-pointer transition-colors flex items-center gap-2 ${
                    isSelected
                      ? 'bg-amber-500/20'
                      : isHovered
                        ? 'bg-amber-500/10'
                        : 'hover:bg-white/5'
                  }`}
                  onMouseEnter={() => onHoverAgs(item.ags)}
                  onMouseLeave={() => onHoverAgs(null)}
                  onClick={() => onSelectAgs(item.ags)}
                >
                  <span className={`w-6 text-right text-[10px] font-mono ${
                    isSelected ? 'text-amber-400' : isHovered ? 'text-amber-400' : 'text-zinc-600'
                  }`}>
                    {item.rank}.
                  </span>
                  <span className={`flex-1 text-xs truncate ${
                    isSelected ? 'text-amber-400 font-medium' : isHovered ? 'text-amber-400' : 'text-zinc-300'
                  }`}>
                    {item.name}
                  </span>
                  <span className={`text-[10px] font-mono ${
                    isSelected ? 'text-amber-400' : isHovered ? 'text-amber-400' : 'text-zinc-500'
                  }`}>
                    {formatRankingValue(item.value, indicatorKey, subMetric)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Scrollable detail content */}
        <div className="overflow-y-auto flex-1 p-4 space-y-4 scrollbar-thin">
          {indicatorKey === 'auslaender' ? (
            <AuslaenderDetailContent
              record={selectedRecord as { name: string; ags: string; regions: Record<AuslaenderRegionKey, { male: number | null; female: number | null; total: number | null }> }}
              selectedRegion={subMetric as AuslaenderRegionKey}
            />
          ) : (
            <DeutschlandatlasDetailContent
              record={selectedRecord as { name: string; ags: string; indicators: Record<string, number | null> }}
              selectedIndicator={subMetric as DeutschlandatlasKey}
            />
          )}
        </div>

        {/* Footer - back to ranking */}
        <div className="shrink-0 px-4 py-3 border-t border-[#262626]/50">
          <button
            onClick={() => onSelectAgs(null)}
            className="w-full flex items-center justify-center gap-2 text-zinc-400 hover:text-white text-xs transition-colors py-1.5 rounded hover:bg-white/5"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Zurück zur Rangliste
          </button>
        </div>
      </div>
    );
  }

  // ============ Render Ranking View ============
  return (
    <div className="hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 z-[1000] bg-[#141414]/95 backdrop-blur-sm rounded-xl shadow-2xl border border-[#262626] w-72 max-h-[70vh] flex-col overflow-hidden transition-all duration-200">
      {/* Header */}
      <div className="shrink-0 p-3 border-b border-[#262626]">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-amber-400 text-xs">📊</span>
          <h3 className="text-white font-semibold text-sm truncate">
            {indicatorLabel}
          </h3>
        </div>
        <div className="text-zinc-500 text-[10px]">
          {rankings.length} Kreise · {indicatorKey === 'deutschlandatlas' ? deutschlandatlas.meta.year : selectedYear}
          {unit && <span className="ml-1">· {unit}</span>}
        </div>
      </div>

      {/* Search */}
      <div className="shrink-0 px-3 py-2 border-b border-[#262626]/50">
        <div className="relative">
          <svg
            className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 w-3.5 h-3.5"
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
            placeholder="Suchen..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#1a1a1a] border border-[#333] rounded-md pl-7 pr-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 transition-colors"
          />
        </div>
      </div>

      {/* Scrollable list */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto scrollbar-thin"
      >
        {filteredRankings.length === 0 ? (
          <div className="p-4 text-center text-zinc-500 text-xs">
            {searchQuery ? 'Keine Ergebnisse' : 'Keine Daten verfügbar'}
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
                    isHovered ? 'bg-amber-500/15' : 'hover:bg-white/5'
                  }`}
                  onMouseEnter={() => onHoverAgs(item.ags)}
                  onMouseLeave={() => onHoverAgs(null)}
                  onClick={() => onSelectAgs(item.ags)}
                >
                  {/* Row content */}
                  <div className="flex items-center gap-2">
                    <span className={`w-7 text-right text-xs font-mono ${
                      isHovered ? 'text-amber-400' : 'text-zinc-600'
                    }`}>
                      {item.rank}.
                    </span>
                    <span className={`flex-1 text-sm truncate ${
                      isHovered ? 'text-amber-400' : 'text-white'
                    }`}>
                      {item.name}
                    </span>
                    <span className={`text-xs font-mono ${
                      isHovered ? 'text-amber-400' : 'text-zinc-400'
                    }`}>
                      {formatRankingValue(item.value, indicatorKey, subMetric)}
                    </span>
                  </div>

                  {/* Percentage bar */}
                  <div className="mt-1.5 ml-9 h-1 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        isHovered
                          ? 'bg-gradient-to-r from-amber-500 to-orange-500'
                          : 'bg-gradient-to-r from-yellow-600/70 to-red-600/70'
                      }`}
                      style={{ width: `${item.percentage}%` }}
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
        <div className="shrink-0 px-3 py-2 border-t border-[#262626]/50 text-zinc-500 text-[10px] text-center">
          {filteredRankings.length} von {rankings.length} angezeigt
        </div>
      )}
    </div>
  );
}
