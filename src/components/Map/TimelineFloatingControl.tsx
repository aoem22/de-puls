'use client';

import { useEffect, useMemo, useRef, useState, type WheelEvent } from 'react';
import { translations, useTranslation } from '@/lib/i18n';

interface TimelineFloatingControlProps {
  years: string[];
  selectedYear: string;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onYearChange: (year: string) => void;
  accent?: 'amber' | 'red';
  className?: string;
}

export function TimelineFloatingControl({
  years,
  selectedYear,
  isPlaying,
  onTogglePlay,
  onYearChange,
  accent = 'amber',
  className = '',
}: TimelineFloatingControlProps) {
  const { lang } = useTranslation();
  const [showYearBubble, setShowYearBubble] = useState(false);
  const hideBubbleTimeoutRef = useRef<number | null>(null);

  const hasTemporalData = years.length > 1 && selectedYear.length > 0;
  const displayYears = useMemo(() => (years.length > 0 ? years : ['']), [years]);
  const displayYear = selectedYear;

  const activeIndex = useMemo(() => {
    const index = displayYears.indexOf(displayYear);
    if (index >= 0) return index;
    return displayYears.length - 1;
  }, [displayYears, displayYear]);
  const activeYear = displayYears[activeIndex] ?? displayYear;
  const isRedAccent = accent === 'red';
  const thumbPercent = useMemo(() => {
    if (displayYears.length <= 1) return 0;
    return (activeIndex / (displayYears.length - 1)) * 100;
  }, [activeIndex, displayYears.length]);
  const firstYear = displayYears[0] ?? '';
  const lastYear = displayYears[displayYears.length - 1] ?? '';

  const stepTo = (nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= displayYears.length) return;
    const nextYear = displayYears[nextIndex];
    if (nextYear) onYearChange(nextYear);
  };

  const handleYearDotClick = (index: number) => {
    stepTo(index);
    flashYearBubble();
  };

  const flashYearBubble = () => {
    setShowYearBubble(true);
    if (hideBubbleTimeoutRef.current) {
      window.clearTimeout(hideBubbleTimeoutRef.current);
    }
    hideBubbleTimeoutRef.current = window.setTimeout(() => {
      setShowYearBubble(false);
      hideBubbleTimeoutRef.current = null;
    }, 650);
  };

  const handleRailWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!hasTemporalData) return;

    const dominantDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (dominantDelta === 0) return;

    const direction = dominantDelta > 0 ? 1 : -1;
    stepTo(activeIndex + direction);
    flashYearBubble();
  };

  useEffect(() => {
    return () => {
      if (hideBubbleTimeoutRef.current) {
        window.clearTimeout(hideBubbleTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div
      className={`absolute left-1/2 -translate-x-1/2 z-[1000] transition-all duration-200 ease-out safe-area-pb ${hasTemporalData ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-y-6 opacity-0 pointer-events-none'} ${className}`}
      role="group"
      aria-label={translations.timeSeries[lang]}
    >
      <div className="w-[min(90vw,540px)] bg-[#141414]/68 backdrop-blur-sm border border-[#2a2a2a]/70 rounded-xl shadow-xl px-3 py-2">
        <div className="grid grid-cols-[28px_56px_minmax(0,1fr)_56px] items-center gap-2">
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={isPlaying ? (lang === 'de' ? 'Pause' : 'Pause') : (lang === 'de' ? 'Abspielen' : 'Play')}
            className={`w-7 h-7 flex items-center justify-center rounded-md border transition-all duration-200 ${
              isPlaying
                ? (isRedAccent ? 'bg-red-500/20 border-red-500 text-red-300' : 'bg-amber-500/20 border-amber-500 text-amber-300')
                : (isRedAccent ? 'bg-[#0a0a0a]/70 border-[#333] text-zinc-200 hover:border-red-500/60' : 'bg-[#0a0a0a]/70 border-[#333] text-zinc-200 hover:border-amber-500/60')
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
            {firstYear}
          </span>

          <div
            className="relative min-w-0 h-7 flex items-center"
            onMouseEnter={() => setShowYearBubble(true)}
            onMouseLeave={() => setShowYearBubble(false)}
            onWheel={handleRailWheel}
          >
            {displayYears.length > 1 && (
              <div className="pointer-events-none absolute inset-x-[7px] top-1/2 -translate-y-1/2 h-3 z-10 hidden md:block">
                {displayYears.map((year, index) => {
                  const positionPercent = (index / (displayYears.length - 1)) * 100;
                  const isActiveDot = index === activeIndex;

                  return (
                    <button
                      key={year}
                      type="button"
                      onClick={() => handleYearDotClick(index)}
                      className={`pointer-events-auto absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-all duration-150 ${
                        isActiveDot
                          ? (isRedAccent
                            ? 'w-2.5 h-2.5 bg-red-300 border-red-200 shadow-[0_0_0_2px_rgba(10,10,10,0.65)]'
                            : 'w-2.5 h-2.5 bg-amber-300 border-amber-200 shadow-[0_0_0_2px_rgba(10,10,10,0.65)]')
                          : 'w-1.5 h-1.5 bg-zinc-300/85 border-zinc-200/65 hover:w-2 hover:h-2 hover:bg-zinc-200'
                      }`}
                      style={{ left: `${positionPercent}%` }}
                      aria-label={`${lang === 'de' ? 'Zu Jahr wechseln' : 'Jump to year'} ${year}`}
                    />
                  );
                })}
              </div>
            )}

            <div
              className={`pointer-events-none absolute -top-7 z-10 -translate-x-1/2 transition-all duration-150 ${
                showYearBubble || isPlaying ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'
              }`}
              style={{ left: `clamp(7px, ${thumbPercent}%, calc(100% - 7px))` }}
            >
              <span className={`block text-[10px] font-semibold tabular-nums bg-[#0f0f10]/90 rounded px-1 py-0.5 shadow-md ${isRedAccent ? 'text-red-200 border border-red-500/30' : 'text-amber-200 border border-amber-500/30'}`}>
                {activeYear}
              </span>
            </div>

            <input
              type="range"
              min={0}
              max={displayYears.length - 1}
              step={1}
              value={activeIndex}
              onChange={(event) => stepTo(Math.round(Number(event.target.value)))}
              onFocus={() => setShowYearBubble(true)}
              onBlur={() => setShowYearBubble(false)}
              onPointerDown={() => setShowYearBubble(true)}
              onPointerUp={() => setShowYearBubble(false)}
              onPointerCancel={() => setShowYearBubble(false)}
              className={`timeline-slider w-full h-7 ${isRedAccent ? 'timeline-slider-red' : ''}`}
              aria-label={translations.timeSeries[lang]}
            />
          </div>

          <span className="inline-flex items-center justify-center h-7 text-[11px] text-zinc-100 font-semibold tabular-nums bg-black/60 border border-zinc-400/35 rounded-md px-1.5 shadow-sm">
            {lastYear}
          </span>
        </div>
      </div>
    </div>
  );
}
