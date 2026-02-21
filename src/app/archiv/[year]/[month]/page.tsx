import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MONTH_BY_SLUG, MONTH_SLUGS, ALL_MONTH_SLUGS } from '@/lib/slugs/month-slugs';
import { CRIME_CATEGORIES } from '@/lib/types/crime';
import { fetchArchiveStats, fetchBlaulichtByTimePeriod } from '@/lib/supabase/seo-queries';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { StatsCard } from '@/components/seo/StatsCard';
import { BlaulichtFeed } from '@/components/seo/BlaulichtFeed';

export const revalidate = 86400;
export const dynamicParams = false;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://adlerlicht.de';
const VALID_YEARS = ['2025', '2026'];

export function generateStaticParams() {
  const params: Array<{ year: string; month: string }> = [];
  for (const year of VALID_YEARS) {
    for (const month of ALL_MONTH_SLUGS) {
      params.push({ year, month });
    }
  }
  return params;
}

export async function generateMetadata(
  { params }: { params: Promise<{ year: string; month: string }> },
): Promise<Metadata> {
  const { year, month } = await params;
  const monthEntry = MONTH_BY_SLUG[month];
  if (!VALID_YEARS.includes(year) || !monthEntry) return {};

  const title = `Kriminalstatistik ${monthEntry.label} ${year}`;
  const description = `Polizeimeldungen und Kriminalstatistik fuer ${monthEntry.label} ${year}. Deliktverteilung und aktuelle Meldungen.`;

  return {
    title,
    description,
    openGraph: {
      title: `${title} | Adlerlicht`,
      description,
      url: `${SITE_URL}/archiv/${year}/${month}`,
      type: 'website',
      locale: 'de_DE',
    },
    alternates: { canonical: `${SITE_URL}/archiv/${year}/${month}` },
  };
}

export default async function MonthArchivePage(
  { params }: { params: Promise<{ year: string; month: string }> },
) {
  const { year, month } = await params;
  const monthEntry = MONTH_BY_SLUG[month];
  if (!VALID_YEARS.includes(year) || !monthEntry) notFound();

  const yearNum = parseInt(year, 10);

  const [stats, records] = await Promise.all([
    fetchArchiveStats(yearNum, monthEntry.num),
    fetchBlaulichtByTimePeriod(yearNum, monthEntry.num, 20),
  ]);

  // Sort crime types by count
  const sortedCategories = CRIME_CATEGORIES
    .map((c) => ({ ...c, count: stats.byCategory[c.key] || 0 }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);

  // Previous/next month navigation
  const monthIdx = MONTH_SLUGS.findIndex((m) => m.slug === month);
  const prevMonth = monthIdx > 0
    ? { year, month: MONTH_SLUGS[monthIdx - 1] }
    : parseInt(year) > parseInt(VALID_YEARS[0])
      ? { year: String(parseInt(year) - 1), month: MONTH_SLUGS[11] }
      : null;
  const nextMonth = monthIdx < 11
    ? { year, month: MONTH_SLUGS[monthIdx + 1] }
    : parseInt(year) < parseInt(VALID_YEARS[VALID_YEARS.length - 1])
      ? { year: String(parseInt(year) + 1), month: MONTH_SLUGS[0] }
      : null;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: `Archiv ${year}`, href: `/archiv/${year}` },
          { label: monthEntry.label, href: `/archiv/${year}/${month}` },
        ]}
      />

      <section className="mb-8">
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">
          Kriminalstatistik {monthEntry.label} {year}
        </h1>
        <p className="text-[var(--text-muted)]">
          Monatliche Uebersicht der erfassten Polizeimeldungen
        </p>
      </section>

      {/* Stats */}
      <section className="mb-10">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatsCard
            label="Polizeimeldungen"
            value={stats.total.toLocaleString('de-DE')}
            subtext={`${monthEntry.label} ${year}`}
            accentColor="#ef4444"
          />
          <StatsCard
            label="Deliktarten"
            value={Object.keys(stats.byCategory).length.toLocaleString('de-DE')}
            accentColor="#f59e0b"
          />
        </div>
      </section>

      {/* Crime type distribution */}
      {sortedCategories.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">Deliktverteilung</h2>
          <div className="space-y-2">
            {sortedCategories.map((c) => {
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

      {/* Blaulicht Feed */}
      <BlaulichtFeed
        records={records}
        title={`Polizeimeldungen — ${monthEntry.label} ${year}`}
      />

      {/* Prev/Next navigation */}
      <section className="mb-10">
        <div className="flex items-center justify-between">
          {prevMonth ? (
            <a
              href={`/archiv/${prevMonth.year}/${prevMonth.month.slug}`}
              className="text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            >
              {prevMonth.month.label} {prevMonth.year}
            </a>
          ) : (
            <span />
          )}
          <a
            href={`/archiv/${year}`}
            className="text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          >
            Jahresuebersicht {year}
          </a>
          {nextMonth ? (
            <a
              href={`/archiv/${nextMonth.year}/${nextMonth.month.slug}`}
              className="text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            >
              {nextMonth.month.label} {nextMonth.year}
            </a>
          ) : (
            <span />
          )}
        </div>
      </section>
    </>
  );
}
