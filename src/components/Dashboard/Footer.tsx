import Link from 'next/link';

const NAV_LINKS = [
  { label: 'Inzidenzkarte', href: '/karte' },
  { label: 'Sicherheitskarte', href: '/karte?layer=safety' },
  { label: 'Berlin', href: '/berlin' },
  { label: 'Hamburg', href: '/hamburg' },
  { label: 'Bayern', href: '/land/bayern' },
  { label: 'NRW', href: '/land/nordrhein-westfalen' },
];

const DATA_SOURCES = [
  'Presseportal.de',
  'Polizei Berlin, Bayern, Hamburg, Sachsen, Sachsen-Anhalt',
  'BKA / PKS Kriminalstatistik',
  'Deutschlandatlas (BBSR)',
];

const LEGAL_LINKS = [
  { label: 'Impressum', href: '/impressum' },
  { label: 'Datenschutz', href: '/datenschutz' },
];

export function Footer() {
  return (
    <footer className="mt-8 border-t px-3 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-8 sm:mt-10 sm:px-8 sm:pb-8 sm:pt-10"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--card)' }}
    >
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {/* Brand */}
        <div className="sm:col-span-2 lg:col-span-1">
          <div className="text-base font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
            DE-PULS
          </div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-faint)' }}>
            Deutschlands Sicherheitspuls.
            <br />
            Live. Datenbasiert.
          </p>
        </div>

        {/* Navigation */}
        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-widest mb-3"
            style={{ color: 'var(--text-faint)' }}
          >
            Navigation
          </h3>
          <ul className="space-y-1.5">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="footer-link text-xs">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Data sources */}
        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-widest mb-3"
            style={{ color: 'var(--text-faint)' }}
          >
            Datenquellen
          </h3>
          <ul className="space-y-1.5">
            {DATA_SOURCES.map((src) => (
              <li key={src} className="text-xs" style={{ color: 'var(--text-faint)' }}>
                {src}
              </li>
            ))}
          </ul>
        </div>

        {/* Legal */}
        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-widest mb-3"
            style={{ color: 'var(--text-faint)' }}
          >
            Rechtliches
          </h3>
          <ul className="space-y-1.5">
            {LEGAL_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="footer-link text-xs">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="mx-auto mt-8 flex max-w-5xl flex-col items-center justify-between gap-2 border-t pt-4 text-center text-[11px] sm:flex-row sm:gap-1 sm:text-left"
        style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-faint)' }}
      >
        <span>&copy; 2026 De-Puls &middot; Alle Angaben ohne Gewähr</span>
        <span>Kein offizielles Angebot einer Behörde</span>
      </div>
    </footer>
  );
}
