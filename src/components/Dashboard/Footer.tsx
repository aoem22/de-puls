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
    <footer className="mt-10 border-t pt-10 pb-8 px-4 sm:px-8"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--card)' }}
    >
      <div className="max-w-5xl mx-auto grid grid-cols-2 lg:grid-cols-4 gap-8">
        {/* Brand */}
        <div className="col-span-2 lg:col-span-1">
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
      <div className="max-w-5xl mx-auto mt-8 pt-4 border-t flex flex-col sm:flex-row items-center justify-between gap-1 text-[11px]"
        style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-faint)' }}
      >
        <span>&copy; 2026 De-Puls &middot; Alle Angaben ohne Gewähr</span>
        <span>Kein offizielles Angebot einer Behörde</span>
      </div>
    </footer>
  );
}
