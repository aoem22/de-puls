'use client';

import { useRef, useCallback, type TouchEvent } from 'react';
import type { CrimeRecord, CrimeCategory } from '@/lib/types/crime';
import { CRIME_CATEGORIES, WEAPON_LABELS } from '@/lib/types/crime';
import { useTranslation, translations, tNested } from '@/lib/i18n';

// Draggable bottom sheet hook
function useDraggableSheet(onClose: () => void, threshold = 100) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef<number>(0);
  const currentTranslateY = useRef<number>(0);
  const isDragging = useRef<boolean>(false);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.sheet-drag-area')) return;

    isDragging.current = true;
    dragStartY.current = e.touches[0].clientY;
    currentTranslateY.current = 0;

    if (sheetRef.current) {
      sheetRef.current.style.transition = 'none';
    }
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isDragging.current || !sheetRef.current) return;

    const deltaY = e.touches[0].clientY - dragStartY.current;
    if (deltaY > 0) {
      currentTranslateY.current = deltaY;
      sheetRef.current.style.transform = `translateY(${deltaY}px)`;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging.current || !sheetRef.current) return;

    isDragging.current = false;
    sheetRef.current.style.transition = 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)';

    if (currentTranslateY.current > threshold) {
      sheetRef.current.style.transform = 'translateY(100%)';
      setTimeout(onClose, 300);
    } else {
      sheetRef.current.style.transform = 'translateY(0)';
    }
    currentTranslateY.current = 0;
  }, [onClose, threshold]);

  return {
    sheetRef,
    handlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
  };
}

interface BlaulichtDetailPanelProps {
  crime: CrimeRecord;
  onClose: () => void;
  isPreview?: boolean; // When true, shown on hover without backdrop
  flashToken?: number; // Increment to trigger a visual flash
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

export function BlaulichtDetailPanel({ crime, onClose, isPreview = false, flashToken = 0 }: BlaulichtDetailPanelProps) {
  const { sheetRef, handlers } = useDraggableSheet(onClose);
  const { lang } = useTranslation();
  const t = translations;
  const flashClass = flashToken > 0
    ? (flashToken % 2 === 0 ? 'blaulicht-panel-flash-a' : 'blaulicht-panel-flash-b')
    : '';

  // Get translated category label
  const getCategoryLabel = (cat: CrimeCategory) => {
    const translated = tNested('crimeCategories', cat, lang);
    return translated !== cat ? translated : categoryMeta.get(cat)?.label ?? cat;
  };

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

      {/* Desktop: Right-side panel */}
      <div className={`hidden md:block fixed top-4 right-4 z-[1002] w-[380px] max-w-[calc(100vw-2rem)] pointer-events-none ${isPreview ? 'bottom-auto max-h-[70vh]' : 'bottom-4'}`}>
        <div className={`bg-[#0c0c0c] rounded-xl border shadow-2xl shadow-black/60 flex flex-col overflow-hidden pointer-events-auto animate-in slide-in-from-right-4 duration-200 ${isPreview ? 'border-[#252525]' : 'border-[#1a1a1a] h-full'} ${flashClass}`}>

          {/* Header */}
          <div className="px-5 py-4 border-b border-[#1a1a1a] flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <span className="text-zinc-400">{Icons.alert}</span>
              <span className="text-[11px] font-medium tracking-wide text-zinc-300 uppercase">
                {t.pressRelease[lang]}
              </span>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-[#1a1a1a] transition-colors"
              aria-label={t.close[lang]}
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
                <span className="text-zinc-400 w-5 flex justify-center">{Icons.calendar}</span>
                <span className="text-sm text-zinc-300">{formatDate(crime.publishedAt)}</span>
              </div>

              {/* Location */}
              {crime.locationText && (
                <div className="flex items-center gap-3">
                  <span className="text-zinc-400 w-5 flex justify-center">{Icons.location}</span>
                  <span className="text-sm text-zinc-300">{crime.locationText}</span>
                </div>
              )}

              {/* Agency */}
              {crime.sourceAgency && (
                <div className="flex items-center gap-3">
                  <span className="text-zinc-400 w-5 flex justify-center">{Icons.agency}</span>
                  <span className="text-sm text-zinc-300">{crime.sourceAgency}</span>
                </div>
              )}

              {/* Category badges */}
              <div className="flex items-start gap-3">
                <span className="text-zinc-400 w-5 flex justify-center mt-0.5">{Icons.tag}</span>
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
                          {getCategoryLabel(cat)}
                        </span>
                      );
                    })
                  ) : (
                    <span className="px-2.5 py-1 text-xs rounded-md bg-zinc-900 border border-zinc-800 text-zinc-400">
                      {t.other[lang]}
                    </span>
                  )}
                </div>
              </div>

              {/* Weapon type */}
              {crime.weaponType && crime.weaponType !== 'none' && crime.weaponType !== 'unknown' && WEAPON_LABELS[crime.weaponType] && (
                <div className="flex items-center gap-3">
                  <span className="text-zinc-400 w-5 flex justify-center text-sm">{WEAPON_LABELS[crime.weaponType].icon}</span>
                  <span className="px-2.5 py-1 text-xs rounded-md border font-medium bg-red-950/30 border-red-900/40 text-red-400">
                    {WEAPON_LABELS[crime.weaponType][lang]}
                  </span>
                </div>
              )}

              {/* Precision indicator */}
              <div className="flex items-center gap-3">
                <span className="text-zinc-400 w-5 flex justify-center">{Icons.target}</span>
                <span className="text-sm text-zinc-400">
                  {t.accuracy[lang]}: <span className="text-zinc-300 ml-1">{tNested('precisionLevels', crime.precision, lang)}</span>
                </span>
              </div>
            </div>

            {/* Body text section */}
            {bodyText && (
              <div className="px-5 py-5">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-xs font-semibold tracking-widest text-zinc-400 uppercase">
                    {t.report[lang]}
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
              <span>{t.openSource[lang]}</span>
              <span className="text-zinc-400 text-xs ml-auto">{sourceDomain}</span>
            </a>
          </div>
        </div>
      </div>

      {/* Mobile: Bottom sheet */}
      <div
        ref={sheetRef}
        className={`md:hidden fixed inset-x-0 bottom-0 z-[1002] max-h-[80vh] mobile-bottom-sheet flex flex-col bg-[#0c0c0c] rounded-t-2xl border-t border-[#1a1a1a] shadow-2xl shadow-black/60 overflow-hidden animate-slide-up-spring ${flashClass}`}
        {...handlers}
      >
        {/* Drag handle */}
        <div className="sheet-drag-area flex justify-center py-3 shrink-0 cursor-grab active:cursor-grabbing">
          <div className="drag-handle w-10 h-1 bg-zinc-600 rounded-full" />
        </div>

        {/* Header */}
        <div className="sheet-drag-area px-4 pb-3 border-b border-[#1a1a1a] flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-zinc-400">{Icons.alert}</span>
            <span className="text-[11px] font-medium tracking-wide text-zinc-300 uppercase no-select">
              {t.report[lang]}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-lg text-zinc-400 touch-feedback active:bg-[#1a1a1a]"
            aria-label={t.close[lang]}
          >
            {Icons.close}
          </button>
        </div>

        {/* Content area - scrollable */}
        <div className="flex-1 overflow-y-auto scroll-touch">
          {/* Title section */}
          <div className="px-4 py-4 border-b border-[#151515]">
            <h2 className="text-base font-semibold text-zinc-100 leading-relaxed">
              {crime.title}
            </h2>
          </div>

          {/* Metadata section */}
          <div className="px-4 py-3 space-y-2.5 border-b border-[#151515] bg-[#0a0a0a]">
            {/* Date */}
            <div className="flex items-center gap-3">
              <span className="text-zinc-400 w-5 flex justify-center">{Icons.calendar}</span>
              <span className="text-sm text-zinc-300">{formatDate(crime.publishedAt)}</span>
            </div>

            {/* Location */}
            {crime.locationText && (
              <div className="flex items-center gap-3">
                <span className="text-zinc-400 w-5 flex justify-center">{Icons.location}</span>
                <span className="text-sm text-zinc-300">{crime.locationText}</span>
              </div>
            )}

            {/* Category badges */}
            <div className="flex items-start gap-3">
              <span className="text-zinc-400 w-5 flex justify-center mt-0.5">{Icons.tag}</span>
              <div className="flex flex-wrap gap-1.5">
                {crime.categories.length > 0 ? (
                  crime.categories.map((cat) => {
                    const info = getCategoryInfo(cat);
                    return (
                      <span
                        key={cat}
                        className="px-2 py-0.5 text-xs rounded-md border font-medium"
                        style={{
                          backgroundColor: `${info.color}10`,
                          borderColor: `${info.color}30`,
                          color: info.color,
                        }}
                      >
                        {getCategoryLabel(cat)}
                      </span>
                    );
                  })
                ) : (
                  <span className="px-2 py-0.5 text-xs rounded-md bg-zinc-900 border border-zinc-800 text-zinc-400">
                    {t.other[lang]}
                  </span>
                )}
              </div>
            </div>

            {/* Weapon type */}
            {crime.weaponType && crime.weaponType !== 'none' && crime.weaponType !== 'unknown' && WEAPON_LABELS[crime.weaponType] && (
              <div className="flex items-center gap-3">
                <span className="text-zinc-400 w-5 flex justify-center text-sm">{WEAPON_LABELS[crime.weaponType].icon}</span>
                <span className="px-2 py-0.5 text-xs rounded-md border font-medium bg-red-950/30 border-red-900/40 text-red-400">
                  {WEAPON_LABELS[crime.weaponType][lang]}
                </span>
              </div>
            )}
          </div>

          {/* Body text section */}
          {bodyText && (
            <div className="px-4 py-4">
              <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap line-clamp-6">
                {bodyText}
              </p>
            </div>
          )}
        </div>

        {/* Footer - Source link */}
        <div className="px-4 py-3 border-t border-[#1a1a1a] bg-[#080808] flex-shrink-0 safe-area-pb">
          <a
            href={crime.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-2.5 text-sm text-zinc-100 bg-[#1a1a1a] rounded-lg touch-feedback active:bg-[#252525] transition-colors"
          >
            {Icons.externalLink}
            <span className="no-select">{t.openSource[lang]}</span>
          </a>
        </div>
      </div>
    </>
  );
}
