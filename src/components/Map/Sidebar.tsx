'use client';

import { useState } from 'react';
import { LayerControl, PRIMARY_INDICATOR_STACK_ORDER, PRIMARY_INDICATOR_STACK_META } from './LayerControl';
import type { LayerControlProps } from './LayerControl';
import type { IndicatorKey } from '../../../lib/indicators/types';

export function Sidebar(props: LayerControlProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const handleRailIconClick = (indicator: IndicatorKey) => {
    props.onIndicatorChange(indicator);
    setIsCollapsed(false);
  };

  return (
    <aside
      className="hidden md:flex flex-col flex-shrink-0 bg-[var(--background)] border-r border-[var(--card-border)] overflow-hidden transition-[width] duration-300 ease-in-out h-full"
      style={{ width: isCollapsed ? 48 : 300 }}
    >
      {/* Header / collapse toggle */}
      <div className="flex items-center h-12 flex-shrink-0 border-b border-[var(--card-border)] px-3">
        {!isCollapsed && (
          <span className="text-sm font-semibold text-[var(--text-primary)] flex-1 truncate sidebar-content-fade-in">
            De-Puls
          </span>
        )}
        <button
          type="button"
          onClick={() => setIsCollapsed((prev) => !prev)}
          className="flex items-center justify-center w-6 h-6 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--card-elevated)] transition-colors flex-shrink-0"
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`}
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      </div>

      {/* Content area */}
      {isCollapsed ? (
        /* Collapsed rail: vertical indicator icon buttons */
        <div className="flex flex-col items-center gap-1.5 pt-3 px-1">
          {PRIMARY_INDICATOR_STACK_ORDER.map((indicatorKey) => {
            const meta = PRIMARY_INDICATOR_STACK_META[indicatorKey];
            const isActive = props.selectedIndicator === indicatorKey;
            return (
              <button
                key={indicatorKey}
                type="button"
                onClick={() => handleRailIconClick(indicatorKey)}
                className={`flex items-center justify-center w-8 h-8 rounded-md text-xs font-semibold transition-colors ${
                  isActive
                    ? meta.activeClassName
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--card-elevated)]'
                }`}
                title={indicatorKey}
              >
                <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${meta.badgeClassName}`}>
                  {meta.symbol}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        /* Expanded: full LayerControl in scrollable area */
        <div className="flex-1 overflow-y-auto scrollbar-thin p-3 sidebar-content-fade-in">
          <LayerControl {...props} />
        </div>
      )}
    </aside>
  );
}
