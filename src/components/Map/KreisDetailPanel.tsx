'use client';

import { useDraggableSheet } from './useBottomSheet';
import { useTranslation } from '@/lib/i18n';
import type { IndicatorKey, AuslaenderRegionKey, DeutschlandatlasKey } from '../../../lib/indicators/types';
import {
  AUSLAENDER_REGION_META,
  AUSLAENDER_REGION_KEYS,
  DEUTSCHLANDATLAS_META,
  DEUTSCHLANDATLAS_KEYS,
  isDeutschlandatlasKey,
} from '../../../lib/indicators/types';
import { formatNumber, formatValue, calcPercentParens } from '../../../lib/utils/formatters';
import type { AuslaenderRow, DeutschlandatlasRow } from '@/lib/supabase';

interface KreisDetailPanelProps {
  ags: string;
  kreisName: string;
  indicatorKey: IndicatorKey;
  selectedSubMetric: string;
  selectedYear: string;
  onClose: () => void;
  auslaenderData?: Record<string, AuslaenderRow>;
  deutschlandatlasData?: Record<string, DeutschlandatlasRow>;
  mobileOnly?: boolean;
}

const Icons = {
  close: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  ),
  mapPin: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M12 21c-4-4-8-7.5-8-11a8 8 0 1116 0c0 3.5-4 7-8 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  ),
};

// Continent-level region keys for summary breakdown
const CONTINENT_KEYS: AuslaenderRegionKey[] = ['europa', 'asien', 'afrika', 'amerika', 'ozeanien'];

// Sub-region keys grouped by continent for expanded detail
const SUB_REGIONS: Record<string, AuslaenderRegionKey[]> = {
  europa: ['eu27', 'drittstaaten'],
  afrika: ['nordafrika', 'westafrika', 'zentralafrika', 'ostafrika', 'suedafrika'],
  amerika: ['nordamerika', 'mittelamerika', 'suedamerika'],
  asien: ['vorderasien', 'suedostasien', 'ostasien'],
};

// Historical group keys
const HISTORICAL_KEYS: AuslaenderRegionKey[] = ['gastarbeiter', 'exjugoslawien', 'exsowjetunion'];

function AuslaenderDetailContent({
  record,
  selectedRegion,
  lang,
}: {
  record: AuslaenderRow;
  selectedRegion: AuslaenderRegionKey;
  lang: 'de' | 'en';
}) {
  const total = record.regions.total?.total;
  const selectedMeta = AUSLAENDER_REGION_META[selectedRegion];
  const selectedValue = record.regions[selectedRegion]?.total;
  const selectedData = record.regions[selectedRegion];

  return (
    <div className="space-y-4">
      {/* Selected region highlight */}
      {selectedRegion !== 'total' && (
        <div className="bg-amber-500/8 border border-amber-500/25 rounded-lg p-3">
          <div className="text-amber-400 text-[11px] mb-1">
            {lang === 'de' ? 'Aktuell' : 'Current'}: <span className="font-bold">{selectedMeta.labelDe}</span>
          </div>
          <div className="text-2xl font-bold text-amber-400">
            {formatNumber(selectedValue)}
            <span className="text-[var(--text-muted)] text-sm ml-1.5">{calcPercentParens(selectedValue, total)}</span>
          </div>
          {selectedData && (
            <div className="flex gap-4 mt-2">
              <div>
                <span className="text-blue-400 text-sm">&#9794;</span>
                <span className="text-[var(--text-secondary)] text-sm ml-1">{formatNumber(selectedData.male)}</span>
              </div>
              <div>
                <span className="text-pink-400 text-sm">&#9792;</span>
                <span className="text-[var(--text-secondary)] text-sm ml-1">{formatNumber(selectedData.female)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Total */}
      <div className="flex justify-between items-baseline">
        <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider">
          {lang === 'de' ? 'Gesamt' : 'Total'}
        </span>
        <span className="text-xl font-bold text-amber-400">{formatNumber(total)}</span>
      </div>

      {/* Gender split for total */}
      {record.regions.total && (
        <div className="flex gap-6">
          <div>
            <span className="text-blue-400 text-sm">&#9794;</span>
            <span className="text-[var(--text-secondary)] text-sm ml-1">{formatNumber(record.regions.total.male)}</span>
            <span className="text-[var(--text-faint)] text-xs ml-1">{calcPercentParens(record.regions.total.male, total)}</span>
          </div>
          <div>
            <span className="text-pink-400 text-sm">&#9792;</span>
            <span className="text-[var(--text-secondary)] text-sm ml-1">{formatNumber(record.regions.total.female)}</span>
            <span className="text-[var(--text-faint)] text-xs ml-1">{calcPercentParens(record.regions.total.female, total)}</span>
          </div>
        </div>
      )}

      {/* Continent breakdown */}
      <div className="border-t border-[var(--card-border)] pt-3">
        <div className="text-[10px] font-semibold tracking-widest text-[var(--text-muted)] uppercase mb-2">
          {lang === 'de' ? 'Nach Kontinent' : 'By Continent'}
        </div>
        <div className="space-y-1">
          {CONTINENT_KEYS.map((continent) => {
            const val = record.regions[continent]?.total;
            const meta = AUSLAENDER_REGION_META[continent];
            const isSelected = selectedRegion === continent;
            const pct = calcPercentParens(val, total);
            const subRegions = SUB_REGIONS[continent];

            return (
              <div key={continent}>
                <div
                  className={`flex justify-between py-1 px-2 rounded ${
                    isSelected ? 'bg-amber-500/15' : ''
                  }`}
                >
                  <span className={`text-xs ${isSelected ? 'text-amber-400 font-medium' : 'text-[var(--text-secondary)]'}`}>
                    {meta.labelDe}
                  </span>
                  <span className={`text-xs tabular-nums ${isSelected ? 'text-amber-400 font-semibold' : 'text-[var(--text-primary)]'}`}>
                    {formatNumber(val)}
                    {pct && <span className="text-[var(--text-faint)] text-[10px] ml-1">{pct}</span>}
                  </span>
                </div>
                {/* Sub-regions */}
                {subRegions && subRegions.map((subKey) => {
                  const subVal = record.regions[subKey]?.total;
                  if (subVal === null || subVal === undefined || subVal === 0) return null;
                  const subMeta = AUSLAENDER_REGION_META[subKey];
                  const isSubSelected = selectedRegion === subKey;
                  return (
                    <div
                      key={subKey}
                      className={`flex justify-between py-0.5 px-2 ml-4 rounded ${
                        isSubSelected ? 'bg-amber-500/15' : ''
                      }`}
                    >
                      <span className={`text-[11px] ${isSubSelected ? 'text-amber-400' : 'text-[var(--text-tertiary)]'}`}>
                        {subMeta.labelDe}
                      </span>
                      <span className={`text-[11px] tabular-nums ${isSubSelected ? 'text-amber-400 font-semibold' : 'text-[var(--text-secondary)]'}`}>
                        {formatNumber(subVal)}
                        <span className="text-[var(--text-faint)] text-[10px] ml-1">{calcPercentParens(subVal, total)}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Historical groups */}
      <div className="border-t border-[var(--card-border)] pt-3">
        <div className="text-[10px] font-semibold tracking-widest text-[var(--text-muted)] uppercase mb-2">
          {lang === 'de' ? 'Historische Gruppen' : 'Historical Groups'}
        </div>
        <div className="space-y-1">
          {HISTORICAL_KEYS.map((key) => {
            const val = record.regions[key]?.total;
            if (val === null || val === undefined || val === 0) return null;
            const meta = AUSLAENDER_REGION_META[key];
            const isSelected = selectedRegion === key;
            return (
              <div
                key={key}
                className={`flex justify-between py-1 px-2 rounded ${
                  isSelected ? 'bg-amber-500/15' : ''
                }`}
              >
                <span className={`text-xs ${isSelected ? 'text-amber-400 font-medium' : 'text-[var(--text-secondary)]'}`}>
                  {meta.labelDe}
                </span>
                <span className={`text-xs tabular-nums ${isSelected ? 'text-amber-400 font-semibold' : 'text-[var(--text-primary)]'}`}>
                  {formatNumber(val)}
                  <span className="text-[var(--text-faint)] text-[10px] ml-1">{calcPercentParens(val, total)}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DeutschlandatlasDetailContent({
  record,
  selectedIndicator,
  lang,
}: {
  record: DeutschlandatlasRow;
  selectedIndicator: DeutschlandatlasKey;
  lang: 'de' | 'en';
}) {
  const meta = DEUTSCHLANDATLAS_META[selectedIndicator];
  const value = record.indicators[selectedIndicator];

  // Group all indicators by category
  const byCategory = new Map<string, { key: DeutschlandatlasKey; meta: typeof meta; value: number | null }[]>();
  for (const key of DEUTSCHLANDATLAS_KEYS) {
    const indMeta = DEUTSCHLANDATLAS_META[key];
    const cat = indMeta.categoryDe;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push({ key, meta: indMeta, value: record.indicators[key] });
  }

  return (
    <div className="space-y-4">
      {/* Selected indicator highlight */}
      <div className="bg-amber-500/8 border border-amber-500/25 rounded-lg p-3">
        <div className="text-amber-400 text-[11px] mb-1">{meta.labelDe}</div>
        <div className="text-2xl font-bold text-[var(--text-primary)]">
          {formatValue(value)}
          {meta.unitDe && <span className="text-[var(--text-tertiary)] text-sm ml-1.5">{meta.unitDe}</span>}
        </div>
        {meta.descriptionDe && (
          <div className="text-[11px] text-[var(--text-tertiary)] mt-1">{meta.descriptionDe}</div>
        )}
        {meta.higherIsBetter !== undefined && (
          <div className={`text-[10px] mt-1 ${meta.higherIsBetter ? 'text-green-400' : 'text-orange-400'}`}>
            {meta.higherIsBetter
              ? (lang === 'de' ? '↑ Höher ist besser' : '↑ Higher is better')
              : (lang === 'de' ? '↓ Niedriger ist besser' : '↓ Lower is better')}
          </div>
        )}
      </div>

      {/* All indicators by category */}
      {Array.from(byCategory.entries()).map(([category, indicators]) => (
        <div key={category} className="border-t border-[var(--card-border)] pt-3">
          <div className="text-[10px] font-semibold tracking-widest text-[var(--text-muted)] uppercase mb-2">
            {category}
          </div>
          <div className="space-y-0.5">
            {indicators.map(({ key, meta: indMeta, value: val }) => {
              const isSelected = key === selectedIndicator;
              return (
                <div
                  key={key}
                  className={`flex justify-between py-1 px-2 rounded ${
                    isSelected ? 'bg-amber-500/15' : ''
                  }`}
                >
                  <span className={`text-[11px] flex-1 mr-2 ${isSelected ? 'text-amber-400 font-medium' : 'text-[var(--text-tertiary)]'}`}>
                    {indMeta.labelDe}
                  </span>
                  <span className={`text-[11px] tabular-nums whitespace-nowrap ${isSelected ? 'text-amber-400 font-semibold' : 'text-[var(--text-primary)]'}`}>
                    {formatValue(val)}
                    {indMeta.unitDe && <span className="text-[var(--text-faint)] ml-0.5">{indMeta.unitDe}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function KreisDetailPanel({
  ags,
  kreisName,
  indicatorKey,
  selectedSubMetric,
  selectedYear,
  onClose,
  auslaenderData,
  deutschlandatlasData,
  mobileOnly,
}: KreisDetailPanelProps) {
  const { sheetRef, scrollRef, isExpanded, handlers } = useDraggableSheet(onClose);
  const { lang } = useTranslation();

  const ausRecord = auslaenderData?.[ags] ?? null;
  const datlasRecord = deutschlandatlasData?.[ags] ?? null;
  const hasData = indicatorKey === 'auslaender' ? !!ausRecord : !!datlasRecord;

  const headerLabel = lang === 'de' ? 'Kreis-Detail' : 'District Detail';

  // Shared content rendered in both desktop and mobile
  const renderContent = (compact: boolean) => (
    <>
      {/* Title section */}
      <div className={`${compact ? 'px-4 py-3' : 'px-5 py-4'} border-b border-[var(--card-border)]`}>
        <h2 className={`${compact ? 'text-base' : 'text-[15px]'} font-semibold text-[var(--text-primary)] leading-relaxed`}>
          {kreisName}
        </h2>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[11px] text-[var(--text-muted)]">AGS: {ags}</span>
          {selectedYear && (
            <span className="text-[11px] text-[var(--text-tertiary)] bg-[var(--card-elevated)] px-1.5 py-0.5 rounded">
              {selectedYear}
            </span>
          )}
        </div>
      </div>

      {/* Data content */}
      <div className={compact ? 'px-4 py-3' : 'px-5 py-4'}>
        {!hasData ? (
          <div className="text-sm text-[var(--text-tertiary)] py-4 text-center">
            {lang === 'de' ? 'Keine Daten verfügbar' : 'No data available'}
          </div>
        ) : indicatorKey === 'auslaender' && ausRecord ? (
          <AuslaenderDetailContent
            record={ausRecord}
            selectedRegion={selectedSubMetric as AuslaenderRegionKey}
            lang={lang}
          />
        ) : indicatorKey === 'deutschlandatlas' && datlasRecord ? (
          <DeutschlandatlasDetailContent
            record={datlasRecord}
            selectedIndicator={selectedSubMetric as DeutschlandatlasKey}
            lang={lang}
          />
        ) : (
          <div className="text-sm text-[var(--text-tertiary)] py-4 text-center">
            {lang === 'de' ? 'Keine Daten verfügbar' : 'No data available'}
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      {/* Desktop: backdrop + panel (hidden when mobileOnly) */}
      {!mobileOnly && (
        <>
          <div
            className="hidden md:block fixed inset-0 z-[1001] bg-black/30"
            onClick={onClose}
          />

          <div className="hidden md:block fixed top-4 right-4 bottom-4 z-[1002] w-[380px] max-w-[calc(100vw-2rem)] pointer-events-none">
            <div className="bg-[var(--background)] rounded-xl border border-[var(--card-border)] shadow-2xl shadow-black/60 flex flex-col overflow-hidden pointer-events-auto animate-in slide-in-from-right-4 duration-200 h-full">
              {/* Header */}
              <div className="px-5 py-4 border-b border-[var(--card-border)] flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2.5">
                  <span className="text-[var(--text-tertiary)]">{Icons.mapPin}</span>
                  <span className="text-[11px] font-medium tracking-wide text-[var(--text-secondary)] uppercase">
                    {headerLabel}
                  </span>
                </div>
                <button
                  onClick={onClose}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--card-elevated)] transition-colors"
                  aria-label={lang === 'de' ? 'Schließen' : 'Close'}
                >
                  {Icons.close}
                </button>
              </div>

              {/* Content - scrollable */}
              <div className="flex-1 overflow-y-auto custom-scrollbar">
                {renderContent(false)}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Mobile: Bottom sheet */}
      <div
        ref={sheetRef}
        className="md:hidden fixed inset-x-0 bottom-0 z-[1002] mobile-bottom-sheet flex flex-col bg-[var(--background)] border-t border-[var(--card-border)] shadow-2xl shadow-black/60 overflow-hidden h-[100dvh] rounded-t-2xl animate-sheet-enter will-change-transform"
        {...handlers}
      >
        {/* Drag handle */}
        <div className="sheet-drag-area flex justify-center pt-3 pb-2 shrink-0 cursor-grab active:cursor-grabbing touch-action-none">
          <div className="drag-handle w-12 h-1.5 bg-[var(--text-muted)] rounded-full" />
        </div>

        {/* Header */}
        <div className="sheet-drag-area px-4 pb-3 border-b border-[var(--card-border)] flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[var(--text-tertiary)]">{Icons.mapPin}</span>
            <span className="text-[11px] font-medium tracking-wide text-[var(--text-secondary)] uppercase no-select">
              {headerLabel}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-lg text-[var(--text-tertiary)] touch-feedback active:bg-[var(--card-elevated)]"
            aria-label={lang === 'de' ? 'Schließen' : 'Close'}
          >
            {Icons.close}
          </button>
        </div>

        {/* Content - scrollable */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-touch overscroll-y-none">
          {renderContent(!isExpanded)}
        </div>
      </div>
    </>
  );
}
