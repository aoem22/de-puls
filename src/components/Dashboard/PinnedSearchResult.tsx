'use client';

import { useState } from 'react';
import type { DashboardSearchResult } from '@/lib/supabase';
import { useCrimeBody } from '@/lib/supabase/hooks';
import { FormattedBody } from '@/components/ui/FormattedBody';
import { CRIME_CATEGORIES } from '@/lib/types/crime';

const categoryColorMap = new Map(
  CRIME_CATEGORIES.map((cat) => [cat.key, cat.color]),
);

const categoryLabelMap = new Map(
  CRIME_CATEGORIES.map((cat) => [cat.key, cat.label]),
);

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

interface PinnedSearchResultProps {
  result: DashboardSearchResult;
  onDismiss: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: (id: string) => void;
}

export function PinnedSearchResult({ result, onDismiss, isFavorite, onToggleFavorite }: PinnedSearchResultProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const { data: body, isLoading } = useCrimeBody(isExpanded ? result.id : null);

  const catColor = result.categories?.[0]
    ? categoryColorMap.get(result.categories[0]) ?? '#3b82f6'
    : '#3b82f6';

  const catLabels = result.categories
    ?.map((c) => categoryLabelMap.get(c))
    .filter(Boolean);

  return (
    <section
      className="dashboard-rise rounded-2xl border p-3 sm:p-5"
      style={{
        borderColor: 'var(--accent)',
        background: 'linear-gradient(145deg, var(--card) 0%, var(--card-elevated) 100%)',
        boxShadow: '0 0 0 1px var(--accent), 0 0 12px color-mix(in srgb, var(--accent) 15%, transparent)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <span
          className="text-[11px] font-bold uppercase tracking-[0.2em]"
          style={{ color: 'var(--accent)' }}
        >
          Suchergebnis
        </span>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors hover:opacity-80"
          style={{
            background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
            color: 'var(--accent)',
          }}
        >
          Schliessen
          <span className="text-[9px]">&times;</span>
        </button>
      </div>

      {/* Card */}
      <div
        className="rounded-xl border transition-all"
        style={{
          borderColor: 'var(--accent)',
          background: 'var(--card)',
        }}
      >
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="w-full px-3 py-3 text-left"
        >
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {/* Category badge */}
            <span
              className="inline-flex items-center gap-1.5 shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={{
                background: `color-mix(in srgb, ${catColor} 15%, transparent)`,
                color: catColor,
              }}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: catColor }}
              />
              {catLabels?.[0] ?? 'Vorfall'}
            </span>

            {/* Location */}
            <span
              className="order-3 w-full text-xs sm:order-none sm:w-auto sm:truncate"
              style={{ color: 'var(--text-muted)' }}
            >
              {[result.city, result.bundesland].filter(Boolean).join(', ')}
            </span>

            {/* Date */}
            <span
              className="ml-auto shrink-0 text-[11px] tabular-nums sm:text-xs"
              style={{ color: 'var(--text-faint)' }}
            >
              {formatDate(result.published_at)}
            </span>

            {/* Favorite */}
            {onToggleFavorite && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggleFavorite(result.id); }}
                className="shrink-0 p-0.5 transition-colors hover:scale-110"
                aria-label={isFavorite ? 'Favorit entfernen' : 'Als Favorit markieren'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill={isFavorite ? '#f59e0b' : 'none'} stroke={isFavorite ? '#f59e0b' : 'var(--text-faint)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </button>
            )}
          </div>

          {/* Title */}
          <p
            className="mt-1.5 text-sm font-semibold leading-snug"
            style={{ color: 'var(--text-primary)' }}
          >
            {result.clean_title || result.title}
          </p>
        </button>

        {/* Expanded body */}
        {isExpanded && (
          <div
            className="border-t px-3 py-3"
            style={{ borderColor: 'var(--border-inner)' }}
          >
            {isLoading && !body && (
              <div className="h-12 animate-pulse rounded-lg" style={{ background: 'var(--loading-skeleton)' }} />
            )}
            {body && <FormattedBody text={body} compact />}
            {!isLoading && !body && (
              <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Kein Artikeltext verfügbar.</p>
            )}
            <div className="mt-2 flex items-center gap-3">
              {result.source_url && (
                <a
                  href={result.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-[11px] font-semibold underline decoration-dotted underline-offset-2"
                  style={{ color: 'var(--accent)' }}
                >
                  Originalquelle
                </a>
              )}
              <a
                href={`/karte?id=${result.id}`}
                className="inline-block text-[11px] font-semibold underline decoration-dotted underline-offset-2"
                style={{ color: 'var(--text-secondary)' }}
              >
                Auf Karte anzeigen
              </a>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
