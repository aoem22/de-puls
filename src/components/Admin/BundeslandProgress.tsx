'use client';

import { getBundeslandLabel } from '@/lib/admin/types';

interface BundeslandProgressProps {
  bundeslandCounts: Record<string, { raw: number; enriched: number }>;
}

export function BundeslandProgress({ bundeslandCounts }: BundeslandProgressProps) {
  const entries = Object.entries(bundeslandCounts)
    .filter(([key]) => key !== 'unknown')
    .sort((a, b) => b[1].raw - a[1].raw);

  const maxRaw = Math.max(...entries.map(([, v]) => v.raw), 1);

  return (
    <div
      className="rounded-2xl border p-4"
      style={{
        borderColor: 'var(--border-subtle)',
        background: 'linear-gradient(160deg, var(--card) 0%, var(--card-elevated) 100%)',
      }}
    >
      <p
        className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em]"
        style={{ color: 'var(--text-faint)' }}
      >
        Enrichment by Bundesland
      </p>

      <div className="space-y-2">
        {entries.map(([bl, counts]) => {
          const pct = counts.raw > 0 ? (counts.enriched / counts.raw) * 100 : 0;
          const barWidth = (counts.raw / maxRaw) * 100;

          return (
            <div key={bl} className="flex items-center gap-3">
              <span
                className="w-[140px] truncate text-xs"
                style={{ color: 'var(--text-secondary)' }}
              >
                {getBundeslandLabel(bl)}
              </span>

              <div className="relative flex-1 h-5">
                {/* Raw bar (background) */}
                <div
                  className="absolute inset-y-0 left-0 rounded-md"
                  style={{
                    width: `${barWidth}%`,
                    background: 'var(--border-subtle)',
                  }}
                />
                {/* Enriched bar (foreground) */}
                <div
                  className="absolute inset-y-0 left-0 rounded-md transition-all duration-500"
                  style={{
                    width: `${barWidth * (pct / 100)}%`,
                    background: 'var(--accent)',
                    opacity: 0.7,
                  }}
                />
              </div>

              <span
                className="w-16 text-right text-[10px] font-mono tabular-nums"
                style={{ color: 'var(--text-muted)' }}
              >
                {counts.enriched}/{counts.raw}
              </span>

              <span
                className="w-10 text-right text-[10px] font-mono tabular-nums"
                style={{ color: pct === 100 ? '#22c55e' : pct > 0 ? '#f59e0b' : 'var(--text-faint)' }}
              >
                {pct.toFixed(0)}%
              </span>
            </div>
          );
        })}

        {entries.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
            No bundesland data available yet.
          </p>
        )}
      </div>
    </div>
  );
}
