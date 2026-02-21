import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { KREIS_BY_SLUG, ALL_CITY_SLUGS, KREIS_BY_AGS, getKreiseByBundesland } from '@/lib/slugs/registry';
import { BUNDESLAND_BY_CODE, ALL_BUNDESLAENDER } from '@/lib/slugs/bundesland-registry';
import { SLUG_TO_CRIME, ALL_CRIME_SLUGS, CRIME_SLUG_MAP } from '@/lib/slugs/crime-slugs';
import { CRIME_CATEGORIES } from '@/lib/types/crime';
import {
  fetchKreisPageData,
  fetchCrimeRecordsByBbox,
  fetchCrimeCountsByBbox,
  fetchBlaulichtByCategory,
  fetchCityRanking,
  fetchPlzListForKreis,
  type CityRankingEntry,
} from '@/lib/supabase/seo-queries';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { StatsCard } from '@/components/seo/StatsCard';
import { CrimeTypeGrid } from '@/components/seo/CrimeTypeGrid';
import { IndicatorRow } from '@/components/seo/IndicatorRow';
import { BackToMap } from '@/components/seo/BackToMap';
import { CityBoundaryPreview } from '@/components/seo/CityBoundaryPreview';
import { BlaulichtCardCarousel } from '@/components/seo/BlaulichtCardCarousel';
import { BlaulichtFeed } from '@/components/seo/BlaulichtFeed';
import { AuslaenderSnapshot } from '@/components/seo/AuslaenderSnapshot';
import { KriminalitaetSnapshot } from '@/components/seo/KriminalitaetSnapshot';

export const revalidate = 86400; // 24h ISR
export const dynamicParams = true;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://adlerlicht.de';

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
// Static params — union of city slugs + crime slugs
// ---------------------------------------------------------------------------

export function generateStaticParams() {
  return [
    ...ALL_CITY_SLUGS.map((slug) => ({ slug })),
    ...ALL_CRIME_SLUGS.map((slug) => ({ slug })),
  ];
}

// ---------------------------------------------------------------------------
// Metadata — branch on slug type
// ---------------------------------------------------------------------------

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;

  // City page metadata
  const kreis = KREIS_BY_SLUG[slug];
  if (kreis) {
    const bl = BUNDESLAND_BY_CODE[kreis.bundeslandCode];
    const title = `Kriminalitaet in ${kreis.name}`;
    const description = `Kriminalstatistik, Polizeimeldungen und soziale Indikatoren fuer ${kreis.fullName}, ${bl?.name ?? ''}. Aktuelle Daten zu allen Deliktarten.`;
    return {
      title,
      description,
      openGraph: {
        title: `${title} | Adlerlicht`,
        description,
        url: `${SITE_URL}/${slug}`,
        type: 'website',
        locale: 'de_DE',
      },
      alternates: { canonical: `${SITE_URL}/${slug}` },
    };
  }

  // National crime type metadata
  const crime = SLUG_TO_CRIME[slug];
  if (crime) {
    const title = `${crime.label} in Deutschland`;
    const description = `${crime.label}: Aktuelle Statistiken, Staedtevergleich und Polizeimeldungen fuer ganz Deutschland. Daten aus PKS und Blaulicht-Feed.`;
    return {
      title,
      description,
      openGraph: {
        title: `${title} | Adlerlicht`,
        description,
        url: `${SITE_URL}/${slug}`,
        type: 'website',
        locale: 'de_DE',
      },
      alternates: { canonical: `${SITE_URL}/${slug}` },
    };
  }

  return {};
}

// ---------------------------------------------------------------------------
// Page component — disambiguation
// ---------------------------------------------------------------------------

export default async function SlugPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  // Check city first
  const kreis = KREIS_BY_SLUG[slug];
  if (kreis) {
    return <CityPageContent slug={slug} />;
  }

  // Check national crime type
  const crime = SLUG_TO_CRIME[slug];
  if (crime) {
    return <NationalCrimePageContent slug={slug} />;
  }

  notFound();
}

// ===========================================================================
// City Page Content (existing behavior, extracted)
// ===========================================================================

async function CityPageContent({ slug }: { slug: string }) {
  const kreis = KREIS_BY_SLUG[slug]!;
  const bl = BUNDESLAND_BY_CODE[kreis.bundeslandCode];
  const pageData = await fetchKreisPageData(kreis.ags);

  const [blaulichtRecords, crimeCounts, plzList] = await Promise.all([
    pageData.bbox
      ? fetchCrimeRecordsByBbox(pageData.bbox, undefined, 12, pageData.boundaryGeometry)
      : Promise.resolve([]),
    pageData.bbox
      ? fetchCrimeCountsByBbox(pageData.bbox, pageData.boundaryGeometry)
      : Promise.resolve({}),
    fetchPlzListForKreis(kreis.ags),
  ]);

  const crimes = pageData.cityCrime?.crimes as Record<string, { cases: number; hz: number; aq: number }> | undefined;

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

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: kreis.fullName,
    address: {
      '@type': 'PostalAddress',
      addressRegion: bl?.name ?? '',
      addressCountry: 'DE',
    },
    url: `${SITE_URL}/${slug}`,
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
          { label: kreis.name, href: `/${slug}` },
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

      <KriminalitaetSnapshot crimes={crimes} />

      <AuslaenderSnapshot record={pageData.auslaender} />

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
      <CrimeTypeGrid citySlug={slug} counts={crimeCounts} />

      {/* Polizeimeldungen section */}
      <section className="mb-10">
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">
          Polizeimeldungen (geocodiert im Kreis)
        </h2>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] items-start">
          <CityBoundaryPreview
            cityName={kreis.name}
            boundaryGeometry={pageData.boundaryGeometry}
            records={blaulichtRecords}
          />
          <BlaulichtCardCarousel
            records={blaulichtRecords}
            title="Vollkartenansicht"
          />
        </div>
      </section>

      {/* PLZ-Gebiete */}
      {plzList.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">
            PLZ-Gebiete in {kreis.name}
          </h2>
          <div className="flex flex-wrap gap-2">
            {plzList.map((plz) => (
              <a
                key={plz}
                href={`/${slug}/${plz}`}
                className="text-sm px-3 py-1.5 rounded-lg border border-[var(--card-border)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--text-faint)] transition-colors font-mono"
              >
                {plz}
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Nachbar-Kreise (same Bundesland) */}
      <section className="mb-10">
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">
          Weitere Kreise in {bl?.name}
        </h2>
        <SameBundeslandLinks currentSlug={slug} bundeslandCode={kreis.bundeslandCode} />
      </section>
    </>
  );
}

// ===========================================================================
// National Crime Type Page Content (new)
// ===========================================================================

async function NationalCrimePageContent({ slug }: { slug: string }) {
  const crime = SLUG_TO_CRIME[slug]!;
  const catInfo = CRIME_CATEGORIES.find((c) => c.key === crime.key);

  const [ranking, blaulichtRecords] = await Promise.all([
    fetchCityRanking(crime.key),
    fetchBlaulichtByCategory(crime.key as Parameters<typeof fetchBlaulichtByCategory>[0], 15),
  ]);

  // Aggregate national stats
  const totalCases = ranking.reduce((sum, r) => sum + r.cases, 0);
  const avgHZ = ranking.length > 0
    ? ranking.reduce((sum, r) => sum + r.hz, 0) / ranking.length
    : 0;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `${crime.label} in Deutschland`,
    url: `${SITE_URL}/${slug}`,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <Breadcrumbs
        items={[
          { label: crime.label, href: `/${slug}` },
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
            {crime.label} in Deutschland
          </h1>
        </div>
        <p className="text-[var(--text-muted)]">
          Ueberblick ueber {crime.label} in allen Bundeslaendern und Kreisen
        </p>
      </section>

      {/* National stats */}
      <section className="mb-10">
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">Nationale Statistik</h2>
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

      {/* Bundesland breakdown */}
      <section className="mb-10">
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">
          {crime.label} nach Bundesland
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {ALL_BUNDESLAENDER.map((bl) => (
            <a
              key={bl.code}
              href={`/land/${bl.slug}/${slug}`}
              className="text-sm px-3 py-2 rounded-lg border border-[var(--card-border)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--text-faint)] transition-colors"
            >
              {bl.name}
            </a>
          ))}
        </div>
      </section>

      {/* Top/Bottom ranking */}
      {ranking.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">
            Staedtevergleich — {crime.label}
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <RankingTable
              title="Hoechste Belastung"
              entries={ranking.slice(0, 10)}
              crimeSlug={slug}
            />
            <RankingTable
              title="Niedrigste Belastung"
              entries={ranking.slice(-10).reverse()}
              crimeSlug={slug}
            />
          </div>
        </section>
      )}

      {/* Blaulicht Feed */}
      <BlaulichtFeed
        records={blaulichtRecords}
        title={`${crime.label} — Aktuelle Polizeimeldungen`}
      />

      {/* Other crime types */}
      <section className="mb-10">
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">
          Weitere Deliktarten
        </h2>
        <div className="flex flex-wrap gap-2">
          {CRIME_CATEGORIES.filter((c) => c.key !== crime.key).map((c) => {
            const s = CRIME_SLUG_MAP[c.key];
            return (
              <a
                key={c.key}
                href={`/${s.slug}`}
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

// ---------------------------------------------------------------------------
// Inline sub-components
// ---------------------------------------------------------------------------

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

function RankingTable({ title, entries, crimeSlug, highlightAgs }: {
  title: string;
  entries: CityRankingEntry[];
  crimeSlug: string;
  highlightAgs?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card)]/50 p-4">
      <h3 className="text-sm font-semibold text-[var(--text-tertiary)] mb-3">{title}</h3>
      <div className="space-y-2">
        {entries.map((entry) => {
          const kreisEntry = KREIS_BY_AGS[entry.ags];
          const isHighlighted = highlightAgs && entry.ags === highlightAgs;
          return (
            <div
              key={entry.ags}
              className={`flex items-center justify-between text-sm ${
                isHighlighted ? 'text-cyan-400' : 'text-[var(--text-tertiary)]'
              }`}
            >
              {kreisEntry ? (
                <a
                  href={`/${kreisEntry.slug}/${crimeSlug}`}
                  className="hover:text-[var(--text-primary)] transition-colors truncate"
                >
                  {entry.name}
                </a>
              ) : (
                <span className="truncate">{entry.name}</span>
              )}
              <span className="font-medium ml-2 shrink-0">
                {entry.hz.toLocaleString('de-DE', { maximumFractionDigits: 0 })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
