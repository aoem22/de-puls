import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MONTH_SLUGS } from '@/lib/slugs/month-slugs';
import { CRIME_CATEGORIES, type CrimeCategory } from '@/lib/types/crime';
import { fetchArchiveStats } from '@/lib/supabase/seo-queries';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { StatsCard } from '@/components/seo/StatsCard';

export const revalidate = 86400;
export const dynamicParams = false;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://adlerlicht.de';
const VALID_YEARS = ['2025', '2026'];

export function generateStaticParams() {
  return VALID_YEARS.map((year) => ({ year }));
}

export async function generateMetadata(
  { params }: { params: Promise<{ year: string }> },
): Promise<Metadata> {
  const { year } = await params;
  if (!VALID_YEARS.includes(year)) return {};

  const title = `Kriminalstatistik ${year}`;
  const description = `Kriminalstatistik und Polizeimeldungen fuer das Jahr ${year}. Monatliche Uebersicht, Deliktarten und Trends.`;

  return {
    title,
    description,
    openGraph: {
      title: `${title} | Adlerlicht`,
      description,
      url: `${SITE_URL}/archiv/${year}`,
      type: 'website',
      locale: 'de_DE',
    },
    alternates: { canonical: `${SITE_URL}/archiv/${year}` },
  };
}

export default async function YearArchivePage(
  { params }: { params: Promise<{ year: string }> },
) {
  const { year } = await params;
  if (!VALID_YEARS.includes(year)) notFound();

  const yearNum = parseInt(year, 10);

  // Fetch stats for each month in parallel
  const monthStatsPromises = MONTH_SLUGS.map((m) =>
    fetchArchiveStats(yearNum, m.num).then((stats) => ({ ...m, stats })),
  );
  const monthStats = await Promise.all(monthStatsPromises);

  // Compute yearly aggregate from monthly results (avoids 13th query)
  let yearlyTotal = 0;
  const yearlyByCategory: Partial<Record<CrimeCategory, number>> = {};
  for (const m of monthStats) {
    yearlyTotal += m.stats.total;
    for (const [cat, count] of Object.entries(m.stats.byCategory)) {
      const key = cat as CrimeCategory;
      yearlyByCategory[key] = (yearlyByCategory[key] || 0) + (count ?? 0);
    }
  }

  // Top crime types
  const sortedCategories = CRIME_CATEGORIES
    .map((c) => ({ ...c, count: yearlyByCategory[c.key] || 0 }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);

  return (
    <>
      <Breadcrumbs
        items={[
          { label: `Archiv ${year}`, href: `/archiv/${year}` },
        ]}
      />

      <section className="mb-8">
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">
          Kriminalstatistik {year}
        </h1>
        <p className="text-[var(--text-muted)]">
          Jaehrliche Uebersicht der erfassten Polizeimeldungen
        </p>
      </section>

      {/* Yearly stats */}
      <section className="mb-10">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatsCard
            label="Polizeimeldungen gesamt"
            value={yearlyTotal.toLocaleString('de-DE')}
            accentColor="#ef4444"
          />
          <StatsCard
            label="Deliktarten erfasst"
            value={Object.keys(yearlyByCategory).length.toLocaleString('de-DE')}
            accentColor="#f59e0b"
          />
          <StatsCard
            label="Monate mit Daten"
            value={monthStats.filter((m) => m.stats.total > 0).length.toLocaleString('de-DE')}
            accentColor="#22d3ee"
          />
        </div>
      </section>

      {/* Month-by-month breakdown */}
      <section className="mb-10">
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">Monatsuebersicht</h2>
        <div className="grid gap-2">
          {monthStats.map((m) => (
            <a
              key={m.slug}
              href={m.stats.total > 0 ? `/archiv/${year}/${m.slug}` : undefined}
              className={`flex items-center justify-between rounded-lg border border-[var(--card-border)] bg-[var(--card)]/50 px-4 py-3 ${
                m.stats.total > 0
                  ? 'hover:border-[var(--text-faint)] transition-colors cursor-pointer'
                  : 'opacity-50 cursor-default'
              }`}
            >
              <span className="text-sm font-medium text-[var(--text-secondary)]">
                {m.label} {year}
              </span>
              <span className="text-sm text-[var(--text-faint)]">
                {m.stats.total > 0
                  ? `${m.stats.total.toLocaleString('de-DE')} Meldungen`
                  : 'Keine Daten'}
              </span>
            </a>
          ))}
        </div>
      </section>

      {/* Top crime types */}
      {sortedCategories.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">Haeufigste Deliktarten {year}</h2>
          <div className="space-y-2">
            {sortedCategories.slice(0, 10).map((c) => {
              const maxCount = sortedCategories[0].count;
              const width = maxCount > 0 ? (c.count / maxCount) * 100 : 0;
              return (
                <div key={c.key}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-[var(--text-tertiary)] flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                      {c.label}
                    </span>
                    <span className="text-sm font-medium text-[var(--text-primary)]">
                      {c.count.toLocaleString('de-DE')}
                    </span>
                  </div>
                  <div className="h-2 bg-[var(--card-elevated)] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${width}%`, backgroundColor: c.color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Year navigation */}
      <section className="mb-10">
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">Weitere Jahre</h2>
        <div className="flex flex-wrap gap-2">
          {VALID_YEARS.filter((y) => y !== year).map((y) => (
            <a
              key={y}
              href={`/archiv/${y}`}
              className="text-sm px-3 py-1.5 rounded-lg border border-[var(--card-border)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--text-faint)] transition-colors"
            >
              {y}
            </a>
          ))}
        </div>
      </section>
    </>
  );
}
