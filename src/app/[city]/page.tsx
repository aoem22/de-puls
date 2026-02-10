import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { KREIS_BY_SLUG, ALL_CITY_SLUGS } from '@/lib/slugs/registry';
import { BUNDESLAND_BY_CODE } from '@/lib/slugs/bundesland-registry';
import { fetchKreisPageData, fetchCrimeRecordsByBbox, fetchCrimeCountsByBbox } from '@/lib/supabase/seo-queries';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { StatsCard } from '@/components/seo/StatsCard';
import { CrimeTypeGrid } from '@/components/seo/CrimeTypeGrid';
import { BlaulichtFeed } from '@/components/seo/BlaulichtFeed';
import { IndicatorRow } from '@/components/seo/IndicatorRow';
import { BackToMap } from '@/components/seo/BackToMap';

export const revalidate = 86400; // 24h ISR
export const dynamicParams = false;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://de-puls.de';

// ---------------------------------------------------------------------------
// Deutschlandatlas indicator config
// ---------------------------------------------------------------------------

const ATLAS_INDICATORS: Array<{ key: string; label: string; unit: string; max: number }> = [
  { key: 'arbeitslosenquote', label: 'Arbeitslosenquote', unit: '%', max: 20 },
  { key: 'kinderarmut', label: 'Kinderarmut', unit: '%', max: 40 },
  { key: 'einkommen', label: 'Verfuegbares Einkommen', unit: 'EUR', max: 40000 },
  { key: 'auslaenderanteil', label: 'Auslaenderanteil', unit: '%', max: 40 },
  { key: 'kriminalitaetsrate', label: 'Kriminalitaetsrate', unit: 'HZ', max: 20000 },
  { key: 'einwohnerdichte', label: 'Einwohnerdichte', unit: '/km2', max: 5000 },
];

// ---------------------------------------------------------------------------
// Static params
// ---------------------------------------------------------------------------

export function generateStaticParams() {
  return ALL_CITY_SLUGS.map((city) => ({ city }));
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export async function generateMetadata(
  { params }: { params: Promise<{ city: string }> },
): Promise<Metadata> {
  const { city } = await params;
  const kreis = KREIS_BY_SLUG[city];
  if (!kreis) return {};

  const bl = BUNDESLAND_BY_CODE[kreis.bundeslandCode];
  const title = `Kriminalitaet in ${kreis.name}`;
  const description = `Kriminalstatistik, Polizeimeldungen und soziale Indikatoren fuer ${kreis.fullName}, ${bl?.name ?? ''}. Aktuelle Daten zu allen Deliktarten.`;

  return {
    title,
    description,
    openGraph: {
      title: `${title} | De-Puls`,
      description,
      url: `${SITE_URL}/${city}`,
      type: 'website',
      locale: 'de_DE',
    },
    alternates: {
      canonical: `${SITE_URL}/${city}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default async function CityPage(
  { params }: { params: Promise<{ city: string }> },
) {
  const { city } = await params;
  const kreis = KREIS_BY_SLUG[city];
  if (!kreis) notFound();

  const bl = BUNDESLAND_BY_CODE[kreis.bundeslandCode];
  const pageData = await fetchKreisPageData(kreis.ags);

  // Fetch blaulicht data if bbox available
  const [blaulichtRecords, crimeCounts] = pageData.bbox
    ? await Promise.all([
        fetchCrimeRecordsByBbox(pageData.bbox, undefined, 10),
        fetchCrimeCountsByBbox(pageData.bbox),
      ])
    : [[], {}];

  const crimes = pageData.cityCrime?.crimes as Record<string, { cases: number; hz: number; aq: number }> | undefined;

  // Aggregate PKS stats
  let totalCases = 0;
  let avgHZ = 0;
  let avgAQ = 0;
  if (crimes) {
    const vals = Object.values(crimes);
    for (const v of vals) {
      totalCases += v.cases;
      avgHZ += v.hz;
      avgAQ += v.aq;
    }
    if (vals.length > 0) avgAQ = avgAQ / vals.length;
  }

  const indicators = pageData.deutschlandatlas?.indicators as Record<string, number | null> | undefined;

  // JSON-LD Place schema
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: kreis.fullName,
    address: {
      '@type': 'PostalAddress',
      addressRegion: bl?.name ?? '',
      addressCountry: 'DE',
    },
    url: `${SITE_URL}/${city}`,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <Breadcrumbs
        items={[
          { label: bl?.name ?? '', href: `/land/${kreis.bundeslandSlug}` },
          { label: kreis.name, href: `/${city}` },
        ]}
      />

      {/* Hero */}
      <section className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl font-bold text-[var(--text-primary)]">
            Kriminalitaet in {kreis.name}
          </h1>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <a
            href={`/land/${kreis.bundeslandSlug}`}
            className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-[var(--card-elevated)] text-[var(--text-secondary)] hover:bg-[var(--card)] transition-colors"
          >
            {bl?.name}
          </a>
          <span className="text-[var(--text-faint)]">
            {kreis.type === 'stadt' ? 'Kreisfreie Stadt' : 'Landkreis'}
          </span>
          <BackToMap ags={kreis.ags} />
        </div>
      </section>

      {/* PKS Stats Cards */}
      <section className="mb-10">
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">Kriminalstatistik (PKS)</h2>
        {crimes ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatsCard
              label="Straftaten gesamt"
              value={totalCases.toLocaleString('de-DE')}
              accentColor="#ef4444"
            />
            <StatsCard
              label="Haeufigkeitszahl (HZ)"
              value={avgHZ.toLocaleString('de-DE', { maximumFractionDigits: 0 })}
              subtext="Faelle pro 100.000 Einwohner"
              accentColor="#f59e0b"
            />
            <StatsCard
              label="Aufklaerungsquote (AQ)"
              value={`${avgAQ.toLocaleString('de-DE', { maximumFractionDigits: 1 })}%`}
              accentColor="#22c55e"
            />
          </div>
        ) : (
          <p className="text-[var(--text-muted)] text-sm">Keine PKS-Daten fuer diesen Kreis verfuegbar.</p>
        )}
      </section>

      {/* Deutschlandatlas Snapshot */}
      {indicators && (
        <section className="mb-10">
          <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">Soziale Indikatoren</h2>
          <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card)]/50 p-4">
            {ATLAS_INDICATORS.map((ind) => (
              <IndicatorRow
                key={ind.key}
                label={ind.label}
                value={indicators[ind.key] ?? null}
                unit={ind.unit}
                maxValue={ind.max}
              />
            ))}
          </div>
          <p className="text-xs text-[var(--text-faint)] mt-2">Quelle: Deutschlandatlas, BBSR</p>
        </section>
      )}

      {/* Crime Type Grid */}
      <CrimeTypeGrid citySlug={city} counts={crimeCounts} />

      {/* Blaulicht Feed */}
      <BlaulichtFeed records={blaulichtRecords} />

      {/* Nachbar-Kreise (same Bundesland) */}
      <section className="mb-10">
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">
          Weitere Kreise in {bl?.name}
        </h2>
        <SameBundeslandLinks currentSlug={city} bundeslandCode={kreis.bundeslandCode} />
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Same-Bundesland links (inline component to avoid circular imports)
// ---------------------------------------------------------------------------

import { getKreiseByBundesland } from '@/lib/slugs/registry';

function SameBundeslandLinks({ currentSlug, bundeslandCode }: { currentSlug: string; bundeslandCode: string }) {
  const siblings = getKreiseByBundesland(bundeslandCode)
    .filter((k) => k.slug !== currentSlug)
    .slice(0, 12);

  return (
    <div className="flex flex-wrap gap-2">
      {siblings.map((k) => (
        <a
          key={k.slug}
          href={`/${k.slug}`}
          className="text-sm px-3 py-1.5 rounded-lg border border-[var(--card-border)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--text-faint)] transition-colors"
        >
          {k.name}
        </a>
      ))}
    </div>
  );
}
