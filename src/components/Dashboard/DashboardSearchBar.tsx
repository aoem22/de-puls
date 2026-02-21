'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useDashboardSearch, type DashboardSearchResult, type DashboardSearchFilters } from '@/lib/supabase';
import { CRIME_CATEGORIES } from '@/lib/types/crime';

const categoryColorMap = new Map(
  CRIME_CATEGORIES.map((cat) => [cat.key, cat.color]),
);

const categoryLabelMap = new Map(
  CRIME_CATEGORIES.map((cat) => [cat.key, { label: cat.label, icon: cat.icon }]),
);

function formatTatzeit(incidentDate: string | null, incidentTime: string | null): string | null {
  if (!incidentDate) return null;
  // incidentDate is "YYYY-MM-DD", incidentTime is "HH:MM" or similar
  const parts = incidentDate.split('-');
  if (parts.length !== 3) return incidentDate;
  const dateStr = `${parts[2]}.${parts[1]}.${parts[0].slice(2)}`;
  if (incidentTime) return `${dateStr}, ${incidentTime}`;
  return dateStr;
}

interface DashboardSearchBarProps {
  onResultSelect?: (result: DashboardSearchResult) => void;
  filters?: DashboardSearchFilters;
}

export function DashboardSearchBar({ onResultSelect, filters }: DashboardSearchBarProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce 300ms
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [query]);

  const { data, isValidating } = useDashboardSearch(debouncedQuery, filters);
  const isSearching = isValidating && debouncedQuery.length >= 2;

  const results = data?.results ?? [];
  const total = data?.total ?? 0;

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

  const handleResultClick = useCallback(
    (result: DashboardSearchResult) => {
      setIsOpen(false);
      setQuery('');
      setDebouncedQuery('');
      onResultSelect?.(result);
    },
    [onResultSelect],
  );

  const handleClear = useCallback(() => {
    setQuery('');
    setDebouncedQuery('');
    setIsOpen(false);
    inputRef.current?.focus();
  }, []);

  const showDropdown = isOpen && debouncedQuery.length >= 2 && (results.length > 0 || isSearching);

  return (
    <div ref={wrapperRef} className="relative w-full">
      <div className="relative">
        <svg
          className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
          style={{ color: 'var(--text-muted)' }}
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
          onFocus={() => {
            if (debouncedQuery.length >= 2 && results.length > 0) setIsOpen(true);
          }}
          placeholder="Polizeimeldung suchen — Titel, Ort, URL&hellip;"
          className="w-full pl-10 pr-10 py-2.5 sm:py-3 text-sm sm:text-base rounded-xl border transition-colors"
          style={{
            borderColor: isOpen && results.length > 0 ? 'var(--accent)' : 'var(--border-subtle)',
            background: 'var(--card)',
            color: 'var(--text-primary)',
          }}
        />
        {isSearching && (
          <div
            className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 border-2 rounded-full animate-spin"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
          />
        )}
        {!isSearching && query && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-sm transition-colors"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Suche leeren"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Results dropdown */}
      {showDropdown && (
        <div
          className="absolute z-50 left-0 right-0 mt-1.5 max-h-[360px] overflow-y-auto rounded-xl border shadow-lg"
          style={{
            borderColor: 'var(--border-subtle)',
            background: 'var(--card)',
          }}
        >
          {results.length > 0 && (
            <>
              {results.map((result) => {
                const catKey = result.categories?.[0];
                const catColor = catKey
                  ? categoryColorMap.get(catKey) ?? '#3b82f6'
                  : '#3b82f6';
                const catInfo = catKey ? categoryLabelMap.get(catKey) : null;
                const tatzeit = formatTatzeit(result.incident_date, result.incident_time);
                const ort = result.location_text || result.city;
                return (
                  <button
                    key={result.id}
                    type="button"
                    onClick={() => handleResultClick(result)}
                    className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors border-b last:border-b-0"
                    style={{ borderColor: 'var(--border-inner)' }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background = 'var(--card-elevated)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = 'transparent';
                    }}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5"
                      style={{ backgroundColor: catColor }}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className="block text-sm font-medium leading-snug line-clamp-1"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {result.clean_title || result.title}
                      </span>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                        {tatzeit && (
                          <span
                            className="text-[11px] tabular-nums"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            {tatzeit}
                          </span>
                        )}
                        {ort && (
                          <span
                            className="text-[11px] truncate max-w-[160px]"
                            style={{ color: 'var(--text-faint)' }}
                          >
                            {ort}
                          </span>
                        )}
                        {catInfo && (
                          <span
                            className="text-[10px] font-semibold rounded px-1 py-px"
                            style={{
                              backgroundColor: `color-mix(in srgb, ${catColor} 15%, transparent)`,
                              color: catColor,
                            }}
                          >
                            {catInfo.icon} {catInfo.label}
                          </span>
                        )}
                      </span>
                    </span>
                    <svg
                      className="w-3.5 h-3.5 flex-shrink-0 mt-1"
                      style={{ color: 'var(--text-faint)' }}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                );
              })}
              {total > results.length && (
                <div
                  className="px-3 py-2 text-center text-xs"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {results.length} von {total.toLocaleString('de-DE')} Treffern angezeigt
                </div>
              )}
            </>
          )}
          {isSearching && results.length === 0 && (
            <div
              className="px-3 py-4 text-center text-sm"
              style={{ color: 'var(--text-muted)' }}
            >
              Suche&hellip;
            </div>
          )}
        </div>
      )}

      {/* No results message */}
      {isOpen && debouncedQuery.length >= 2 && !isSearching && results.length === 0 && data && (
        <div
          className="absolute z-50 left-0 right-0 mt-1.5 rounded-xl border px-3 py-3 text-center text-sm"
          style={{
            borderColor: 'var(--border-subtle)',
            background: 'var(--card)',
            color: 'var(--text-muted)',
          }}
        >
          Keine Treffer
        </div>
      )}
    </div>
  );
}
