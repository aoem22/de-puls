import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BUNDESLAND_BY_SLUG, ALL_BUNDESLAND_SLUGS } from '@/lib/slugs/bundesland-registry';
import { getKreiseByBundesland } from '@/lib/slugs/registry';
import { CRIME_CATEGORIES } from '@/lib/types/crime';
import { CRIME_SLUG_MAP } from '@/lib/slugs/crime-slugs';
import { fetchCityRanking } from '@/lib/supabase/seo-queries';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';

export const revalidate = 86400;
export const dynamicParams = false;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://adlerlicht.de';

export function generateStaticParams() {
  return ALL_BUNDESLAND_SLUGS.map((bundesland) => ({ bundesland }));
}

export async function generateMetadata(
  { params }: { params: Promise<{ bundesland: string }> },
): Promise<Metadata> {
  const { bundesland } = await params;
  const bl = BUNDESLAND_BY_SLUG[bundesland];
  if (!bl) return {};

  const title = `Kriminalitaet in ${bl.name}`;
  const description = `Kriminalstatistik und Polizeimeldungen fuer alle Kreise in ${bl.name}. Uebersicht, Ranking und aktuelle Daten.`;

  return {
    title,
    description,
    openGraph: {
      title: `${title} | Adlerlicht`,
      description,
      url: `${SITE_URL}/land/${bundesland}`,
      type: 'website',
      locale: 'de_DE',
    },
    alternates: {
      canonical: `${SITE_URL}/land/${bundesland}`,
    },
  };
}

export default async function BundeslandPage(
  { params }: { params: Promise<{ bundesland: string }> },
) {
  const { bundesland } = await params;
  const bl = BUNDESLAND_BY_SLUG[bundesland];
  if (!bl) notFound();

  const kreise = getKreiseByBundesland(bl.code);

  // Fetch ranking to show crime rates per Kreis
  const ranking = await fetchCityRanking();
  const rankingByAgs = new Map(ranking.map((r) => [r.ags, r]));

  // Enrich kreise with ranking data and sort by crime rate
  const kreiseWithStats = kreise
    .map((k) => ({
      ...k,
      stats: rankingByAgs.get(k.ags) ?? null,
    }))
    .sort((a, b) => {
      if (a.stats && b.stats) return b.stats.hz - a.stats.hz;
      if (a.stats) return -1;
      if (b.stats) return 1;
      return a.name.localeCompare(b.name, 'de');
    });

  return (
    <>
      <Breadcrumbs
        items={[
          { label: bl.name, href: `/land/${bundesland}` },
        ]}
      />

      <section className="mb-8">
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">
          Kriminalitaet in {bl.name}
        </h1>
        <p className="text-[var(--text-muted)]">
          {kreise.length} Kreise und kreisfreie Staedte
        </p>
      </section>

      {/* Crime type quick links */}
      <section className="mb-10">
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">Deliktarten</h2>
        <div className="flex flex-wrap gap-2">
          {CRIME_CATEGORIES.map((cat) => {
            const crimeSlug = CRIME_SLUG_MAP[cat.key];
            return (
              <a
                key={cat.key}
                href={`/land/${bundesland}/${crimeSlug.slug}`}
                className="text-sm px-3 py-1.5 rounded-lg border border-[var(--card-border)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--text-faint)] transition-colors flex items-center gap-1.5"
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                {cat.label}
              </a>
            );
          })}
        </div>
      </section>

      {/* Kreise grid */}
      <section className="mb-10">
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">
          Alle Kreise in {bl.name}
        </h2>
        <div className="grid gap-2">
          {kreiseWithStats.map((k) => (
            <Link
              key={k.ags}
              href={`/${k.slug}`}
              className="flex items-center justify-between rounded-lg border border-[var(--card-border)] bg-[var(--card)]/50 px-4 py-3 hover:border-[var(--text-faint)] transition-colors group"
            >
              <div>
                <span className="text-sm font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">
                  {k.name}
                </span>
                <span className="text-xs text-[var(--text-faint)] ml-2">
                  {k.type === 'stadt' ? 'Stadt' : 'Kreis'}
                </span>
              </div>
              {k.stats && (
                <div className="text-right shrink-0 ml-4">
                  <div className="text-sm font-medium text-[var(--text-secondary)]">
                    {k.stats.hz.toLocaleString('de-DE', { maximumFractionDigits: 0 })} HZ
                  </div>
                  <div className="text-xs text-[var(--text-faint)]">
                    {k.stats.cases.toLocaleString('de-DE')} Faelle
                  </div>
                </div>
              )}
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
