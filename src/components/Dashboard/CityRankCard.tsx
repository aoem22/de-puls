interface CityRankCardProps {
  rank: number;
  city: string;
  count: number;
}

export function CityRankCard({ rank, city, count }: CityRankCardProps) {
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
        {city}
      </div>
      <div className="text-xl font-bold tabular-nums leading-none"
        style={{ color: 'var(--text-primary)' }}
      >
        {count.toLocaleString('de-DE')}
      </div>
    </div>
  );
}
