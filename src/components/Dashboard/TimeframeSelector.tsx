export type TimeframeValue = 7 | 30 | 90 | 365 | null;

const TIMEFRAMES: Array<{ label: string; value: TimeframeValue }> = [
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
  { label: '1J', value: 365 },
  { label: 'Gesamt', value: null },
];

interface TimeframeSelectorProps {
  value: TimeframeValue;
  onChange: (v: TimeframeValue) => void;
  className?: string;
}

export function TimeframeSelector({ value, onChange, className }: TimeframeSelectorProps) {
  return (
    <div
      className={`inline-flex flex-wrap items-center gap-1.5 rounded-xl border p-1 ${className ?? ''}`}
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--card)' }}
    >
      {TIMEFRAMES.map((tf) => {
        const active = value === tf.value;
        return (
          <button
            key={tf.label}
            onClick={() => onChange(tf.value)}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-all no-select"
            style={active
              ? {
                  background: 'linear-gradient(140deg, #0891b2 0%, #0ea5e9 100%)',
                  color: '#fff',
                  boxShadow: '0 6px 16px rgba(8, 145, 178, 0.35)',
                }
              : { color: 'var(--text-muted)' }
            }
          >
            {tf.label}
          </button>
        );
      })}
    </div>
  );
}
