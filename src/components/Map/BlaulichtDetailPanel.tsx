'use client';

import type { CrimeRecord, CrimeCategory } from '@/lib/types/crime';
import { CRIME_CATEGORIES } from '@/lib/types/crime';

interface BlaulichtDetailPanelProps {
  crime: CrimeRecord;
  onClose: () => void;
  isPreview?: boolean; // When true, shown on hover without backdrop
}

// Category metadata for display
const categoryMeta = new Map<CrimeCategory, { label: string; color: string }>(
  CRIME_CATEGORIES.map((cat) => [cat.key, { label: cat.label, color: cat.color }])
);

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function getCategoryInfo(category: CrimeCategory) {
  return categoryMeta.get(category) ?? { label: category, color: '#6b7280' };
}

// Clean SVG icons
const Icons = {
  close: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  ),
  calendar: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  ),
  location: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M12 21c-4-4-8-7.5-8-11a8 8 0 1116 0c0 3.5-4 7-8 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  ),
  tag: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M12 2l9 9-9.5 9.5a2.12 2.12 0 01-3 0L2 14l9-9a2 2 0 011-1z" />
      <circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" />
    </svg>
  ),
  target: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  ),
  agency: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 21h18M9 21V10l-3 2V8l6-4 6 4v4l-3-2v11" />
      <path d="M12 7v0" />
    </svg>
  ),
  externalLink: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
    </svg>
  ),
  alert: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16v.01" />
    </svg>
  ),
};

export function BlaulichtDetailPanel({ crime, onClose, isPreview = false }: BlaulichtDetailPanelProps) {
  const primaryCategory = crime.categories[0] ?? 'other';
  const categoryInfo = getCategoryInfo(primaryCategory);

  // Extract domain from URL for display
  const sourceDomain = (() => {
    try {
      return new URL(crime.sourceUrl).hostname.replace('www.', '');
    } catch {
      return 'presseportal.de';
    }
  })();

  // Get body text - use body field if available, otherwise summary
  const bodyText = crime.body || crime.summary;

  return (
    <>
      {/* Backdrop - only for selected (not preview) */}
      {!isPreview && (
        <div
          className="fixed inset-0 z-[1001] bg-black/30"
          onClick={onClose}
        />
      )}

      {/* Right-side panel */}
      <div className={`fixed top-4 right-4 z-[1002] w-[380px] max-w-[calc(100vw-2rem)] pointer-events-none ${isPreview ? 'bottom-auto max-h-[70vh]' : 'bottom-4'}`}>
        <div className={`bg-[#0c0c0c] rounded-xl border shadow-2xl shadow-black/60 flex flex-col overflow-hidden pointer-events-auto animate-in slide-in-from-right-4 duration-200 ${isPreview ? 'border-[#252525]' : 'border-[#1a1a1a] h-full'}`}>

          {/* Header */}
          <div className="px-5 py-4 border-b border-[#1a1a1a] flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <span className="text-zinc-400">{Icons.alert}</span>
              <span className="text-xs font-medium tracking-wide text-zinc-400 uppercase">
                Pressemitteilung
              </span>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-[#1a1a1a] transition-colors"
              aria-label="Schließen"
            >
              {Icons.close}
            </button>
          </div>

          {/* Content area - scrollable */}
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {/* Title section */}
            <div className="px-5 py-5 border-b border-[#151515]">
              <h2 className="text-[15px] font-semibold text-zinc-100 leading-relaxed">
                {crime.title}
              </h2>
            </div>

            {/* Metadata section */}
            <div className="px-5 py-4 space-y-3 border-b border-[#151515] bg-[#0a0a0a]">
              {/* Date */}
              <div className="flex items-center gap-3">
                <span className="text-zinc-500 w-5 flex justify-center">{Icons.calendar}</span>
                <span className="text-sm text-zinc-300">{formatDate(crime.publishedAt)}</span>
              </div>

              {/* Location */}
              {crime.locationText && (
                <div className="flex items-center gap-3">
                  <span className="text-zinc-500 w-5 flex justify-center">{Icons.location}</span>
                  <span className="text-sm text-zinc-300">{crime.locationText}</span>
                </div>
              )}

              {/* Agency */}
              {crime.sourceAgency && (
                <div className="flex items-center gap-3">
                  <span className="text-zinc-500 w-5 flex justify-center">{Icons.agency}</span>
                  <span className="text-sm text-zinc-400">{crime.sourceAgency}</span>
                </div>
              )}

              {/* Category badges */}
              <div className="flex items-start gap-3">
                <span className="text-zinc-500 w-5 flex justify-center mt-0.5">{Icons.tag}</span>
                <div className="flex flex-wrap gap-1.5">
                  {crime.categories.length > 0 ? (
                    crime.categories.map((cat) => {
                      const info = getCategoryInfo(cat);
                      return (
                        <span
                          key={cat}
                          className="px-2.5 py-1 text-xs rounded-md border font-medium"
                          style={{
                            backgroundColor: `${info.color}10`,
                            borderColor: `${info.color}30`,
                            color: info.color,
                          }}
                        >
                          {info.label}
                        </span>
                      );
                    })
                  ) : (
                    <span className="px-2.5 py-1 text-xs rounded-md bg-zinc-900 border border-zinc-800 text-zinc-500">
                      Sonstiges
                    </span>
                  )}
                </div>
              </div>

              {/* Precision indicator */}
              <div className="flex items-center gap-3">
                <span className="text-zinc-500 w-5 flex justify-center">{Icons.target}</span>
                <span className="text-xs text-zinc-500">
                  Genauigkeit: <span className="text-zinc-400 ml-1">{crime.precision}</span>
                </span>
              </div>
            </div>

            {/* Body text section */}
            {bodyText && (
              <div className="px-5 py-5">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-[10px] font-semibold tracking-widest text-zinc-600 uppercase">
                    Meldung
                  </span>
                  <div className="flex-1 h-px bg-[#1a1a1a]" />
                </div>
                <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
                  {bodyText}
                </p>
              </div>
            )}
          </div>

          {/* Footer - Source link */}
          <div className="px-5 py-4 border-t border-[#1a1a1a] bg-[#080808] flex-shrink-0">
            <a
              href={crime.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 text-sm text-zinc-400 hover:text-zinc-100 transition-colors group"
            >
              <span className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform">
                {Icons.externalLink}
              </span>
              <span>Quelle öffnen</span>
              <span className="text-zinc-600 text-xs ml-auto">{sourceDomain}</span>
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
