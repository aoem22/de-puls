'use client';

import { useState } from 'react';
import { CRIME_CATEGORIES, type CrimeRecord } from '@/lib/types/crime';

interface BlaulichtCardCarouselProps {
  records: CrimeRecord[];
  title?: string;
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export function BlaulichtCardCarousel({
  records,
  title = 'Polizeimeldungen',
}: BlaulichtCardCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  if (records.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)]/60 p-4">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">{title}</h3>
        <p className="text-sm text-[var(--text-muted)]">
          Noch keine geocodierten Polizeimeldungen fuer diesen Kreis verfuegbar.
        </p>
      </div>
    );
  }

  const normalizeIndex = (index: number) => Math.min(index, records.length - 1);
  const safeIndex = Math.min(activeIndex, records.length - 1);
  const activeRecord = records[safeIndex];
  const fullText = activeRecord.body;

  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)]/60 p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
          <p className="text-xs text-[var(--text-muted)]">
            Karte + Vollkarte, um durch Meldungen zu wechseln
          </p>
        </div>
        <span className="text-xs px-2 py-1 rounded-md bg-[var(--card-elevated)] text-[var(--text-tertiary)]">
          {safeIndex + 1} / {records.length}
        </span>
      </div>

      <article className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] p-4">
        <div className="flex items-start justify-between gap-3">
          <h4 className="text-base font-semibold leading-snug text-[var(--text-primary)]">
            {activeRecord.cleanTitle || activeRecord.title}
          </h4>
          <time className="text-xs text-[var(--text-faint)] whitespace-nowrap shrink-0">
            {formatDate(activeRecord.publishedAt)}
          </time>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-3">
          {activeRecord.categories.map((cat) => {
            const info = CRIME_CATEGORIES.find((entry) => entry.key === cat);
            if (!info) return null;

            return (
              <span
                key={cat}
                className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs"
                style={{
                  borderColor: `${info.color}55`,
                  backgroundColor: `${info.color}22`,
                  color: info.color,
                }}
              >
                {info.label}
              </span>
            );
          })}

          {activeRecord.locationText && (
            <span className="text-xs text-[var(--text-faint)]">
              {activeRecord.locationText}
            </span>
          )}
        </div>

        {fullText ? (
          <p className="mt-3 text-sm text-[var(--text-secondary)] whitespace-pre-line max-h-52 overflow-y-auto pr-1 custom-scrollbar">
            {fullText}
          </p>
        ) : (
          <p className="mt-3 text-sm text-[var(--text-muted)]">
            Kein Beschreibungstext vorhanden.
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveIndex((prev) => (normalizeIndex(prev) === 0 ? records.length - 1 : normalizeIndex(prev) - 1))}
              className="px-3 py-1.5 text-xs rounded-md border border-[var(--card-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-faint)] transition-colors"
            >
              Zurueck
            </button>
            <button
              type="button"
              onClick={() => setActiveIndex((prev) => (normalizeIndex(prev) + 1) % records.length)}
              className="px-3 py-1.5 text-xs rounded-md border border-[var(--card-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-faint)] transition-colors"
            >
              Weiter
            </button>
          </div>

          <a
            href={activeRecord.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-cyan-500 hover:text-cyan-400 transition-colors"
          >
            Originalmeldung
          </a>
        </div>
      </article>

      {records.length > 1 && (
        <div className="mt-3 max-h-40 overflow-y-auto custom-scrollbar pr-1 space-y-1.5">
          {records.map((record, index) => (
            <button
              key={record.id}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={`w-full text-left rounded-md border px-2.5 py-2 text-xs transition-colors ${
                index === safeIndex
                  ? 'border-cyan-500/60 bg-cyan-500/10 text-cyan-500'
                  : 'border-[var(--card-border)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--text-faint)]'
              }`}
            >
              {record.cleanTitle || record.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
