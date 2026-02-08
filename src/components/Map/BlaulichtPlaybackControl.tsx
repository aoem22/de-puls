'use client';

import { useMemo, useCallback } from 'react';
import { useTranslation } from '@/lib/i18n';

type PresetKey = 'all' | 'today' | 'yesterday' | 'week';

interface BlaulichtPlaybackControlProps {
  totalEvents: number;
  currentIndex: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onIndexChange: (index: number) => void;
  currentTimestamp?: string;
  dateFilterFrom: string | null;
  dateFilterTo: string | null;
  onDateFilterChange: (from: string | null, to: string | null) => void;
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

function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function computePresetRange(key: PresetKey): { from: string | null; to: string | null } {
  if (key === 'all') return { from: null, to: null };
  const today = new Date();
  const todayStr = toLocalDateString(today);
  if (key === 'today') return { from: todayStr, to: todayStr };
  if (key === 'yesterday') {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = toLocalDateString(yesterday);
    return { from: yStr, to: yStr };
  }
  // week
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 6);
  return { from: toLocalDateString(weekAgo), to: todayStr };
}

const PRESETS: { key: PresetKey; labelDe: string; labelEn: string }[] = [
  { key: 'all', labelDe: 'Alle', labelEn: 'All' },
  { key: 'today', labelDe: 'Heute', labelEn: 'Today' },
  { key: 'yesterday', labelDe: 'Gestern', labelEn: 'Yesterday' },
  { key: 'week', labelDe: 'Woche', labelEn: 'Week' },
];

export function BlaulichtPlaybackControl({
  totalEvents,
  currentIndex,
  isPlaying,
  onTogglePlay,
  onIndexChange,
  currentTimestamp,
  dateFilterFrom,
  dateFilterTo,
  onDateFilterChange,
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

  const activePreset = useMemo<PresetKey | null>(() => {
    for (const preset of PRESETS) {
      const range = computePresetRange(preset.key);
      if (range.from === dateFilterFrom && range.to === dateFilterTo) return preset.key;
    }
    return null;
  }, [dateFilterFrom, dateFilterTo]);

  const handlePresetClick = useCallback((key: PresetKey) => {
    const range = computePresetRange(key);
    onDateFilterChange(range.from, range.to);
  }, [onDateFilterChange]);

  return (
    <div
      className={`absolute left-1/2 -translate-x-1/2 z-[1000] transition-all duration-200 ease-out ${hasData ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-y-6 opacity-0 pointer-events-none'} ${className}`}
      role="group"
      aria-label={lang === 'de' ? 'Blaulicht-Zeitachse' : 'Blaulicht timeline'}
    >
      <div className="w-[min(90vw,540px)] bg-[#141414]/68 backdrop-blur-sm border border-[#2a2a2a]/70 rounded-xl shadow-xl px-3 py-2">
        {/* Row 1: Playback controls */}
        <div className="grid grid-cols-[28px_56px_minmax(0,1fr)] md:grid-cols-[28px_56px_minmax(0,1fr)_164px] items-center gap-2">
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={isPlaying ? (lang === 'de' ? 'Pause' : 'Pause') : (lang === 'de' ? 'Abspielen' : 'Play')}
            className={`w-7 h-7 flex items-center justify-center rounded-md border transition-all duration-200 ${
              isPlaying
                ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                : 'bg-[#0a0a0a]/70 border-[#333] text-zinc-200 hover:border-amber-500/60'
            }`}
          >
            <span className="relative block w-3 h-3">
              <svg
                className={`absolute inset-0 w-3 h-3 transition-opacity duration-200 ${isPlaying ? 'opacity-0' : 'opacity-100'}`}
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
              <svg
                className={`absolute inset-0 w-3 h-3 transition-opacity duration-200 ${isPlaying ? 'opacity-100' : 'opacity-0'}`}
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            </span>
          </button>

          <span className="inline-flex items-center justify-center h-7 text-[11px] text-zinc-100 font-semibold tabular-nums bg-black/60 border border-zinc-400/35 rounded-md px-1.5 shadow-sm">
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
              className="timeline-slider blaulicht-slider w-full h-7"
              aria-label={lang === 'de' ? 'Blaulicht-Zeitregler' : 'Blaulicht timeline slider'}
            />
          </div>

          <span className="col-span-3 md:col-span-1 inline-flex items-center justify-center h-7 whitespace-nowrap text-[10px] text-zinc-100 font-semibold tabular-nums bg-black/60 border border-zinc-400/35 rounded-md px-1.5 shadow-sm">
            {currentLabel}
          </span>
        </div>

        {/* Row 2: Date filter */}
        <div className="border-t border-[#2a2a2a]/70 mt-2 pt-1.5 flex items-center gap-1.5 flex-wrap">
          {/* Preset pills */}
          {PRESETS.map((preset) => {
            const isActive = activePreset === preset.key;
            return (
              <button
                key={preset.key}
                type="button"
                onClick={() => handlePresetClick(preset.key)}
                className={`date-filter-pill text-[10px] px-2 py-0.5 rounded-md border transition-colors duration-150 ${
                  isActive
                    ? 'bg-blue-500/25 border-blue-500 text-blue-300'
                    : 'bg-[#0a0a0a]/70 border-[#333] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
                }`}
              >
                {lang === 'de' ? preset.labelDe : preset.labelEn}
              </button>
            );
          })}

          {/* Spacer to push date inputs right */}
          <div className="flex-1" />

          {/* Date range inputs */}
          <input
            type="date"
            value={dateFilterFrom ?? ''}
            onChange={(e) => onDateFilterChange(e.target.value || null, dateFilterTo)}
            className="date-filter-input w-[100px] h-5 text-[10px] text-zinc-200 bg-[#0a0a0a]/70 border border-[#333] rounded-md px-1 [color-scheme:dark] focus:border-blue-500/60 focus:outline-none"
            aria-label={lang === 'de' ? 'Datum von' : 'Date from'}
          />
          <span className="text-[10px] text-zinc-500">–</span>
          <input
            type="date"
            value={dateFilterTo ?? ''}
            onChange={(e) => onDateFilterChange(dateFilterFrom, e.target.value || null)}
            className="date-filter-input w-[100px] h-5 text-[10px] text-zinc-200 bg-[#0a0a0a]/70 border border-[#333] rounded-md px-1 [color-scheme:dark] focus:border-blue-500/60 focus:outline-none"
            aria-label={lang === 'de' ? 'Datum bis' : 'Date to'}
          />
        </div>
      </div>
    </div>
  );
}
