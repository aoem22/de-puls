'use client';

import { useMemo } from 'react';
import { useTranslation } from '@/lib/i18n';

interface BlaulichtPlaybackControlProps {
  totalEvents: number;
  currentIndex: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onIndexChange: (index: number) => void;
  currentTimestamp?: string;
  className?: string;
}

function formatTimelineDate(value: string | undefined, locale: string): string {
  if (!value) return '--';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '--';

  if (locale === 'de-DE') {
    const datePart = new Intl.DateTimeFormat('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(parsed);
    const timePart = new Intl.DateTimeFormat('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(parsed);
    return `${datePart}, ${timePart} Uhr`;
  }

  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

export function BlaulichtPlaybackControl({
  totalEvents,
  currentIndex,
  isPlaying,
  onTogglePlay,
  onIndexChange,
  currentTimestamp,
  className = '',
}: BlaulichtPlaybackControlProps) {
  const { lang } = useTranslation();
  const hasData = totalEvents > 0;
  const safeIndex = useMemo(() => {
    if (!hasData) return -1;
    if (currentIndex < 0) return 0;
    if (currentIndex >= totalEvents) return totalEvents - 1;
    return currentIndex;
  }, [currentIndex, hasData, totalEvents]);

  const locale = lang === 'de' ? 'de-DE' : 'en-US';
  const currentLabel = formatTimelineDate(currentTimestamp, locale);
  const progressLabel = hasData ? `${safeIndex + 1}/${totalEvents}` : '0/0';

  return (
    <div
      className={`absolute left-1/2 -translate-x-1/2 z-[1000] transition-all duration-200 ease-out ${hasData ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-y-6 opacity-0 pointer-events-none'} ${className}`}
      role="group"
      aria-label={lang === 'de' ? 'Blaulicht-Zeitachse' : 'Blaulicht timeline'}
    >
      <div className="w-[min(96vw,720px)] bg-[#121826]/82 backdrop-blur-md border border-blue-400/20 rounded-xl shadow-xl px-3 py-2">
        <div className="grid grid-cols-[32px_60px_minmax(0,1fr)_164px] items-center gap-2">
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={isPlaying ? (lang === 'de' ? 'Pause' : 'Pause') : (lang === 'de' ? 'Abspielen' : 'Play')}
            className={`w-8 h-8 flex items-center justify-center rounded-md border transition-colors ${
              isPlaying
                ? 'bg-blue-500/25 border-blue-400 text-blue-200'
                : 'bg-[#050912]/80 border-blue-500/35 text-zinc-100 hover:border-blue-300'
            }`}
          >
            {isPlaying ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <span className="inline-flex items-center justify-center h-7 text-[11px] text-blue-100 font-semibold tabular-nums bg-black/55 border border-blue-300/25 rounded-md px-1">
            {progressLabel}
          </span>

          <div className="min-w-0 h-7 flex items-center relative">
            <input
              type="range"
              min={0}
              max={Math.max(totalEvents - 1, 0)}
              step={1}
              value={Math.max(safeIndex, 0)}
              onChange={(event) => onIndexChange(Math.round(Number(event.target.value)))}
              className="w-full h-7 blaulicht-slider"
              aria-label={lang === 'de' ? 'Blaulicht-Zeitregler' : 'Blaulicht timeline slider'}
            />
          </div>

          <span className="inline-flex items-center justify-center h-7 whitespace-nowrap text-[10px] text-blue-100 font-semibold tabular-nums bg-black/40 border border-blue-200/20 rounded-md px-1.5">
            {currentLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
