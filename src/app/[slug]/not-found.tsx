import Link from 'next/link';

export default function CityNotFound() {
  return (
    <div className="text-center py-20">
      <h1 className="text-4xl font-bold text-[var(--text-primary)] mb-4">Seite nicht gefunden</h1>
      <p className="text-[var(--text-muted)] mb-8 max-w-md mx-auto">
        Der angeforderte Kreis oder die Stadt konnte nicht gefunden werden.
      </p>
      <div className="flex items-center justify-center gap-4">
        <Link
          href="/karte"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors text-sm"
        >
          Zur interaktiven Karte
        </Link>
      </div>
    </div>
  );
}
