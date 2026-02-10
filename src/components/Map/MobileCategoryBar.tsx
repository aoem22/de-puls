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

const INDICATOR_ACCENT: Record<IndicatorKey, string> = {
  auslaender: '#ef4444',
  deutschlandatlas: '#8b5cf6',
  kriminalstatistik: '#f59e0b',
  blaulicht: '#3b82f6',
};

interface MobileCategoryBarProps {
  selectedIndicator: IndicatorKey;
  onIndicatorChange: (indicator: IndicatorKey) => void;
  onOpenSettings: () => void;
  isSettingsOpen?: boolean;
}

export function MobileCategoryBar({
  selectedIndicator,
  onIndicatorChange,
  onOpenSettings,
  isSettingsOpen,
}: MobileCategoryBarProps) {
  const { lang } = useTranslation();

  return (
    <div className="md:hidden fixed top-4 left-0 right-0 z-[1001] overflow-x-auto scrollbar-hide scroll-snap-x-mandatory">
      <div className="flex gap-2 w-max px-3 py-0.5">
        {PRIMARY_INDICATOR_STACK_ORDER.map((indicatorKey) => {
          const isSelected = selectedIndicator === indicatorKey;
          const meta = PRIMARY_INDICATOR_STACK_META[indicatorKey];
          const label = tNested('indicators', indicatorKey, lang);

          return (
            <button
              key={indicatorKey}
              type="button"
              onClick={() => onIndicatorChange(indicatorKey)}
              style={{ '--cat-accent': INDICATOR_ACCENT[indicatorKey] } as React.CSSProperties}
              className={`mobile-cat-btn glass-button flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-all scroll-snap-start ${
                isSelected
                  ? `mobile-cat-btn--active ${meta.activeClassName} text-[var(--text-primary)]`
                  : 'text-[var(--text-secondary)]'
              }`}
            >
              <span
                className={`inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${meta.badgeClassName}`}
              >
                {meta.symbol}
              </span>
              <span className="leading-none">{label}</span>
              <span
                className={`ml-1 -mr-1.5 self-stretch aspect-square rounded-full border-2 flex items-center justify-center transition-all glass-button ${
                  isSelected && isSettingsOpen
                    ? 'border-[var(--cat-accent)] bg-[var(--cat-accent)]/85 text-white'
                  : isSelected
                      ? `border-[var(--cat-accent)] bg-[var(--cat-accent)]/12 ${CHEVRON_ACTIVE_COLOR[indicatorKey]}`
                      : 'text-[var(--text-tertiary)]'
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isSelected) {
                    onIndicatorChange(indicatorKey);
                  }
                  onOpenSettings();
                }}
              >
                <svg
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${isSelected && isSettingsOpen ? 'rotate-180' : ''}`}
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                >
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
