import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { KREIS_BY_SLUG, ALL_CITY_SLUGS, KREIS_BY_AGS, getKreiseByBundesland } from '@/lib/slugs/registry';
import { BUNDESLAND_BY_CODE } from '@/lib/slugs/bundesland-registry';
import { SLUG_TO_CRIME, ALL_CRIME_SLUGS, CRIME_SLUG_MAP } from '@/lib/slugs/crime-slugs';
import { CRIME_CATEGORIES, type CrimeCategory } from '@/lib/types/crime';
import {
  fetchKreisPageData,
  fetchCrimeRecordsByBbox,
  fetchCityRanking,
  fetchBlaulichtByPlz,
  fetchPlzListForKreis,
  type CityRankingEntry,
} from '@/lib/supabase/seo-queries';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { StatsCard } from '@/components/seo/StatsCard';
import { BlaulichtFeed } from '@/components/seo/BlaulichtFeed';
import { BackToMap } from '@/components/seo/BackToMap';

export const revalidate = 86400;
export const dynamicParams = true;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://adlerlicht.de';

const PLZ_REGEX = /^\d{5}$/;

// ---------------------------------------------------------------------------
// Static params: pre-render top 20 cities x crime types only
// PLZ pages are ISR on-demand (too many combos)
// ---------------------------------------------------------------------------

export function generateStaticParams() {
  const topCities = ALL_CITY_SLUGS.slice(0, 20);
  const params: Array<{ slug: string; sub: string }> = [];
  for (const slug of topCities) {
    for (const crimeSlug of ALL_CRIME_SLUGS) {
      params.push({ slug, sub: crimeSlug });
    }
  }
  return params;
}

// ---------------------------------------------------------------------------
// Metadata — branch on sub type (crime slug vs PLZ)
// ---------------------------------------------------------------------------

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string; sub: string }> },
): Promise<Metadata> {
  const { slug, sub } = await params;
  const kreis = KREIS_BY_SLUG[slug];

  // City + crime type
  const crime = SLUG_TO_CRIME[sub];
  if (kreis && crime) {
    const title = `${crime.label} in ${kreis.name}`;
    const description = `${crime.label} in ${kreis.fullName}: Statistik, Polizeimeldungen und Staedtevergleich. Aktuelle Daten aus PKS und Blaulicht-Feed.`;
    return {
      title,
      description,
      openGraph: {
        title: `${title} | Adlerlicht`,
        description,
        url: `${SITE_URL}/${slug}/${sub}`,
        type: 'website',
        locale: 'de_DE',
      },
      alternates: { canonical: `${SITE_URL}/${slug}/${sub}` },
    };
  }

  // City + PLZ
  if (kreis && PLZ_REGEX.test(sub)) {
    const title = `Kriminalitaet in ${kreis.name} — PLZ ${sub}`;
    const description = `Polizeimeldungen und Kriminalstatistik fuer PLZ ${sub} in ${kreis.name}. Aktuelle Daten aus dem Blaulicht-Feed.`;
    return {
      title,
      description,
      openGraph: {
        title: `${title} | Adlerlicht`,
        description,
        url: `${SITE_URL}/${slug}/${sub}`,
        type: 'website',
        locale: 'de_DE',
      },
      alternates: { canonical: `${SITE_URL}/${slug}/${sub}` },
    };
  }

  return {};
}

// ---------------------------------------------------------------------------
// Page — disambiguation
// ---------------------------------------------------------------------------

export default async function SubPage(
  { params }: { params: Promise<{ slug: string; sub: string }> },
) {
  const { slug, sub } = await params;
  const kreis = KREIS_BY_SLUG[slug];
  const crime = SLUG_TO_CRIME[sub];
  const isPlz = PLZ_REGEX.test(sub);

  if (kreis && crime) {
    return <CityCrimePageContent slug={slug} sub={sub} />;
  }

  if (kreis && isPlz) {
    return <CityPlzPageContent slug={slug} plz={sub} />;
  }

  notFound();
}

// ===========================================================================
// City + Crime Type Page (existing behavior)
// ===========================================================================

async function CityCrimePageContent({ slug, sub }: { slug: string; sub: string }) {
  const kreis = KREIS_BY_SLUG[slug]!;
  const crime = SLUG_TO_CRIME[sub]!;
  const bl = BUNDESLAND_BY_CODE[kreis.bundeslandCode];
  const catInfo = CRIME_CATEGORIES.find((c) => c.key === crime.key);

  const [pageData, ranking] = await Promise.all([
    fetchKreisPageData(kreis.ags),
    fetchCityRanking(crime.key),
  ]);
  const crimes = pageData.cityCrime?.crimes as Record<string, { cases: number; hz: number; aq: number }> | undefined;
  const thisCrime = crimes?.[crime.key];

  const blaulichtRecords = pageData.bbox
    ? await fetchCrimeRecordsByBbox(pageData.bbox, crime.key as CrimeCategory, 15, pageData.boundaryGeometry)
    : [];
  const currentRank = ranking.findIndex((r) => r.ags === kreis.ags);

  const nationalAvg = ranking.length > 0
    ? ranking.reduce((sum, r) => sum + r.hz, 0) / ranking.length
    : 0;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: bl?.name ?? '', href: `/land/${kreis.bundeslandSlug}` },
          { label: kreis.name, href: `/${slug}` },
          { label: crime.label, href: `/${slug}/${sub}` },
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
            {crime.label} in {kreis.name}
          </h1>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <a
            href={`/${slug}`}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          >
            Alle Delikte in {kreis.name}
          </a>
          <BackToMap ags={kreis.ags} />
        </div>
      </section>

      {/* PKS Stats for this crime type */}
      <section className="mb-10">
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">Statistik</h2>
        {thisCrime ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatsCard
              label="Faelle"
              value={thisCrime.cases.toLocaleString('de-DE')}
              accentColor={catInfo?.color ?? '#ef4444'}
            />
            <StatsCard
              label="Haeufigkeitszahl"
              value={thisCrime.hz.toLocaleString('de-DE', { maximumFractionDigits: 0 })}
              subtext="pro 100.000 Einwohner"
              accentColor="#f59e0b"
            />
            <StatsCard
              label="Aufklaerungsquote"
              value={`${thisCrime.aq.toLocaleString('de-DE', { maximumFractionDigits: 1 })}%`}
              accentColor="#22c55e"
            />
            {currentRank >= 0 && (
              <StatsCard
                label="Rang (deutschlandweit)"
                value={`${currentRank + 1} / ${ranking.length}`}
                accentColor="#22d3ee"
              />
            )}
          </div>
        ) : (
          <p className="text-[var(--text-muted)] text-sm">Keine PKS-Daten fuer {crime.label} in diesem Kreis verfuegbar.</p>
        )}
      </section>

      {/* Comparison widget */}
      {thisCrime && nationalAvg > 0 && (
        <section className="mb-10">
          <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">Vergleich</h2>
          <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card)]/50 p-4 space-y-3">
            <ComparisonBar
              label={kreis.name}
              value={thisCrime.hz}
              maxValue={Math.max(thisCrime.hz, nationalAvg) * 1.3}
              color={catInfo?.color ?? '#ef4444'}
            />
            <ComparisonBar
              label="Bundesdurchschnitt"
              value={nationalAvg}
              maxValue={Math.max(thisCrime.hz, nationalAvg) * 1.3}
              color="#64748b"
            />
          </div>
        </section>
      )}

      {/* Blaulicht Feed */}
      <BlaulichtFeed
        records={blaulichtRecords}
        title={`${crime.label} — Polizeimeldungen`}
      />

      {/* Top/Bottom ranking */}
      {ranking.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">
            Staedtevergleich — {crime.label}
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <RankingTable
              title="Hoechste Belastung"
              entries={ranking.slice(0, 5)}
              crimeSlug={sub}
              highlightAgs={kreis.ags}
            />
            <RankingTable
              title="Niedrigste Belastung"
              entries={ranking.slice(-5).reverse()}
              crimeSlug={sub}
              highlightAgs={kreis.ags}
            />
          </div>
        </section>
      )}

      {/* Related crime types in same city */}
      <section className="mb-10">
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">
          Weitere Delikte in {kreis.name}
        </h2>
        <div className="flex flex-wrap gap-2">
          {CRIME_CATEGORIES.filter((c) => c.key !== crime.key).map((c) => {
            const s = CRIME_SLUG_MAP[c.key];
            return (
              <a
                key={c.key}
                href={`/${slug}/${s.slug}`}
                className="text-sm px-3 py-1.5 rounded-lg border border-[var(--card-border)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--text-faint)] transition-colors flex items-center gap-1.5"
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                {c.label}
              </a>
            );
          })}
        </div>
      </section>

      {/* Same crime, other cities */}
      <section className="mb-10">
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">
          {crime.label} in anderen Staedten
        </h2>
        <div className="flex flex-wrap gap-2">
          {getKreiseByBundesland(kreis.bundeslandCode)
            .filter((k) => k.slug !== slug)
            .slice(0, 8)
            .map((k) => (
              <a
                key={k.slug}
                href={`/${k.slug}/${sub}`}
                className="text-sm px-3 py-1.5 rounded-lg border border-[var(--card-border)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--text-faint)] transition-colors"
              >
                {k.name}
              </a>
            ))}
        </div>
      </section>
    </>
  );
}

// ===========================================================================
// City + PLZ Page (new)
// ===========================================================================

async function CityPlzPageContent({ slug, plz }: { slug: string; plz: string }) {
  const kreis = KREIS_BY_SLUG[slug]!;
  const bl = BUNDESLAND_BY_CODE[kreis.bundeslandCode];

  const [blaulichtRecords, plzList] = await Promise.all([
    fetchBlaulichtByPlz(plz, 20),
    fetchPlzListForKreis(kreis.ags),
  ]);

  // Count categories from records
  const categoryCounts: Partial<Record<string, number>> = {};
  for (const record of blaulichtRecords) {
    for (const cat of record.categories) {
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    }
  }

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `Kriminalitaet in ${kreis.name} — PLZ ${plz}`,
    url: `${SITE_URL}/${slug}/${plz}`,
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
          { label: `PLZ ${plz}`, href: `/${slug}/${plz}` },
        ]}
      />

      {/* Hero */}
      <section className="mb-8">
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">
          Kriminalitaet in {kreis.name} — PLZ {plz}
        </h1>
        <div className="flex items-center gap-3 text-sm">
          <a
            href={`/${slug}`}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          >
            Zurueck zu {kreis.name}
          </a>
          <BackToMap ags={kreis.ags} />
        </div>
      </section>

      {/* Stats */}
      <section className="mb-10">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatsCard
            label="Polizeimeldungen"
            value={blaulichtRecords.length.toLocaleString('de-DE')}
            subtext={`im PLZ-Gebiet ${plz}`}
            accentColor="#ef4444"
          />
          <StatsCard
            label="Deliktarten"
            value={Object.keys(categoryCounts).length.toLocaleString('de-DE')}
            accentColor="#f59e0b"
          />
        </div>
      </section>

      {/* Category breakdown */}
      {Object.keys(categoryCounts).length > 0 && (
        <section className="mb-10">
          <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">Deliktarten im PLZ-Gebiet</h2>
          <div className="flex flex-wrap gap-2">
            {CRIME_CATEGORIES
              .filter((c) => categoryCounts[c.key])
              .sort((a, b) => (categoryCounts[b.key] || 0) - (categoryCounts[a.key] || 0))
              .map((c) => (
                <span
                  key={c.key}
                  className="text-sm px-3 py-1.5 rounded-lg border border-[var(--card-border)] text-[var(--text-tertiary)] flex items-center gap-1.5"
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                  {c.label}
                  <span className="text-[var(--text-faint)]">({categoryCounts[c.key]})</span>
                </span>
              ))}
          </div>
        </section>
      )}

      {/* Blaulicht Feed */}
      <BlaulichtFeed
        records={blaulichtRecords}
        title={`Polizeimeldungen — PLZ ${plz}`}
      />

      {/* Other PLZs in same city */}
      {plzList.length > 1 && (
        <section className="mb-10">
          <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">
            Weitere PLZ-Gebiete in {kreis.name}
          </h2>
          <div className="flex flex-wrap gap-2">
            {plzList
              .filter((p) => p !== plz)
              .map((p) => (
                <a
                  key={p}
                  href={`/${slug}/${p}`}
                  className="text-sm px-3 py-1.5 rounded-lg border border-[var(--card-border)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--text-faint)] transition-colors font-mono"
                >
                  {p}
                </a>
              ))}
          </div>
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Inline sub-components
// ---------------------------------------------------------------------------

function ComparisonBar({ label, value, maxValue, color }: {
  label: string; value: number; maxValue: number; color: string;
}) {
  const width = Math.min((value / maxValue) * 100, 100);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-[var(--text-tertiary)]">{label}</span>
        <span className="text-sm font-medium text-[var(--text-primary)]">
          {value.toLocaleString('de-DE', { maximumFractionDigits: 0 })} HZ
        </span>
      </div>
      <div className="h-2 bg-[var(--card-elevated)] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${width}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function RankingTable({ title, entries, crimeSlug, highlightAgs }: {
  title: string;
  entries: CityRankingEntry[];
  crimeSlug: string;
  highlightAgs: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card)]/50 p-4">
      <h3 className="text-sm font-semibold text-[var(--text-tertiary)] mb-3">{title}</h3>
      <div className="space-y-2">
        {entries.map((entry) => {
          const kreisEntry = KREIS_BY_AGS[entry.ags];
          const isHighlighted = entry.ags === highlightAgs;
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
