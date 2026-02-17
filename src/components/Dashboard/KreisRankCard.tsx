interface KreisRankCardProps {
  rank: number;
  name: string;
  hz: number;
}

export function KreisRankCard({ rank, name, hz }: KreisRankCardProps) {
  return (
    <div className="shrink-0 w-[140px] sm:w-[160px] rounded-xl border p-3.5 no-select"
      style={{ background: 'var(--card)', borderColor: 'var(--border-subtle)' }}
    >
      <div className="text-[10px] font-semibold tabular-nums mb-1" style={{ color: 'var(--text-faint)' }}>
        #{rank}
      </div>
      <div className="text-xs font-bold uppercase tracking-wide truncate mb-2"
        style={{ color: 'var(--text-primary)' }}
      >
        {name}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-lg font-bold tabular-nums leading-none"
          style={{ color: 'var(--text-primary)' }}
        >
          {hz.toLocaleString('de-DE', { maximumFractionDigits: 0 })}
        </span>
        <span className="text-[10px] font-medium" style={{ color: 'var(--text-faint)' }}>
          HZ
        </span>
      </div>
    </div>
  );
}
