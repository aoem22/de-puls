interface StatsCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  accentColor?: string;
}

export function StatsCard({ label, value, subtext, accentColor = '#22d3ee' }: StatsCardProps) {
  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card)]/50 p-4">
      <div className="text-sm text-[var(--text-muted)] mb-1">{label}</div>
      <div className="text-2xl font-bold" style={{ color: accentColor }}>
        {value}
      </div>
      {subtext && <div className="text-xs text-[var(--text-faint)] mt-1">{subtext}</div>}
    </div>
  );
}
