'use client';

import { useRef, useState, useEffect, useCallback } from 'react';

interface TickerBandProps {
  title: string;
  children: React.ReactNode;
  /** Number of items (used to determine if scrolling is needed) */
  itemCount: number;
  /** Scroll speed in pixels per second (default: 30) */
  speed?: number;
  /** If true, don't auto-scroll (e.g. while loading) */
  paused?: boolean;
}

export function TickerBand({ title, children, itemCount, speed = 30, paused: externalPause }: TickerBandProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const lastTimeRef = useRef(0);
  const rafRef = useRef<number>(0);
  const [hovered, setHovered] = useState(false);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const shouldAnimate = itemCount > 2 && !isMobile;
  const isPaused = hovered || !!externalPause;
  const isPausedRef = useRef(false);
  isPausedRef.current = isPaused;

  const tick = useCallback(
    function tickFrame(now: number) {
      if (!trackRef.current || !innerRef.current) return;

      if (lastTimeRef.current === 0) {
        lastTimeRef.current = now;
        rafRef.current = requestAnimationFrame(tickFrame);
        return;
      }

      const dt = (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;

      if (!isPausedRef.current) {
        const halfWidth = innerRef.current.scrollWidth;
        if (halfWidth > 0) {
          offsetRef.current -= speed * dt;
          if (Math.abs(offsetRef.current) >= halfWidth) {
            offsetRef.current += halfWidth;
          }
          trackRef.current.style.transform = `translate3d(${offsetRef.current}px,0,0)`;
        }
      }

      rafRef.current = requestAnimationFrame(tickFrame);
    },
    [speed]
  );

  // Reset offset when children change (new data loaded)
  useEffect(() => {
    offsetRef.current = 0;
    if (trackRef.current) {
      trackRef.current.style.transform = 'translate3d(0,0,0)';
    }
  }, [itemCount]);

  useEffect(() => {
    if (!shouldAnimate) return;
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
      lastTimeRef.current = 0;
    };
  }, [shouldAnimate, tick]);

  return (
    <section className="py-3">
      <h2 className="text-[11px] font-bold uppercase tracking-widest px-4 sm:px-8 mb-2.5"
        style={{ color: 'var(--text-faint)' }}
      >
        {title}
      </h2>

      {shouldAnimate ? (
        <div
          className="overflow-hidden"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <div ref={trackRef} className="flex w-max will-change-transform">
            <div ref={innerRef} className="flex gap-2.5 shrink-0 pl-4 pr-4 sm:pl-8 sm:pr-8">
              {children}
            </div>
            <div className="flex gap-2.5 shrink-0 pr-4 sm:pr-8" aria-hidden="true">
              {children}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex gap-2.5 px-4 sm:px-8 overflow-x-auto scrollbar-hide scroll-touch">
          {children}
        </div>
      )}
    </section>
  );
}
