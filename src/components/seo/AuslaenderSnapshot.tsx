import type { AuslaenderRow } from '@/lib/supabase/types';

interface AuslaenderSnapshotProps {
  record: AuslaenderRow | null;
}

const REGION_LABELS: Array<{ key: string; label: string }> = [
  { key: 'europa', label: 'Europa' },
  { key: 'asien', label: 'Asien' },
  { key: 'afrika', label: 'Afrika' },
  { key: 'amerika', label: 'Amerika' },
  { key: 'ozeanien', label: 'Ozeanien' },
];

export function AuslaenderSnapshot({ record }: AuslaenderSnapshotProps) {
  if (!record) {
    return (
      <section className="mb-10">
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">Auslaender</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Keine Auslaenderdaten fuer diesen Kreis verfuegbar.
        </p>
      </section>
    );
  }

  const total = record.regions.total?.total ?? null;
  const rows = REGION_LABELS
    .map((region) => {
      const value = record.regions[region.key]?.total ?? null;
      if (value == null || value <= 0) return null;
      const percentage = total && total > 0 ? (value / total) * 100 : null;
      return {
        ...region,
        value,
        percentage,
      };
    })
    .filter((row): row is { key: string; label: string; value: number; percentage: number | null } => row !== null)
    .sort((a, b) => b.value - a.value);

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-xl font-bold text-[var(--text-primary)]">Auslaender</h2>
        <span className="text-xs text-[var(--text-faint)]">Jahr {record.year}</span>
      </div>

      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)]/60 p-4">
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] p-3">
            <div className="text-xs text-[var(--text-muted)] mb-1">Gesamt</div>
            <div className="text-2xl font-bold text-cyan-500">
              {total != null ? total.toLocaleString('de-DE') : 'k.A.'}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] p-3">
            <div className="text-xs text-[var(--text-muted)] mb-1">Top Region</div>
            <div className="text-lg font-semibold text-[var(--text-primary)]">
              {rows[0]?.label ?? 'k.A.'}
            </div>
            {rows[0]?.percentage != null && (
              <div className="text-xs text-[var(--text-faint)] mt-1">
                {rows[0].percentage.toLocaleString('de-DE', { maximumFractionDigits: 1 })}%
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2.5">
          {rows.length > 0 ? rows.map((row) => {
            const width = Math.max(2, Math.min(row.percentage ?? 0, 100));
            return (
              <div key={row.key}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-[var(--text-tertiary)]">{row.label}</span>
                  <span className="text-[var(--text-secondary)]">
                    {row.value.toLocaleString('de-DE')}
                    {row.percentage != null && (
                      <span className="text-[var(--text-faint)]"> ({row.percentage.toLocaleString('de-DE', { maximumFractionDigits: 1 })}%)</span>
                    )}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[var(--card-elevated)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-cyan-500/80"
                    style={{ width: `${width}%` }}
                  />
                </div>
              </div>
            );
          }) : (
            <p className="text-sm text-[var(--text-muted)]">
              Keine regionalen Auslaenderwerte verfuegbar.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
