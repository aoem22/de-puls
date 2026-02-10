import { CRIME_CATEGORIES } from '@/lib/types/crime';

interface CrimeMetric {
  cases: number;
  hz: number;
  aq: number;
}

interface KriminalitaetSnapshotProps {
  crimes?: Record<string, CrimeMetric>;
}

export function KriminalitaetSnapshot({ crimes }: KriminalitaetSnapshotProps) {
  if (!crimes || Object.keys(crimes).length === 0) {
    return (
      <section className="mb-10">
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">Kriminalitaet (PKS)</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Keine PKS-Daten fuer diesen Kreis verfuegbar.
        </p>
      </section>
    );
  }

  const rows = Object.entries(crimes)
    .map(([key, values]) => {
      const label = CRIME_CATEGORIES.find((cat) => cat.key === key)?.label ?? key;
      const color = CRIME_CATEGORIES.find((cat) => cat.key === key)?.color ?? '#94a3b8';
      return {
        key,
        label,
        color,
        ...values,
      };
    })
    .sort((a, b) => b.cases - a.cases);

  const maxCases = Math.max(...rows.map((row) => row.cases), 1);

  return (
    <section className="mb-10">
      <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">Kriminalitaet (PKS)</h2>

      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)]/60 p-4">
        <p className="text-xs text-[var(--text-faint)] mb-3">
          Top Deliktgruppen nach Fallzahl
        </p>

        <div className="space-y-2.5">
          {rows.slice(0, 8).map((row) => {
            const width = Math.max(3, Math.min((row.cases / maxCases) * 100, 100));
            return (
              <div key={row.key}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-[var(--text-tertiary)]">{row.label}</span>
                  <span className="text-[var(--text-secondary)]">
                    {row.cases.toLocaleString('de-DE')} Faelle
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[var(--card-elevated)] overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${width}%`, backgroundColor: row.color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
