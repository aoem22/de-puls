import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Datenschutz',
};

export default function DatenschutzPage() {
  return (
    <div className="min-h-screen py-16 px-4" style={{ background: 'var(--background)' }}>
      <div className="max-w-2xl mx-auto">
        <Link href="/" className="text-sm mb-8 inline-block" style={{ color: 'var(--accent)' }}>
          &larr; Zurueck
        </Link>
        <h1 className="text-3xl font-bold mb-8" style={{ color: 'var(--text-primary)' }}>
          Datenschutzerklaerung
        </h1>
        <div className="prose prose-sm" style={{ color: 'var(--text-secondary)' }}>
          <h2 className="text-lg font-bold mt-6 mb-2" style={{ color: 'var(--text-primary)' }}>1. Datenerhebung</h2>
          <p>
            Adlerlicht erhebt keine personenbezogenen Daten der Nutzer. Es werden keine Cookies gesetzt und kein Tracking durchgefuehrt.
          </p>
          <h2 className="text-lg font-bold mt-6 mb-2" style={{ color: 'var(--text-primary)' }}>2. Datenquellen</h2>
          <p>
            Die dargestellten Daten stammen aus oeffentlich zugaenglichen Quellen: Presseportal.de,
            Polizei-Landesseiten, BKA/PKS Kriminalstatistik und dem Deutschlandatlas (BBSR).
          </p>
          <h2 className="text-lg font-bold mt-6 mb-2" style={{ color: 'var(--text-primary)' }}>3. Hosting</h2>
          <p>
            Diese Website wird bei Vercel Inc. gehostet. Weitere Informationen finden Sie in der
            Datenschutzerklaerung von Vercel.
          </p>
        </div>
      </div>
    </div>
  );
}
