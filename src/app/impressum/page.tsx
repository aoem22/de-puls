import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Impressum',
};

export default function ImpressumPage() {
  return (
    <div className="min-h-screen py-16 px-4" style={{ background: 'var(--background)' }}>
      <div className="max-w-2xl mx-auto">
        <Link href="/" className="text-sm mb-8 inline-block" style={{ color: 'var(--accent)' }}>
          &larr; Zurueck
        </Link>
        <h1 className="text-3xl font-bold mb-8" style={{ color: 'var(--text-primary)' }}>
          Impressum
        </h1>
        <div className="prose prose-sm" style={{ color: 'var(--text-secondary)' }}>
          <p>
            Angaben gemaess &sect; 5 TMG
          </p>
          <p>
            De-Puls<br />
            Kontakt: info@de-puls.de
          </p>
          <h2 className="text-lg font-bold mt-6 mb-2" style={{ color: 'var(--text-primary)' }}>Haftungsausschluss</h2>
          <p>
            Alle Angaben auf dieser Seite ohne Gewaehr. De-Puls ist kein offizielles Angebot einer Behoerde.
            Die dargestellten Daten stammen aus oeffentlich zugaenglichen Quellen und werden automatisiert verarbeitet.
          </p>
        </div>
      </div>
    </div>
  );
}
