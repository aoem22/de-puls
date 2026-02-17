interface TickerCardProps {
  label: string;
  count: number;
  color: string;
  active?: boolean;
  onClick?: () => void;
}

export function TickerCard({ label, count, color, active, onClick }: TickerCardProps) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 w-[140px] sm:w-[160px] rounded-xl border p-3.5 text-left transition-all cursor-pointer no-select"
      style={{
        background: 'var(--card)',
        borderColor: active ? color : 'var(--border-subtle)',
        boxShadow: active ? `0 0 0 1px ${color}, 0 4px 12px ${color}20` : undefined,
      }}
    >
      <div className="w-1.5 h-1.5 rounded-full mb-2" style={{ background: color }} />
      <div className="text-[10px] font-semibold uppercase tracking-widest mb-1"
        style={{ color: 'var(--text-faint)' }}
      >
        {label}
      </div>
      <div className="text-xl font-bold tabular-nums leading-none"
        style={{ color: 'var(--text-primary)' }}
      >
        {count.toLocaleString('de-DE')}
      </div>
    </button>
  );
}
