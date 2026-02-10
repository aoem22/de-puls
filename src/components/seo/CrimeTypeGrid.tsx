import { CRIME_CATEGORIES, type CrimeCategory } from '@/lib/types/crime';
import { CRIME_SLUG_MAP } from '@/lib/slugs/crime-slugs';

interface CrimeTypeGridProps {
  citySlug: string;
  counts?: Partial<Record<CrimeCategory, number>>;
}

export function CrimeTypeGrid({ citySlug, counts }: CrimeTypeGridProps) {
  return (
    <section className="mb-10">
      <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">Delikte</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {CRIME_CATEGORIES.map((cat) => {
          const slugEntry = CRIME_SLUG_MAP[cat.key];
          const count = counts?.[cat.key] ?? 0;
          return (
            <a
              key={cat.key}
              href={`/${citySlug}/${slugEntry.slug}`}
              className="rounded-lg border border-[var(--card-border)] bg-[var(--card)]/50 p-3 hover:border-[var(--text-faint)] transition-colors group"
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: cat.color }}
                />
                <span className="text-sm font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors truncate">
                  {cat.label}
                </span>
              </div>
              <div className="text-xs text-[var(--text-faint)]">
                {count > 0 ? `${count} Meldungen` : 'Keine Meldungen'}
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}
