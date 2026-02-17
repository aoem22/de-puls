'use client';

import { useState } from 'react';
import { useLiveFeed } from '@/lib/supabase/hooks';
import type { CrimeCategory } from '@/lib/types/crime';
import { LiveFeedCard } from './LiveFeedCard';

const FILTER_OPTIONS: Array<{ label: string; categories: CrimeCategory[] }> = [
  { label: 'Alle', categories: ['knife', 'murder', 'sexual'] },
  { label: 'Messer', categories: ['knife'] },
  { label: 'Mord', categories: ['murder'] },
  { label: 'Sexual', categories: ['sexual'] },
];

export function LiveFeed() {
  const [filterIdx, setFilterIdx] = useState(0);
  const filter = FILTER_OPTIONS[filterIdx];
  const { records, isLoading, isLoadingMore, hasMore, loadMore } = useLiveFeed(filter.categories);

  return (
    <section
      className="dashboard-rise dashboard-delay-2 overflow-hidden rounded-[1.75rem] border px-4 py-5 sm:px-6 sm:py-6"
      style={{
        borderColor: 'var(--border-subtle)',
        background: 'linear-gradient(145deg, var(--card) 0%, var(--card-elevated) 100%)',
      }}
    >
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.24em]"
          style={{ color: 'var(--text-faint)' }}
        >
          Live Feed - Gewaltverbrechen
        </h2>
        <div className="inline-flex rounded-xl border p-1"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--card)' }}
        >
          {FILTER_OPTIONS.map((opt, i) => {
            const active = i === filterIdx;
            return (
              <button
                key={opt.label}
                onClick={() => setFilterIdx(i)}
                className="rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all no-select"
                style={active
                  ? {
                      background: 'linear-gradient(140deg, #0891b2 0%, #0ea5e9 100%)',
                      color: '#fff',
                    }
                  : { color: 'var(--text-muted)' }
                }
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border h-[76px] animate-pulse"
              style={{ background: 'var(--loading-skeleton)', borderColor: 'var(--border-subtle)' }}
            />
          ))
        ) : records.length === 0 ? (
          <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>
            Keine aktuellen Meldungen.
          </p>
        ) : (
          records.map((rec) => (
            <LiveFeedCard key={rec.id} record={rec} />
          ))
        )}
      </div>

      {hasMore && (
        <button
          onClick={loadMore}
          disabled={isLoadingMore}
          className="mt-3 w-full rounded-xl border py-2 text-xs font-semibold transition-colors no-select"
          style={{
            background: 'var(--card)',
            borderColor: 'var(--border-subtle)',
            color: 'var(--text-muted)',
          }}
        >
          {isLoadingMore ? 'Laden...' : 'Mehr laden...'}
        </button>
      )}
    </section>
  );
}
