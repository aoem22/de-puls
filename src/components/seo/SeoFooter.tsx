import { ALL_BUNDESLAENDER } from '@/lib/slugs/bundesland-registry';

export function SeoFooter() {
  return (
    <footer className="border-t border-[var(--card-border)] mt-16 pt-8 pb-12">
      <div className="max-w-5xl mx-auto px-4">
        <h3 className="text-sm font-semibold text-[var(--text-tertiary)] mb-4">Bundeslaender</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-8">
          {ALL_BUNDESLAENDER.map((bl) => (
            <a
              key={bl.code}
              href={`/land/${bl.slug}`}
              className="text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            >
              {bl.name}
            </a>
          ))}
        </div>
        <div className="flex items-center justify-between text-xs text-[var(--text-faint)]">
          <a href="/" className="hover:text-[var(--text-tertiary)] transition-colors">
            De-Puls — Interaktive Kriminalitaetskarte
          </a>
          <span>Datenquellen: PKS, Deutschlandatlas, Presseportal</span>
        </div>
      </div>
    </footer>
  );
}
