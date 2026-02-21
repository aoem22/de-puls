import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BUNDESLAND_BY_SLUG, ALL_BUNDESLAND_SLUGS, ALL_BUNDESLAENDER } from '@/lib/slugs/bundesland-registry';
import { SLUG_TO_CRIME, ALL_CRIME_SLUGS, CRIME_SLUG_MAP } from '@/lib/slugs/crime-slugs';
import { KREIS_BY_AGS, getKreiseByBundesland } from '@/lib/slugs/registry';
import { CRIME_CATEGORIES, type CrimeCategory } from '@/lib/types/crime';
import {
  fetchCityRankingByBundesland,
  fetchBlaulichtByBundeslandAndCategory,
  type CityRankingEntry,
} from '@/lib/supabase/seo-queries';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { StatsCard } from '@/components/seo/StatsCard';
import { BlaulichtFeed } from '@/components/seo/BlaulichtFeed';

export const revalidate = 86400;
export const dynamicParams = false;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://adlerlicht.de';

// ---------------------------------------------------------------------------
// Static params: 16 states x 14 crime types = 224 pages
// ---------------------------------------------------------------------------

export function generateStaticParams() {
  const params: Array<{ bundesland: string; crimeType: string }> = [];
  for (const bl of ALL_BUNDESLAND_SLUGS) {
    for (const crime of ALL_CRIME_SLUGS) {
      params.push({ bundesland: bl, crimeType: crime });
    }
  }
  return params;
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export async function generateMetadata(
  { params }: { params: Promise<{ bundesland: string; crimeType: string }> },
): Promise<Metadata> {
  const { bundesland, crimeType } = await params;
  const bl = BUNDESLAND_BY_SLUG[bundesland];
  const crime = SLUG_TO_CRIME[crimeType];
  if (!bl || !crime) return {};

  const title = `${crime.label} in ${bl.name}`;
  const description = `${crime.label} in ${bl.name}: Kreisranking, aktuelle Polizeimeldungen und Statistiken. Daten aus PKS und Blaulicht-Feed.`;

  return {
    title,
    description,
    openGraph: {
      title: `${title} | Adlerlicht`,
      description,
      url: `${SITE_URL}/land/${bundesland}/${crimeType}`,
      type: 'website',
      locale: 'de_DE',
    },
    alternates: {
      canonical: `${SITE_URL}/land/${bundesland}/${crimeType}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function BundeslandCrimeTypePage(
  { params }: { params: Promise<{ bundesland: string; crimeType: string }> },
) {
  const { bundesland, crimeType } = await params;
  const bl = BUNDESLAND_BY_SLUG[bundesland];
  const crime = SLUG_TO_CRIME[crimeType];
  if (!bl || !crime) notFound();

  const catInfo = CRIME_CATEGORIES.find((c) => c.key === crime.key);

  const [ranking, blaulichtRecords] = await Promise.all([
    fetchCityRankingByBundesland(crime.key as CrimeCategory, bl.code),
    fetchBlaulichtByBundeslandAndCategory(bl.name, crime.key as CrimeCategory, 15),
  ]);

  const totalCases = ranking.reduce((sum, r) => sum + r.cases, 0);
  const avgHZ = ranking.length > 0
    ? ranking.reduce((sum, r) => sum + r.hz, 0) / ranking.length
    : 0;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: bl.name, href: `/land/${bundesland}` },
          { label: crime.label, href: `/land/${bundesland}/${crimeType}` },
        ]}
      />

      {/* Hero */}
      <section className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          {catInfo && (
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: catInfo.color }}
            />
          )}
          <h1 className="text-3xl font-bold text-[var(--text-primary)]">
            {crime.label} in {bl.name}
          </h1>
        </div>
        <p className="text-[var(--text-muted)]">
          Kreisranking und Polizeimeldungen fuer {crime.label} in {bl.name}
        </p>
      </section>

      {/* Stats */}
      <section className="mb-10">
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">Statistik</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatsCard
            label="Kreise mit Daten"
            value={ranking.length.toLocaleString('de-DE')}
            accentColor={catInfo?.color ?? '#ef4444'}
          />
          <StatsCard
            label="Faelle gesamt"
            value={totalCases.toLocaleString('de-DE')}
            accentColor="#f59e0b"
          />
          <StatsCard
            label="Durchschnittliche HZ"
            value={avgHZ.toLocaleString('de-DE', { maximumFractionDigits: 0 })}
            subtext="pro 100.000 Einwohner"
            accentColor="#22d3ee"
          />
        </div>
      </section>

      {/* Kreis ranking */}
      {ranking.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">
            Kreisranking — {crime.label}
          </h2>
          <div className="grid gap-2">
            {ranking.map((entry, idx) => {
              const kreisEntry = KREIS_BY_AGS[entry.ags];
              return (
                <div
                  key={entry.ags}
                  className="flex items-center justify-between rounded-lg border border-[var(--card-border)] bg-[var(--card)]/50 px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-[var(--text-faint)] w-6 text-right">{idx + 1}.</span>
                    {kreisEntry ? (
                      <a
                        href={`/${kreisEntry.slug}/${crimeType}`}
                        className="text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                      >
                        {entry.name}
                      </a>
                    ) : (
                      <span className="text-sm font-medium text-[var(--text-secondary)]">{entry.name}</span>
                    )}
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    <div className="text-sm font-medium text-[var(--text-secondary)]">
                      {entry.hz.toLocaleString('de-DE', { maximumFractionDigits: 0 })} HZ
                    </div>
                    <div className="text-xs text-[var(--text-faint)]">
                      {entry.cases.toLocaleString('de-DE')} Faelle
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Blaulicht Feed */}
      <BlaulichtFeed
        records={blaulichtRecords}
        title={`${crime.label} in ${bl.name} — Polizeimeldungen`}
      />

      {/* Same crime in other states */}
      <section className="mb-10">
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">
          {crime.label} in anderen Bundeslaendern
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {ALL_BUNDESLAENDER
            .filter((b) => b.code !== bl.code)
            .map((b) => (
              <a
                key={b.code}
                href={`/land/${b.slug}/${crimeType}`}
                className="text-sm px-3 py-2 rounded-lg border border-[var(--card-border)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--text-faint)] transition-colors"
              >
                {b.name}
              </a>
            ))}
        </div>
      </section>

      {/* Other crime types in same state */}
      <section className="mb-10">
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">
          Weitere Delikte in {bl.name}
        </h2>
        <div className="flex flex-wrap gap-2">
          {CRIME_CATEGORIES.filter((c) => c.key !== crime.key).map((c) => {
            const s = CRIME_SLUG_MAP[c.key];
            return (
              <a
                key={c.key}
                href={`/land/${bundesland}/${s.slug}`}
                className="text-sm px-3 py-1.5 rounded-lg border border-[var(--card-border)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--text-faint)] transition-colors flex items-center gap-1.5"
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                {c.label}
              </a>
            );
          })}
        </div>
      </section>
    </>
  );
}
