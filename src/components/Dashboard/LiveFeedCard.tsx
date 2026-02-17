import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CrimeRecord, CrimeCategory } from '@/lib/types/crime';

const CATEGORY_BADGE: Record<string, { label: string; color: string }> = {
  knife:  { label: 'MESSER',  color: '#ef4444' },
  murder: { label: 'MORD',    color: '#991b1b' },
  sexual: { label: 'SEXUAL',  color: '#a855f7' },
};

function getRelativeTime(dateStr: string, now: number): string {
  const diff = now - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'gerade eben';
  if (mins < 60) return `vor ${mins} Min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `vor ${hours} Std`;
  const days = Math.floor(hours / 24);
  return `vor ${days} Tag${days > 1 ? 'en' : ''}`;
}

function getPrimaryCategory(categories: CrimeCategory[]): { label: string; color: string } | null {
  for (const cat of ['murder', 'knife', 'sexual'] as const) {
    if (categories.includes(cat)) return CATEGORY_BADGE[cat];
  }
  return null;
}

interface LiveFeedCardProps {
  record: CrimeRecord;
}

export function LiveFeedCard({ record }: LiveFeedCardProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const badge = getPrimaryCategory(record.categories);
  const isLive = now - new Date(record.publishedAt).getTime() < 3_600_000;
  const timeStr = getRelativeTime(record.publishedAt, now);
  const displayTitle = record.cleanTitle || record.title;

  return (
    <Link
      href={`/karte?id=${record.id}`}
      className="block rounded-xl border p-4 transition-colors"
      style={{ background: 'var(--card)', borderColor: 'var(--border-subtle)' }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          {isLive && (
            <span className="flex items-center gap-1.5 text-[10px] font-bold text-red-500">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
              </span>
              LIVE
            </span>
          )}
          <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-faint)' }}>
            {timeStr}
          </span>
        </div>
        {badge && (
          <span
            className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
            style={{ background: `${badge.color}15`, color: badge.color }}
          >
            {badge.label}
          </span>
        )}
      </div>

      <h3 className="text-sm font-semibold leading-snug mb-1 line-clamp-2"
        style={{ color: 'var(--text-primary)' }}
      >
        {displayTitle}
      </h3>

      {record.locationText && (
        <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
          {record.locationText}
        </p>
      )}
    </Link>
  );
}
