'use client';

import type { IndicatorKey } from '../../../lib/indicators/types';
import { PRIMARY_INDICATOR_STACK_ORDER, PRIMARY_INDICATOR_STACK_META } from './LayerControl';
import { tNested, useTranslation } from '@/lib/i18n';

const CHEVRON_ACTIVE_COLOR: Record<IndicatorKey, string> = {
  auslaender: 'text-red-400',
  deutschlandatlas: 'text-violet-400',
  kriminalstatistik: 'text-orange-400',
  blaulicht: 'text-blue-400',
};

interface MobileCategoryBarProps {
  selectedIndicator: IndicatorKey;
  onIndicatorChange: (indicator: IndicatorKey) => void;
  onOpenSettings: () => void;
}

export function MobileCategoryBar({
  selectedIndicator,
  onIndicatorChange,
  onOpenSettings,
}: MobileCategoryBarProps) {
  const { lang } = useTranslation();

  return (
    <div className="md:hidden fixed top-3 left-3 right-3 z-[1001] overflow-x-auto scrollbar-hide scroll-snap-x-mandatory">
      <div className="flex gap-2 w-max px-0.5 py-0.5">
        {PRIMARY_INDICATOR_STACK_ORDER.map((indicatorKey) => {
          const isSelected = selectedIndicator === indicatorKey;
          const meta = PRIMARY_INDICATOR_STACK_META[indicatorKey];
          const label = tNested('indicators', indicatorKey, lang);

          return (
            <button
              key={indicatorKey}
              type="button"
              onClick={() => onIndicatorChange(indicatorKey)}
              className={`flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium whitespace-nowrap backdrop-blur-sm transition-all touch-feedback active:scale-95 scroll-snap-start ${
                isSelected
                  ? `${meta.activeClassName} bg-[#141414]/95 shadow-lg`
                  : 'border-[#333] bg-[#141414]/80 text-zinc-300 active:bg-[#1a1a1a]'
              }`}
            >
              <span
                className={`inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${meta.badgeClassName}`}
              >
                {meta.symbol}
              </span>
              <span className="leading-none">{label}</span>
              <span
                className={`ml-1 -mr-1 p-1 ${isSelected ? CHEVRON_ACTIVE_COLOR[indicatorKey] : 'text-zinc-400'}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onIndicatorChange(indicatorKey);
                  onOpenSettings();
                }}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
