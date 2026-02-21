import Link from 'next/link';
import { ALL_BUNDESLAENDER } from '@/lib/slugs/bundesland-registry';
import { CRIME_SLUG_MAP } from '@/lib/slugs/crime-slugs';
import { CRIME_CATEGORIES } from '@/lib/types/crime';

export function SeoFooter() {
  return (
    <footer className="border-t border-[var(--card-border)] mt-16 pt-8 pb-12">
      <div className="max-w-5xl mx-auto px-4">
        <h3 className="text-sm font-semibold text-[var(--text-tertiary)] mb-4">Bundeslaender</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-8">
          {ALL_BUNDESLAENDER.map((bl) => (
            <Link
              key={bl.code}
              href={`/land/${bl.slug}`}
              className="text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            >
              {bl.name}
            </Link>
          ))}
        </div>

        <h3 className="text-sm font-semibold text-[var(--text-tertiary)] mb-4">Deliktarten</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-8">
          {CRIME_CATEGORIES.map((cat) => {
            const slug = CRIME_SLUG_MAP[cat.key];
            return (
              <Link
                key={cat.key}
                href={`/${slug.slug}`}
                className="text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors flex items-center gap-1.5"
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cat.color }} />
                {cat.label}
              </Link>
            );
          })}
        </div>

        <h3 className="text-sm font-semibold text-[var(--text-tertiary)] mb-4">Archiv</h3>
        <div className="flex flex-wrap gap-3 mb-8">
          <Link
            href="/archiv/2025"
            className="text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            2025
          </Link>
          <Link
            href="/archiv/2026"
            className="text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            2026
          </Link>
        </div>

        <div className="flex items-center justify-between text-xs text-[var(--text-faint)]">
          <Link href="/" className="hover:text-[var(--text-tertiary)] transition-colors">
            Adlerlicht — Deutschlands Sicherheitslicht
          </Link>
          <span>Datenquellen: PKS, Deutschlandatlas, Presseportal</span>
        </div>
      </div>
    </footer>
  );
}
