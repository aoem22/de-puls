import Link from 'next/link';

interface HeroSectionProps {
  selectedCategoryLabel: string;
  timeframeLabel: string;
  selectedCount: number | null;
  totalCount: number | null;
  topCity: string | null;
  topHotspot: string | null;
}

function formatCount(value: number | null): string {
  if (value == null) return '...';
  return value.toLocaleString('de-DE');
}

export function HeroSection({
  selectedCategoryLabel,
  timeframeLabel,
  selectedCount,
  totalCount,
  topCity,
  topHotspot,
}: HeroSectionProps) {
  return (
    <section className="relative mx-auto w-full max-w-6xl px-4 pt-10 sm:px-8 sm:pt-14">
      <div
        className="dashboard-rise relative overflow-hidden rounded-[2rem] border px-5 py-6 sm:px-8 sm:py-8"
        style={{
          borderColor: 'var(--border-subtle)',
          background: 'linear-gradient(145deg, var(--card) 0%, var(--card-elevated) 100%)',
        }}
      >
        <div
          className="pointer-events-none absolute -top-16 right-8 h-44 w-44 rounded-full opacity-40"
          style={{ background: '#0891b2', filter: 'blur(80px)' }}
        />
        <div
          className="pointer-events-none absolute -bottom-16 left-6 h-52 w-52 rounded-full opacity-30"
          style={{ background: '#f59e0b', filter: 'blur(90px)' }}
        />

        <div className="relative grid gap-8 lg:grid-cols-[1.25fr_0.75fr] lg:items-center">
          <div className="dashboard-rise dashboard-delay-1">
            <p
              className="text-[11px] font-semibold uppercase tracking-[0.24em]"
              style={{ color: 'var(--text-faint)' }}
            >
              Live Safety Control Room
            </p>
            <h1
              className="mt-3 text-[clamp(2.1rem,6vw,4rem)] font-bold leading-[0.95] tracking-tight"
              style={{ color: 'var(--text-primary)' }}
            >
              ADLERLICHT
            </h1>
            <p
              className="mt-3 max-w-2xl text-sm sm:text-base"
              style={{ color: 'var(--text-secondary)' }}
            >
              Interaktive Lageansicht für Gewaltkriminalität in Deutschland.
              Schnell erkennen, wo sich Muster gerade verdichten.
            </p>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <Link
                href="/karte"
                className="rounded-xl px-4 py-2 text-sm font-semibold transition-transform hover:-translate-y-0.5"
                style={{ background: 'var(--accent)', color: '#ffffff' }}
              >
                Inzidenzkarte öffnen
              </Link>
              <Link
                href="/karte?layer=safety"
                className="rounded-xl border px-4 py-2 text-sm font-semibold transition-colors"
                style={{
                  borderColor: 'var(--border-subtle)',
                  color: 'var(--text-secondary)',
                  background: 'var(--card)',
                }}
              >
                Neighborhood Watch
              </Link>
            </div>
          </div>

          <div className="dashboard-rise dashboard-delay-2 grid gap-3">
            <div
              className="rounded-2xl border p-4 sm:p-5"
              style={{
                borderColor: 'var(--border-inner)',
                background: 'rgba(255, 255, 255, 0.42)',
                backdropFilter: 'blur(10px)',
              }}
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em]" style={{ color: 'var(--text-faint)' }}>
                Fokus
              </p>
              <div className="mt-2 flex items-end gap-2">
                <span className="text-4xl font-bold tabular-nums leading-none" style={{ color: 'var(--text-primary)' }}>
                  {formatCount(selectedCount)}
                </span>
                <span className="pb-1 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {selectedCategoryLabel}
                </span>
              </div>
              <p className="mt-2 text-xs" style={{ color: 'var(--text-faint)' }}>
                {timeframeLabel}
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <MiniStat label="Total" value={formatCount(totalCount)} />
              <MiniStat label="Top Stadt" value={topCity ?? '-'} />
              <MiniStat label="Hotspot" value={topHotspot ?? '-'} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

interface MiniStatProps {
  label: string;
  value: string;
}

function MiniStat({ label, value }: MiniStatProps) {
  return (
    <div
      className="rounded-xl border p-3"
      style={{ borderColor: 'var(--border-inner)', background: 'var(--card)' }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--text-faint)' }}>
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
        {value}
      </p>
    </div>
  );
}
