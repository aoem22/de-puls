'use client';

interface PipelineCalendarProps {
  chunksByMonth: Record<string, { raw: number; enriched: number }>;
}

function getMonthRange(): string[] {
  const months: string[] = [];
  const start = new Date(2023, 1); // Feb 2023
  const end = new Date(2026, 1);   // Feb 2026

  const current = new Date(start);
  while (current <= end) {
    const ym = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
    months.push(ym);
    current.setMonth(current.getMonth() + 1);
  }
  return months;
}

function getColor(count: number): string {
  if (count === 0) return 'var(--card-inner)';
  if (count < 50) return 'rgba(8, 145, 178, 0.2)';
  if (count < 200) return 'rgba(8, 145, 178, 0.4)';
  if (count < 500) return 'rgba(8, 145, 178, 0.6)';
  if (count < 1000) return 'rgba(8, 145, 178, 0.8)';
  return 'rgba(8, 145, 178, 1)';
}

const MONTH_LABELS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

export function PipelineCalendar({ chunksByMonth }: PipelineCalendarProps) {
  const months = getMonthRange();

  // Group by year
  const years: Record<string, string[]> = {};
  for (const ym of months) {
    const year = ym.slice(0, 4);
    if (!years[year]) years[year] = [];
    years[year].push(ym);
  }

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
        Pipeline Activity
      </p>

      <div className="space-y-2">
        {Object.entries(years).map(([year, yms]) => (
          <div key={year} className="flex items-center gap-2">
            <span
              className="w-10 text-[10px] font-mono tabular-nums"
              style={{ color: 'var(--text-muted)' }}
            >
              {year}
            </span>
            <div className="flex gap-1">
              {yms.map(ym => {
                const monthIdx = parseInt(ym.slice(5)) - 1;
                const raw = chunksByMonth[ym]?.raw ?? 0;
                return (
                  <div
                    key={ym}
                    className="group relative"
                  >
                    <div
                      className="h-6 w-6 rounded-[4px] transition-transform hover:scale-125"
                      style={{ background: getColor(raw) }}
                      title={`${ym}: ${raw} raw articles`}
                    />
                    <span
                      className="absolute -top-5 left-1/2 -translate-x-1/2 text-[8px] opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ color: 'var(--text-faint)' }}
                    >
                      {MONTH_LABELS[monthIdx]}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-3 flex items-center gap-2">
        <span className="text-[9px]" style={{ color: 'var(--text-faint)' }}>Less</span>
        {[0, 50, 200, 500, 1000].map(n => (
          <div
            key={n}
            className="h-3 w-3 rounded-[2px]"
            style={{ background: getColor(n) }}
          />
        ))}
        <span className="text-[9px]" style={{ color: 'var(--text-faint)' }}>More</span>
      </div>
    </div>
  );
}
