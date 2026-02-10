interface IndicatorRowProps {
  label: string;
  value: number | null;
  unit?: string;
  maxValue?: number;
}

export function IndicatorRow({ label, value, unit = '', maxValue = 100 }: IndicatorRowProps) {
  if (value === null || value === undefined) {
    return (
      <div className="flex items-center justify-between py-2 border-b border-[var(--card-border)]/50">
        <span className="text-sm text-[var(--text-tertiary)]">{label}</span>
        <span className="text-sm text-[var(--text-faint)]">k.A.</span>
      </div>
    );
  }

  const barWidth = Math.min((Math.abs(value) / maxValue) * 100, 100);

  return (
    <div className="py-2 border-b border-[var(--card-border)]/50">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-[var(--text-tertiary)]">{label}</span>
        <span className="text-sm font-medium text-[var(--text-primary)]">
          {typeof value === 'number' ? value.toLocaleString('de-DE', { maximumFractionDigits: 1 }) : value}
          {unit && <span className="text-[var(--text-muted)] ml-0.5">{unit}</span>}
        </span>
      </div>
      <div className="h-1 bg-[var(--card-elevated)] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-cyan-500/60"
          style={{ width: `${barWidth}%` }}
        />
      </div>
    </div>
  );
}
