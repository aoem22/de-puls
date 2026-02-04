'use client';

import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { AuslaenderRegionKey, IndicatorKey, DeutschlandatlasKey } from '../../../lib/indicators/types';
import { AUSLAENDER_REGION_META, DEUTSCHLANDATLAS_META, isDeutschlandatlasKey } from '../../../lib/indicators/types';
import { formatNumber, formatValue, calcPercentParens } from '../../../lib/utils/formatters';
import { auslaender, deutschlandatlas } from './KreisLayer';

interface KreisHoverCardProps {
  mouseX: number;
  mouseY: number;
  kreisName: string;
  ags: string;
  indicatorKey: IndicatorKey;
  selectedSubMetric: string;
  selectedYear: string;
}

// Ausländer hover content
function AuslaenderHoverContent({
  record,
  selectedRegion,
  ags,
  kreisName,
}: {
  record: { name: string; ags: string; regions: Record<AuslaenderRegionKey, { male: number | null; female: number | null; total: number | null }> } | null;
  selectedRegion: AuslaenderRegionKey;
  ags: string;
  kreisName: string;
}) {
  if (!record) {
    return (
      <div className="p-3">
        <div className="font-bold text-white text-sm leading-tight">{kreisName}</div>
        <div className="text-[11px] text-zinc-500 mt-1">AGS: {ags}</div>
        <div className="text-xs text-zinc-400 mt-2">Keine Daten verfügbar</div>
      </div>
    );
  }

  const continents = ['europa', 'asien', 'afrika', 'amerika', 'ozeanien'] as const;
  const total = record.regions.total?.total;
  const selectedMeta = AUSLAENDER_REGION_META[selectedRegion];
  const selectedValue = record.regions[selectedRegion]?.total;
  const selectedData = record.regions[selectedRegion];

  return (
    <div className="p-3">
      {/* Header */}
      <div className="font-bold text-white text-sm leading-tight border-b border-[#444] pb-2 mb-2">
        {record.name || kreisName}
      </div>

      {/* Selected region highlight - only show when not "Gesamt" to avoid duplication */}
      {selectedRegion !== 'total' && (
        <div className="border-b border-[#444] pb-2 mb-2">
          <div className="text-amber-400 text-[11px] mb-1">
            Aktuell: <span className="font-bold">{selectedMeta.labelDe}</span>
          </div>
          <div className="text-2xl font-bold text-amber-400">
            {formatNumber(selectedValue)}
            <span className="text-zinc-500 text-sm ml-1">{calcPercentParens(selectedValue, total)}</span>
          </div>
          {selectedData && (
            <div className="flex gap-4 mt-1.5">
              <div>
                <span className="text-blue-400 text-sm">♂</span>
                <span className="text-zinc-300 text-sm ml-1">{formatNumber(selectedData.male)}</span>
              </div>
              <div>
                <span className="text-pink-400 text-sm">♀</span>
                <span className="text-zinc-300 text-sm ml-1">{formatNumber(selectedData.female)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Total */}
      <div className="flex justify-between items-baseline mb-2">
        <span className="text-zinc-500 text-[10px]">AGS: {ags}</span>
        <div>
          <span className="text-xl font-bold text-amber-400">{formatNumber(total)}</span>
          <span className="text-zinc-500 text-[10px] ml-1">Gesamt</span>
        </div>
      </div>

      {/* Continents */}
      <div className="border-t border-[#333] pt-2">
        <div className="text-zinc-500 text-[9px] uppercase tracking-wider mb-1">Nach Kontinent</div>
        <div className="space-y-0.5">
          {continents.map((continent) => {
            const val = record.regions[continent]?.total;
            const meta = AUSLAENDER_REGION_META[continent];
            const isSelected = selectedRegion === continent;
            const pct = calcPercentParens(val, total);

            return (
              <div
                key={continent}
                className={`flex justify-between py-0.5 px-1 rounded ${
                  isSelected ? 'bg-amber-500/15' : ''
                }`}
              >
                <span className={`text-[11px] ${isSelected ? 'text-amber-400' : 'text-zinc-400'}`}>
                  {meta.labelDe}
                </span>
                <span className={`text-[11px] ${isSelected ? 'text-amber-400 font-semibold' : 'text-white'}`}>
                  {formatNumber(val)}
                  {pct && <span className="text-zinc-600 text-[10px] ml-1">{pct}</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Deutschlandatlas hover content
function DeutschlandatlasHoverContent({
  record,
  selectedIndicator,
  ags,
  kreisName,
}: {
  record: { name: string; ags: string; indicators: Record<string, number | null> } | null;
  selectedIndicator: DeutschlandatlasKey;
  ags: string;
  kreisName: string;
}) {
  if (!record) {
    return (
      <div className="p-3">
        <div className="font-bold text-white text-sm leading-tight">{kreisName}</div>
        <div className="text-[11px] text-zinc-500 mt-1">AGS: {ags}</div>
        <div className="text-xs text-zinc-400 mt-2">Keine Daten verfügbar</div>
      </div>
    );
  }

  const meta = DEUTSCHLANDATLAS_META[selectedIndicator];
  const value = record.indicators[selectedIndicator];

  // Priority indicators to show in hover
  const priorityIndicators: DeutschlandatlasKey[] = [
    'kinder_bg', 'alq', 'hh_veink', 'bev_ausl', 'straft'
  ];

  return (
    <div className="p-3">
      {/* Header */}
      <div className="font-bold text-white text-sm leading-tight border-b border-[#444] pb-2 mb-2">
        {record.name || kreisName}
      </div>

      {/* AGS */}
      <div className="text-zinc-500 text-[10px] mb-2">AGS: {ags}</div>

      {/* Selected indicator highlight */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded p-2 mb-2">
        <div className="text-amber-400 text-[10px] mb-0.5">{meta.labelDe}</div>
        <div className="text-lg font-bold text-white">
          {formatValue(value)}
          {meta.unitDe && <span className="text-zinc-400 text-xs ml-1">{meta.unitDe}</span>}
        </div>
        {meta.higherIsBetter !== undefined && (
          <div className={`text-[9px] mt-0.5 ${meta.higherIsBetter ? 'text-green-400' : 'text-orange-400'}`}>
            {meta.higherIsBetter ? '↑ Höher ist besser' : '↓ Niedriger ist besser'}
          </div>
        )}
      </div>

      {/* Priority indicators */}
      <div className="border-t border-[#333] pt-2">
        <div className="text-zinc-500 text-[9px] uppercase tracking-wider mb-1">Schnellübersicht</div>
        <div className="space-y-0.5">
          {priorityIndicators.filter(k => k !== selectedIndicator).slice(0, 4).map((key) => {
            const val = record.indicators[key];
            const indMeta = DEUTSCHLANDATLAS_META[key];

            return (
              <div key={key} className="flex justify-between py-0.5 px-1">
                <span className="text-[10px] text-zinc-400">{indMeta.labelDe}</span>
                <span className="text-[10px] text-white">
                  {formatValue(val)}
                  {indMeta.unitDe && <span className="text-zinc-600 ml-0.5">{indMeta.unitDe}</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function KreisHoverCard({
  mouseX,
  mouseY,
  kreisName,
  ags,
  indicatorKey,
  selectedSubMetric,
  selectedYear,
}: KreisHoverCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!cardRef.current) return;

    const card = cardRef.current;
    const cardRect = card.getBoundingClientRect();
    const cardWidth = cardRect.width || 280;
    const cardHeight = cardRect.height || 400;
    const padding = 16;
    const offset = 12;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x = mouseX + offset;
    let y = mouseY - cardHeight / 2;

    // Horizontal positioning
    if (x + cardWidth > viewportWidth - padding) {
      x = mouseX - cardWidth - offset;
    }
    if (x < padding) {
      x = padding;
    }

    // Vertical positioning
    if (y < padding) {
      y = padding;
    }
    if (y + cardHeight > viewportHeight - padding) {
      y = viewportHeight - cardHeight - padding;
    }

    setPosition({ x, y });
  }, [mouseX, mouseY]);

  if (!mounted) return null;

  // Get record based on indicator type
  const getRecord = () => {
    if (indicatorKey === 'auslaender') {
      const yearData = auslaender.data[selectedYear];
      return yearData?.[ags] ?? null;
    } else {
      return deutschlandatlas.data[ags] ?? null;
    }
  };

  const record = getRecord();

  const content = (
    <div
      ref={cardRef}
      className="fixed z-[10000] pointer-events-none"
      style={{
        left: position.x,
        top: position.y,
        transform: 'translateZ(0)',
      }}
    >
      <div className="bg-[#1a1a1a] border border-[#333] rounded-xl shadow-2xl min-w-[220px] max-w-[280px] overflow-hidden">
        {indicatorKey === 'auslaender' ? (
          <AuslaenderHoverContent
            record={record as { name: string; ags: string; regions: Record<AuslaenderRegionKey, { male: number | null; female: number | null; total: number | null }> } | null}
            selectedRegion={selectedSubMetric as AuslaenderRegionKey}
            ags={ags}
            kreisName={kreisName}
          />
        ) : (
          <DeutschlandatlasHoverContent
            record={record as { name: string; ags: string; indicators: Record<string, number | null> } | null}
            selectedIndicator={selectedSubMetric as DeutschlandatlasKey}
            ags={ags}
            kreisName={kreisName}
          />
        )}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
